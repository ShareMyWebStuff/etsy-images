import sharp from 'sharp';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  shop: vi.fn(), section: vi.fn(), subsection: vi.fn(), listing: vi.fn(), query: vi.fn(),
  read: vi.fn(), mkdir: vi.fn(), write: vi.fn(), unlink: vi.fn(), upsert: vi.fn(), reference: vi.fn(), update: vi.fn(), render: vi.fn(),
  recordRevision: vi.fn(), complete: vi.fn(), transaction: vi.fn(), lockListing: vi.fn(),
  files: new Map<string, Buffer>(),
}));
vi.mock('@/lib/prisma', () => ({ prisma: {
  etsyShop: { findUnique: mocks.shop }, etsyShopSection: { findFirst: mocks.section },
  etsyShopSubSection: { findFirst: mocks.subsection },
  etsyListing: { findFirst: mocks.listing, update: mocks.update },
  etsyListingImage: { upsert: mocks.upsert, findFirst: mocks.reference },
  adminProductPrice: { findMany: vi.fn().mockResolvedValue([]) }, $queryRaw: mocks.query, $transaction: mocks.transaction,
} }));
vi.mock('@/lib/s3-listing-storage', () => ({ readFile: mocks.read, mkdir: mocks.mkdir, writeFile: mocks.write, unlink: mocks.unlink }));
vi.mock('@/lib/our-categories', () => ({ renderOurCategoryImageTemplate: mocks.render }));
vi.mock('@/lib/listing-image-generation-state', () => ({
  recordListingTemplateImageRevision: mocks.recordRevision, markListingImageGenerationComplete: mocks.complete,
}));

import { generateListingTemplateImages } from '@/lib/listing-editor';
import { createListingPrintCropSettings, defaultNativeListingPrintCropDraft } from '@/lib/listing-print-crops';

const context = { shopId: '66', sectionId: '15', subSectionId: '27', listingId: '548' };
let listing: Record<string, unknown>;
let crops: ReturnType<typeof createListingPrintCropSettings>;
let artwork: Buffer;

beforeEach(async () => {
  vi.resetAllMocks();
  mocks.files.clear();
  artwork = await sharp({ create: { width: 80, height: 100, channels: 3, background: '#008000' } }).png().toBuffer();
  crops = createListingPrintCropSettings(defaultNativeListingPrintCropDraft(80, 100), {
    fileName: 'art.png', updatedAt: '2026-11-13T00:00:00.000Z', width: 80, height: 100,
  });
  listing = {
    id: 548, localDirectoryName: 'Art', thumbnailFileName: 'art.png',
    thumbnailUpdatedAt: new Date('2026-11-13T00:00:00.000Z'), productConfig: {},
    ourCategory: { id: 2, templateType: 'single', customisePrints: false, itemCount: 1,
      imageTemplates: [{ id: 94, name: 'Nursery' }, { id: 95, name: 'Detail' }] },
  };
  mocks.shop.mockResolvedValueOnce({ id: 1, etsyShopId: 66n, shopName: 'Shop' }).mockResolvedValue(null);
  mocks.section.mockResolvedValue({ id: 15, title: 'Art' });
  mocks.subsection.mockResolvedValue({ id: 27, name: 'Single' });
  mocks.listing.mockImplementation(async () => listing);
  mocks.query.mockImplementation(async (sql: TemplateStringsArray) => sql.join('').includes('FROM etsy_listings') ? [{
    artworkOrientation: 'portrait', printCropSettings: crops,
    listingImagesRevision: 7, listingImagesGeneratedRevision: 6,
  }] : []);
  mocks.read.mockResolvedValue(artwork);
  mocks.render.mockResolvedValue(artwork);
  mocks.write.mockImplementation(async (filePath: string, contents: Buffer) => { mocks.files.set(filePath, contents); });
  mocks.unlink.mockImplementation(async (filePath: string) => { mocks.files.delete(filePath); });
  mocks.reference.mockImplementation(async ({ where }: { where: { localFileName: string } }) =>
    ((listing.images ?? []) as Array<{ localFileName: string }>).some((image) => image.localFileName === where.localFileName) ? { id: 1 } : null);
  mocks.lockListing.mockResolvedValue([{ ourCategoryId: 2, listingImagesRevision: 7 }]);
  mocks.transaction.mockImplementation(async (operation) => operation({ $queryRaw: mocks.lockListing, etsyListingImage: { upsert: mocks.upsert } }));
});

