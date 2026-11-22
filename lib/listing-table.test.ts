import { describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ listings: vi.fn() }));
vi.mock('@/lib/prisma', () => ({ prisma: {
  etsyShop: { findUnique: async () => ({ id: 1, etsyShopId: 66615491n, shopName: 'Shop', title: 'Shop' }) },
  etsyShopSection: { findFirst: async () => ({ id: 2, title: 'Prints', etsyShopSectionId: null }) },
  etsyShopSubSection: { findFirst: async () => ({ id: 3, name: 'Animals', numberOfDownloads: 1, includeAllDownloads: false }) },
  etsyListing: { findMany: mocks.listings }, ourCategory: { findMany: async () => [] },
} }));
vi.mock('@/lib/dropbox-bundle', () => ({ inspectListingZipStorage: async () => ({ valid: false }), isDropboxInstructionPdfFile: () => false }));
vi.mock('@/lib/listing-image-generation-state', () => ({ listingsNeedingImageGeneration: async () => new Set() }));
import { getSubSectionListingsPageData } from './listing-table';

function listing(id: number, thumbnailFileName: string | null, thumbnailUpdatedAt: Date | null) {
  return { id, title: `Artwork ${id}`, localDirectoryName: `Artwork ${id}`, thumbnailFileName, thumbnailUpdatedAt,
    artworkOrientation: 'portrait', numberOfItems: 1, ourCategoryId: null, sourceSection: null, ourCategory: null, state: 'local',
    etsyId: null, etsyDownloadId: null, etsyDownloadState: null, priceAmount: 2999, priceDivisor: 100, priceCurrencyCode: 'GBP', quantity: 999,
    tags: [], images: [], files: [], zippedFiles: [], products: [], dropboxFiles: [], groupItems: [], productConfig: null,
    dropboxBundle: null, dropboxSyncedAt: null, dropboxRevision: 0, downloadsRevision: 0, listingDescription: null,
    description: null, digitalTitle: null, digitalDescription: null, digitalQuantity: null, primaryColour: null, secondaryColour: null,
    printCropSettings: null };
}

describe('listing table artwork availability', () => {
  it('always maps an actual thumbnail boolean and ISO version, including blank and absent filenames', async () => {
    const timestamp = new Date('2026-11-21T14:20:00.000Z');
    mocks.listings.mockResolvedValue([listing(79, 'thumbnail.png', timestamp), listing(80, null, null), listing(81, '  ', null), listing(82, '', null)]);
    const data = await getSubSectionListingsPageData('66615491', '2', '3');
    expect(data?.listings.map(({ id, hasThumbnail, thumbnailUpdatedAt }) => ({ id, hasThumbnail, thumbnailUpdatedAt }))).toEqual([
      { id: '79', hasThumbnail: true, thumbnailUpdatedAt: timestamp.toISOString() },
      { id: '80', hasThumbnail: false, thumbnailUpdatedAt: null },
      { id: '81', hasThumbnail: false, thumbnailUpdatedAt: null },
      { id: '82', hasThumbnail: false, thumbnailUpdatedAt: null },
    ]);
    expect(mocks.listings).toHaveBeenCalledWith(expect.objectContaining({ select: expect.objectContaining({ thumbnailFileName: true, thumbnailUpdatedAt: true }) }));
  });
});
