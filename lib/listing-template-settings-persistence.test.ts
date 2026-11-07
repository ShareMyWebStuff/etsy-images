import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ transaction: vi.fn() }));
vi.mock('@/lib/prisma', () => ({ prisma: { $transaction: mocks.transaction } }));

import { ensureListingProductDefaultsInTransaction, saveListingCustomisationSettings } from '@/lib/listing-products';

const context = { shopId: '66615491', sectionId: '14', subSectionId: '26', listingId: '518' };
const personalisation = { customisePrints: true, customTop: true, customBottom: true };

function setup() {
  const listing = {
    id: 518, etsyId: null, etsyDownloadId: null, title: 'Ant', localDirectoryName: 'Ant',
    numberOfItems: 1, includeAllItems: false, etsyProductType: 'physical',
    productConfig: {
      listOnEtsy: true, digitalDownload: true, printsFrames: true,
      printsFramesOverride: null as boolean | null, digitalDownloadOverride: null as boolean | null,
      ...personalisation, downloadSectionId: 123, sku: 'SKU_000001',
    },
    ourCategory: {
      printsFrames: true, digitalDownload: true, ...personalisation,
      sizes: { a4: true }, frames: { no_frame: true },
      downloadSection: { etsyShopSectionId: 123 },
    },
    products: [] as Array<Record<string, unknown>>,
  };
  const tx = {
    etsyListing: {
      findFirst: vi.fn().mockResolvedValue(listing),
      findUnique: vi.fn().mockResolvedValue(listing),
      update: vi.fn().mockResolvedValue({}),
    },
    etsySkuAllocation: { upsert: vi.fn().mockResolvedValue({ sequenceNumber: 1 }) },
    etsyListingProductConfig: {
      upsert: vi.fn().mockImplementation(async ({ update }) => {
        Object.assign(listing.productConfig, Object.fromEntries(Object.entries(update).filter(([, value]) => value !== undefined)));
      }),
    },
    etsyListingProduct: {
      findMany: vi.fn().mockResolvedValue([]),
      deleteMany: vi.fn().mockResolvedValue({ count: 0 }),
      update: vi.fn(),
      upsert: vi.fn().mockImplementation(async ({ create }) => {
        listing.products.push(create);
      }),
    },
  };
  mocks.transaction.mockImplementation(async (callback) => callback(tx));
  return { listing, tx };
}

describe('saving listing template settings', () => {
  beforeEach(() => vi.clearAllMocks());

  it('keeps print and download overrides after saving personalisation and reloading', async () => {
    const { listing, tx } = setup();
    await saveListingCustomisationSettings(context, {
      ...personalisation, customisePrints: false, printsFrames: false, digitalDownload: false,
    });
    expect(listing.productConfig).toMatchObject({
      printsFramesOverride: false, digitalDownloadOverride: false,
      printsFrames: false, digitalDownload: false, customisePrints: false,
    });
    // A separate personalisation edit must retain the other saved product overrides.
    await saveListingCustomisationSettings(context, personalisation);
    tx.etsyListingProductConfig.upsert.mockClear();
    await ensureListingProductDefaultsInTransaction(tx as never, 518);
    expect(listing.productConfig).toMatchObject({
      printsFramesOverride: false, digitalDownloadOverride: false,
      printsFrames: true, digitalDownload: false, customisePrints: true,
    });
    expect(listing.products.map((product) => product.productType)).toEqual(['physical']);
    expect(tx.etsyListingProductConfig.upsert).not.toHaveBeenCalled();
  });

  it.each(['printsFrames', 'digitalDownload', 'customisePrints'] as const)(
    'rejects enabling %s when it is disabled on the template', async (key) => {
      const { listing, tx } = setup();
      listing.ourCategory[key] = false;
      await expect(saveListingCustomisationSettings(context, { ...personalisation, [key]: true }))
        .rejects.toThrow('disabled on the assigned template');
      expect(tx.etsyListingProductConfig.upsert).not.toHaveBeenCalled();
    },
  );
});
