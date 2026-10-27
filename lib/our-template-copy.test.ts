import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  categories: vi.fn(), images: vi.fn(), create: vi.fn(), query: vi.fn(),
  transaction: vi.fn(), copy: vi.fn(), unlink: vi.fn(), findImage: vi.fn(),
}));
vi.mock('@/lib/prisma', () => ({ prisma: {
  ourCategory: { findMany: mocks.categories },
  ourCategoryImageTemplate: { findMany: mocks.images, create: mocks.create, findUnique: mocks.findImage },
  $queryRaw: mocks.query, $transaction: mocks.transaction,
} }));
vi.mock('@/lib/s3-listing-storage', () => ({ copyFile: mocks.copy, unlink: mocks.unlink }));

import { copyOurTemplateImages } from '@/lib/our-categories';

const regions = [{
  id: 'area-1', name: 'Print area', imageItemNumber: 1,
  corners: { topLeft: { x: 10, y: 10 }, topRight: { x: 90, y: 10 }, bottomRight: { x: 90, y: 90 }, bottomLeft: { x: 10, y: 90 } },
}];
const source = { id: 1, templateType: 'single', itemCount: 1, _count: { imageTemplates: 1, listings: 2 } };
const target = { id: 2, templateType: 'single', itemCount: 1, _count: { imageTemplates: 0, listings: 0 } };
const image = {
  id: 10, categoryId: 1, name: 'Living room', description: 'Framed print',
  imagePath: 'source/image.png', originalFileName: 'room.png', contentType: 'image/png', sizeBytes: 1234,
  imageWidth: 100, imageHeight: 100, openingRegions: regions,
  topText: 'Hello', bottomText: 'World', fontId: 'nunito-semibold',
  borderEnabled: true, borderSizePercent: 4, displayFonts: true,
  useOnPrints: true, useOnCustomised: false, useOnDigital: true,
  createdAt: new Date('2026-01-01'), updatedAt: new Date('2026-01-02'), position: 5,
};

beforeEach(() => {
  vi.resetAllMocks();
  mocks.categories.mockResolvedValue([source, target]);
  mocks.images.mockResolvedValue([image]);
  mocks.query.mockImplementation(async (strings: TemplateStringsArray) => strings.join('').includes('SELECT id, imageWidth') ? [image] : []);
  mocks.transaction.mockImplementation(async (operation) => operation({
    ourCategory: { findMany: mocks.categories },
    ourCategoryImageTemplate: { findMany: mocks.images, create: mocks.create },
  }));
});

describe('copying all template images', () => {
  it('copies S3 files to independent paths and preserves calibration, display settings and order', async () => {
    mocks.images.mockResolvedValue([image, { ...image, id: 11, name: 'Bedroom', imagePath: 'source/bedroom.png' }]);
    mocks.query.mockImplementation(async (strings: TemplateStringsArray) => strings.join('').includes('SELECT id, imageWidth')
      ? [image, { ...image, id: 11 }] : []);
    await copyOurTemplateImages('1', '2');
    expect(mocks.copy).toHaveBeenCalledTimes(2);
    expect(mocks.copy.mock.calls[0][0]).toBe(image.imagePath);
    expect(mocks.copy.mock.calls[0][1]).not.toBe(image.imagePath);
    expect(mocks.create.mock.calls[0][0].data).toMatchObject({
      categoryId: 2, name: image.name, openingRegions: regions, imageWidth: 100, imageHeight: 100,
      topText: 'Hello', bottomText: 'World', fontId: image.fontId,
      borderEnabled: true, borderSizePercent: 4, displayFonts: true,
      useOnCustomised: false, position: 0,
    });
    expect(mocks.create.mock.calls[1][0].data.position).toBe(1);
    expect(mocks.create.mock.calls[0][0].data.linkedSourceImageTemplateId).toBeUndefined();
    expect(mocks.unlink).not.toHaveBeenCalled();
  });

  it.each([
    { ...target, _count: { imageTemplates: 1, listings: 0 } },
    { ...target, templateType: 'multiple' },
    { ...target, itemCount: 3 },
  ])('rejects an ineligible destination before copying files', async (destination) => {
    mocks.categories.mockResolvedValue([source, destination]);
    await expect(copyOurTemplateImages('1', '2')).rejects.toThrow();
    expect(mocks.copy).not.toHaveBeenCalled();
  });

  it('allows copying to a destination that already has listings', async () => {
    mocks.categories.mockResolvedValue([source, { ...target, _count: { imageTemplates: 0, listings: 5 } }]);
    await expect(copyOurTemplateImages('1', '2')).resolves.toBeUndefined();
    expect(mocks.copy).toHaveBeenCalledTimes(1);
    expect(mocks.create).toHaveBeenCalledTimes(1);
  });

  it('rechecks eligibility after S3 copying and removes copied files if the destination gained images', async () => {
    mocks.categories.mockResolvedValueOnce([source, target]).mockResolvedValueOnce([source, { ...target, _count: { imageTemplates: 1, listings: 0 } }]);
    await expect(copyOurTemplateImages('1', '2')).rejects.toThrow('no image templates');
    expect(mocks.create).not.toHaveBeenCalled();
    expect(mocks.unlink).toHaveBeenCalledWith(mocks.copy.mock.calls[0][1]);
  });

  it('cleans up copied files if database creation fails', async () => {
    mocks.create.mockRejectedValue(new Error('Database unavailable'));
    await expect(copyOurTemplateImages('1', '2')).rejects.toThrow('Database unavailable');
    expect(mocks.unlink).toHaveBeenCalledWith(mocks.copy.mock.calls[0][1]);
  });

  it('cleans up partial S3 copies if copying fails', async () => {
    mocks.copy.mockRejectedValue(new Error('S3 unavailable'));
    await expect(copyOurTemplateImages('1', '2')).rejects.toThrow('S3 unavailable');
    expect(mocks.create).not.toHaveBeenCalled();
    expect(mocks.unlink).toHaveBeenCalledWith(mocks.copy.mock.calls[0][1]);
  });
});
