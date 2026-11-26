import sharp from 'sharp';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  shop: vi.fn(), section: vi.fn(), subSection: vi.fn(), listing: vi.fn(), query: vi.fn(),
  execute: vi.fn(), read: vi.fn(), mkdir: vi.fn(), invalidateConsumers: vi.fn(),
}));
vi.mock('@/lib/prisma', () => ({ prisma: {
  etsyShop: { findUnique: mocks.shop }, etsyShopSection: { findFirst: mocks.section },
  etsyShopSubSection: { findFirst: mocks.subSection }, etsyListing: { findFirst: mocks.listing },
  adminProductPrice: { findMany: vi.fn().mockResolvedValue([]) },
  $queryRaw: mocks.query, $executeRaw: mocks.execute,
} }));
vi.mock('@/lib/s3-listing-storage', () => ({ readFile: mocks.read, mkdir: mocks.mkdir }));
vi.mock('@/lib/listing-template-artwork-dependencies', () => ({ invalidateListingTemplateArtworkConsumers: mocks.invalidateConsumers }));

import { saveListingPrintCropSettings } from '@/lib/listing-editor';
import { fourByFivePrintCropDraft } from '@/lib/listing-print-crops';

const context = { shopId: '66615491', sectionId: '15', subSectionId: '27', listingId: '548' };
const updatedAt = new Date('2026-11-13T00:00:00.000Z');
const refreshReached = new Error('Saved crop refresh reached');

beforeEach(async () => {
  vi.clearAllMocks();
  mocks.shop.mockResolvedValue({ id: 1, etsyShopId: 66615491n, shopName: 'Shop' });
  mocks.section.mockResolvedValue({ id: 15, title: 'Art' });
  mocks.subSection.mockResolvedValue({ id: 27, name: 'Single' });
  mocks.listing.mockResolvedValueOnce({
    id: 548, title: 'Artwork', localDirectoryName: 'Artwork', thumbnailFileName: 'art.png',
    thumbnailUpdatedAt: updatedAt,
  }).mockRejectedValue(refreshReached);
  mocks.query.mockResolvedValue([{ artworkOrientation: 'portrait' }]);
  mocks.read.mockResolvedValue(await sharp({ create: { width: 400, height: 500, channels: 3, background: '#008000' } }).png().toBuffer());
});

describe('saving listing print crops', () => {
  it('persists the chosen per-ratio region and marks both generated images and downloads for resync', async () => {
    const draft = fourByFivePrintCropDraft(400, 500, 'portrait');
    draft.regions['2x3'].x = 1 - draft.regions['2x3'].width;
    // The storage/database boundary is mocked; stop at the post-save editor
    // reload and inspect the persisted settings and invalidation flags.
    await expect(saveListingPrintCropSettings(context, draft)).rejects.toThrow('Listing not found.');
    expect(mocks.execute).toHaveBeenCalledTimes(1);
    expect(mocks.invalidateConsumers).toHaveBeenCalledWith([548]);
    const [sql, ...values] = mocks.execute.mock.calls[0];
    expect(sql.join('')).toMatch(/imagesChanged\s*=\s*true/);
    expect(sql.join('')).toMatch(/downloadsChanged\s*=\s*true/);
    const serialized = values.find((value) => typeof value === 'string' && value.includes('"regions"')) as string;
    const settings = JSON.parse(serialized);
    expect(settings).toMatchObject({ version: 4, sourceRatio: '4x5', regions: draft.regions });
    expect(settings.placements['2x3'].x).toBeCloseTo(-draft.regions['2x3'].x / draft.regions['2x3'].width);
    expect(settings.placements['2x3'].height).toBe(1);
  });
});