describe('normal listing-image generation with room scenes', () => {
  it('passes each source crop through the existing rendering entry point and completes only after all writes', async () => {
    // Stop at the final editor reload: all rendering/storage work has completed.
    await expect(generateListingTemplateImages(context)).rejects.toThrow('could not be reloaded');
    expect(mocks.render).toHaveBeenCalledTimes(2);
    expect(mocks.render.mock.calls[0][0]).toBe(94);
    expect(mocks.render.mock.calls[0][1].get(1)).toEqual(artwork);
    expect(mocks.render.mock.calls[0][5].get(1)).toEqual(crops);
    expect(mocks.recordRevision.mock.calls).toEqual([[548, 94, 7], [548, 95, 7]]);
    expect(mocks.complete).toHaveBeenCalledWith(548, 7);
    expect(mocks.complete.mock.invocationCallOrder[0]).toBeGreaterThan(mocks.write.mock.invocationCallOrder[1]);
    expect(mocks.complete.mock.invocationCallOrder[0]).toBeGreaterThan(mocks.upsert.mock.invocationCallOrder[1]);
    expect(mocks.transaction).toHaveBeenCalledTimes(2);
    expect(mocks.transaction.mock.calls.every(([, options]) => options.isolationLevel === 'Serializable')).toBe(true);
    expect(mocks.lockListing.mock.calls[0][0].join('')).toMatch(/SELECT ourCategoryId, listingImagesRevision FROM etsy_listings\s+WHERE id =\s+FOR UPDATE/);
    expect(mocks.lockListing.mock.calls[0][1]).toBe(548);
    expect(mocks.lockListing.mock.invocationCallOrder[0]).toBeLessThan(mocks.upsert.mock.invocationCallOrder[0]);
    expect(mocks.update).toHaveBeenCalledWith({ where: { id: 548 }, data: {
      imagesChanged: true, lastLocalChangeAt: expect.any(Date),
    } });
  });

  it('keeps regeneration pending when a subsequent scene fails to render', async () => {
    mocks.render.mockResolvedValueOnce(artwork).mockRejectedValueOnce(new Error('Invalid lighting pair'));
    await expect(generateListingTemplateImages(context)).rejects.toThrow('Invalid lighting pair');
    expect(mocks.recordRevision.mock.calls).toEqual([[548, 94, 7]]);
    expect(mocks.complete).not.toHaveBeenCalled();
  });

  it('does not complete when persisting an image fails', async () => {
    mocks.write.mockRejectedValue(new Error('Storage unavailable'));
    await expect(generateListingTemplateImages(context)).rejects.toThrow('Storage unavailable');
    expect(mocks.recordRevision).not.toHaveBeenCalled();
    expect(mocks.complete).not.toHaveBeenCalled();
    expect(mocks.unlink).toHaveBeenCalledTimes(1);
  });

  it('cleans a new generated file if recording its database image fails', async () => {
    mocks.upsert.mockRejectedValueOnce(new Error('Database write unavailable'));
    await expect(generateListingTemplateImages(context, 94)).rejects.toThrow('Database write unavailable');
    expect(mocks.unlink).toHaveBeenCalledExactlyOnceWith(mocks.write.mock.calls[0][0]);
    expect(mocks.files.size).toBe(0);
    expect(mocks.recordRevision).not.toHaveBeenCalled(); expect(mocks.complete).not.toHaveBeenCalled();
    expect(mocks.reference).toHaveBeenCalledExactlyOnceWith({ where: { listingId: 548, localFileName: 'template-94.png' }, select: { id: true } });
  });

  it('rejects and cleans old-template output when reassignment commits while rendering is in flight', async () => {
    mocks.lockListing.mockResolvedValueOnce([{ ourCategoryId: 3, listingImagesRevision: 8 }]);
    await expect(generateListingTemplateImages(context, 94)).rejects.toThrow('The assigned template changed while images were being generated');
    expect(mocks.upsert).not.toHaveBeenCalled(); expect(mocks.files.size).toBe(0);
    expect(mocks.unlink).toHaveBeenCalledTimes(1); expect(mocks.recordRevision).not.toHaveBeenCalled();
    expect(mocks.complete).not.toHaveBeenCalled();
  });

  it('rejects superseded output when the template remains assigned but its generation revision changes', async () => {
    mocks.lockListing.mockResolvedValueOnce([{ ourCategoryId: 2, listingImagesRevision: 8 }]);
    await expect(generateListingTemplateImages(context, 94)).rejects.toThrow('The listing images changed while generation was running');
    expect(mocks.upsert).not.toHaveBeenCalled(); expect(mocks.files.size).toBe(0);
    expect(mocks.complete).not.toHaveBeenCalled();
  });

  it('rechecks assignment for each output and stops before writing a second stale image row', async () => {
    mocks.lockListing.mockResolvedValueOnce([{ ourCategoryId: 2, listingImagesRevision: 7 }])
      .mockResolvedValueOnce([{ ourCategoryId: 3, listingImagesRevision: 8 }]);
    await expect(generateListingTemplateImages(context)).rejects.toThrow('The assigned template changed');
    expect(mocks.upsert).toHaveBeenCalledTimes(1);
    expect(mocks.recordRevision.mock.calls).toEqual([[548, 94, 7]]);
    expect([...mocks.files.keys()].every((key) => key.endsWith('template-94.png'))).toBe(true);
    expect(mocks.complete).not.toHaveBeenCalled();
  });

  it('cleans partial new storage output after the write promise rejects', async () => {
    mocks.write.mockImplementationOnce(async (filePath: string, contents: Buffer) => {
      mocks.files.set(filePath, contents); throw new Error('Preview upload failed');
    });
    await expect(generateListingTemplateImages(context, 94)).rejects.toThrow('Preview upload failed');
    expect(mocks.files.size).toBe(0); expect(mocks.upsert).not.toHaveBeenCalled();
    expect(mocks.unlink.mock.invocationCallOrder[0]).toBeGreaterThan(mocks.write.mock.invocationCallOrder[0]);
  });

  it('retains an overwritten registered image when its database update fails', async () => {
    listing.images = [{ localFileName: 'template-94.png', ourCategoryImageTemplateId: 94 }];
    mocks.upsert.mockRejectedValueOnce(new Error('Database write unavailable'));
    await expect(generateListingTemplateImages(context, 94)).rejects.toThrow('Database write unavailable');
    expect(mocks.unlink).not.toHaveBeenCalled(); expect(mocks.files.size).toBe(1);
    expect(mocks.complete).not.toHaveBeenCalled();
  });

  it('cleans a failed output when its old snapshot reference was concurrently deleted', async () => {
    listing.images = [{ localFileName: 'template-94.png', ourCategoryImageTemplateId: 94 }];
    mocks.reference.mockResolvedValueOnce(null);
    mocks.upsert.mockRejectedValueOnce(new Error('Template was deleted'));
    await expect(generateListingTemplateImages(context, 94)).rejects.toThrow('Template was deleted');
    expect(mocks.unlink).toHaveBeenCalledExactlyOnceWith(mocks.write.mock.calls[0][0]);
    expect(mocks.files.size).toBe(0); expect(mocks.complete).not.toHaveBeenCalled();
  });

  it('preserves a file referenced by a competing successful generation absent from the initial snapshot', async () => {
    listing.images = [];
    mocks.upsert.mockRejectedValueOnce(new Error('Database response timed out'));
    mocks.reference.mockResolvedValueOnce({ id: 99 });
    await expect(generateListingTemplateImages(context, 94)).rejects.toThrow('Database response timed out');
    expect(mocks.reference).toHaveBeenCalledTimes(1); expect(mocks.unlink).not.toHaveBeenCalled();
    expect(mocks.files.size).toBe(1); expect(mocks.complete).not.toHaveBeenCalled();
  });

  it('preserves the output and reports safe-cleanup retry guidance when checking its live reference fails', async () => {
    mocks.upsert.mockRejectedValueOnce(new Error('Image record failed'));
    mocks.reference.mockRejectedValueOnce(new Error('Database unavailable'));
    await expect(generateListingTemplateImages(context, 94)).rejects.toThrow('Image record failed The generated image was preserved because its database reference could not be checked. Run Generate again to retry safe cleanup.');
    expect(mocks.unlink).not.toHaveBeenCalled(); expect(mocks.files.size).toBe(1);
    expect(mocks.complete).not.toHaveBeenCalled();
  });

  it('retains a newly registered file if subsequent revision recording fails', async () => {
    mocks.recordRevision.mockRejectedValueOnce(new Error('Revision update failed'));
    await expect(generateListingTemplateImages(context, 94)).rejects.toThrow('Revision update failed');
    expect(mocks.upsert).toHaveBeenCalledTimes(1); expect(mocks.unlink).not.toHaveBeenCalled();
    expect(mocks.files.size).toBe(1); expect(mocks.complete).not.toHaveBeenCalled();
  });

  it('reports the original generation error and a cleanup retry when removal also fails', async () => {
    mocks.upsert.mockRejectedValueOnce(new Error('Database write unavailable'));
    mocks.unlink.mockRejectedValueOnce(new Error('Storage delete unavailable'));
    await expect(generateListingTemplateImages(context, 94)).rejects.toThrow('Database write unavailable The incomplete generated image could not be removed. Run Generate again to retry cleanup.');
    expect(mocks.complete).not.toHaveBeenCalled();
  });

  it('supports individual-image generation using the same captured revision', async () => {
    await expect(generateListingTemplateImages(context, 95)).rejects.toThrow('could not be reloaded');
    expect(mocks.render).toHaveBeenCalledTimes(1);
    expect(mocks.render.mock.calls[0][0]).toBe(95);
    expect(mocks.recordRevision.mock.calls).toEqual([[548, 95, 7]]);
    // The completion query still checks every other remaining image's revision.
    expect(mocks.complete).toHaveBeenCalledWith(548, 7);
  });
});
