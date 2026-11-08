import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  category: vi.fn(), image: vi.fn(), linkedImages: vi.fn(), listingImages: vi.fn(),
  categoryUpdate: vi.fn(), deleteImages: vi.fn(), deleteImage: vi.fn(), execute: vi.fn(), transaction: vi.fn(),
}));
vi.mock('@/lib/prisma', () => ({ prisma: {
  ourCategory: { findUnique: mocks.category },
  ourCategoryImageTemplate: { findUnique: mocks.image, findMany: mocks.linkedImages },
  etsyListingImage: { findMany: mocks.listingImages },
  $transaction: mocks.transaction,
} }));
vi.mock('@/lib/listing-image-reset', () => ({
  removeListingImages: async (_path: string, _images: unknown[], removeDatabaseRows: () => Promise<void>) => removeDatabaseRows(),
}));

import { deleteOurCategoryImageTemplate, reorderOurCategoryImageTemplates } from '@/lib/our-categories';

beforeEach(() => {
  vi.resetAllMocks();
  mocks.transaction.mockImplementation(async (callback) => callback({
    ourCategory: { updateMany: mocks.categoryUpdate },
    ourCategoryImageTemplate: { deleteMany: mocks.deleteImages, delete: mocks.deleteImage },
    $executeRaw: mocks.execute,
  }));
});

describe('template change timestamps', () => {
  it('records image reordering so listings synced before the reorder become stale', async () => {
    mocks.category.mockResolvedValue({ imageTemplates: [{ id: 10 }, { id: 20 }] });
    await reorderOurCategoryImageTemplates('1', ['20', '10']);
    expect(mocks.execute).toHaveBeenCalledTimes(2);
    for (const [index, [sql, position, changedAt, imageId, categoryId]] of mocks.execute.mock.calls.entries()) {
      expect(sql.join('')).toMatch(/SET position = , updatedAt = /);
      expect(changedAt).toBeInstanceOf(Date);
      expect(position).toBe(index);
      expect(imageId).toBe(index === 0 ? 20 : 10);
      expect(categoryId).toBe(1);
    }
  });

  it('preserves change times for source and linked templates before deleting their images', async () => {
    mocks.image.mockResolvedValue({
      id: 10, imagePath: 'D:/Templates/source.png', linkedSourceImageTemplateId: null,
      category: { templateType: 'single' },
    });
    mocks.linkedImages.mockResolvedValueOnce([{ id: 20 }]).mockResolvedValue([]);
    mocks.listingImages.mockResolvedValue([]);
    await deleteOurCategoryImageTemplate('10');
    expect(mocks.categoryUpdate).toHaveBeenCalledWith({
      where: { imageTemplates: { some: { id: { in: [10, 20] } } } },
      data: { updatedAt: expect.any(Date) },
    });
    expect(mocks.deleteImages).toHaveBeenCalledWith({ where: { id: { in: [20] } } });
    expect(mocks.categoryUpdate.mock.invocationCallOrder[0]).toBeLessThan(mocks.deleteImages.mock.invocationCallOrder[0]);
    expect(mocks.categoryUpdate.mock.invocationCallOrder[0]).toBeLessThan(mocks.deleteImage.mock.invocationCallOrder[0]);
  });
});
