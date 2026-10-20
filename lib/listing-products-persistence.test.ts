import { describe, expect, it, vi } from 'vitest';
import { ensureListingProductDefaultsInTransaction } from '@/lib/listing-products';

describe('multi-listing product type reconciliation', () => {
  it('resets an existing physical configuration to digital and derives its SKU from one listing SKU', async () => {
    const existingProducts = [
      {
        id: 10,
        listingId: 79,
        productKey: 'digital',
        productType: 'digital',
        sizeKey: null,
        frameKey: null,
        sku: 'DG-KEEP',
        priceKey: 'digital_3',
        position: 0,
        etsyListingId: '1234',
        etsyProductId: 'etsy-product-1',
        etsyOfferingId: 'etsy-offering-1',
      },
      {
        id: 11,
        listingId: 79,
        productKey: 'framed_a4',
        productType: 'physical',
        sizeKey: 'a4',
        frameKey: 'frame',
        sku: 'FR-A4-OLD',
        priceKey: 'framed_a4',
        position: 1,
        etsyListingId: '1234',
        etsyProductId: 'etsy-product-2',
        etsyOfferingId: 'etsy-offering-2',
      },
    ];
    const productFindMany = vi.fn()
      .mockResolvedValueOnce(existingProducts)
      .mockResolvedValueOnce([]);
    const productUpsert = vi.fn().mockResolvedValue({});
    const configUpsert = vi.fn().mockResolvedValue({});
    const tx = {
      etsyListing: {
        findUnique: vi.fn().mockResolvedValue({
          id: 79,
          etsyId: '1234',
          etsyDownloadId: '5678',
          title: 'Donkey set',
          localDirectoryName: 'Donkey-set',
          numberOfItems: 3,
          includeAllItems: false,
          etsyProductType: 'digital',
          productConfig: {
            listOnEtsy: false,
            digitalDownload: true,
            printsFrames: false,
            customTop: false,
            customBottom: false,
            customisePrints: false,
            giftMessageEnabled: true,
            downloadSectionId: 123456,
            returnPolicyId: null,
            sku: null,
          },
          ourCategory: {
            printsFrames: false,
            customisePrints: false,
            digitalDownload: true,
            customTop: true,
            customBottom: true,
            sizes: { a4: false },
            frames: { no_frame: false, black: false, white: false, oak: false },
            downloadSection: { etsyShopSectionId: 123456 },
          },
          products: existingProducts,
        }),
        update: vi.fn().mockResolvedValue({}),
      },
      etsySkuAllocation: { upsert: vi.fn().mockResolvedValue({ sequenceNumber: 1 }) },
      etsyListingProductConfig: { upsert: configUpsert },
      etsyListingProduct: {
        findMany: productFindMany,
        deleteMany: vi.fn().mockResolvedValue({ count: 1 }),
        update: vi.fn().mockResolvedValue({}),
        upsert: productUpsert,
      },
    };

    await ensureListingProductDefaultsInTransaction(
      tx as never,
      79,
      { resetToProductType: 'digital' },
    );

    expect(configUpsert).toHaveBeenCalledWith(expect.objectContaining({
      update: expect.objectContaining({
        listOnEtsy: true,
        digitalDownload: true,
        printsFrames: false,
        customTop: true,
        customBottom: true,
        customisePrints: false,
        giftMessageEnabled: false,
        downloadSectionId: 123456,
        returnPolicyId: null,
        sku: 'SKU_000001',
      }),
    }));
    expect(productUpsert).toHaveBeenCalledTimes(1);
    expect(productUpsert).toHaveBeenCalledWith(expect.objectContaining({
      where: { listingId_productKey: { listingId: 79, productKey: 'digital' } },
      update: expect.objectContaining({ sku: 'DG-SKU-000001-79', productType: 'digital', etsyListingId: '5678' }),
    }));
    const update = productUpsert.mock.calls[0][0].update;
    expect(update).not.toHaveProperty('etsyProductId');
    expect(update).not.toHaveProperty('etsyOfferingId');
  });

  it('rebuilds stale listing products from the assigned template product modes', async () => {
    const configUpsert = vi.fn().mockResolvedValue({});
    const productUpsert = vi.fn().mockResolvedValue({});
    const tx = {
      etsyListing: {
        findUnique: vi.fn().mockResolvedValue({
          id: 11,
          etsyId: '4592566093',
          etsyDownloadId: '4541724479',
          title: 'Albertosaurus',
          localDirectoryName: 'Albertosaurus',
          numberOfItems: 1,
          includeAllItems: false,
          etsyProductType: 'physical',
          productConfig: {
            listOnEtsy: true,
            digitalDownload: false,
            printsFrames: true,
            customTop: true,
            customBottom: true,
            customisePrints: true,
            giftMessageEnabled: false,
            downloadSectionId: 60449656,
            returnPolicyId: null,
            sku: 'DINOSAUR_ALBERTOSAURUS',
          },
          ourCategory: {
            printsFrames: true,
            customisePrints: true,
            digitalDownload: true,
            customTop: true,
            customBottom: true,
            sizes: { a4: true },
            frames: { no_frame: true, black: true, white: false, oak: false },
            downloadSection: { etsyShopSectionId: 60449656 },
          },
          products: [],
        }),
        update: vi.fn().mockResolvedValue({}),
      },
      etsySkuAllocation: { upsert: vi.fn().mockResolvedValue({ sequenceNumber: 11 }) },
      etsyListingProductConfig: { upsert: configUpsert },
      etsyListingProduct: {
        findMany: vi.fn().mockResolvedValue([]),
        deleteMany: vi.fn().mockResolvedValue({ count: 0 }),
        update: vi.fn().mockResolvedValue({}),
        upsert: productUpsert,
      },
    };

    await ensureListingProductDefaultsInTransaction(tx as never, 11);

    expect(configUpsert).toHaveBeenCalledWith(expect.objectContaining({
      update: expect.objectContaining({
        digitalDownload: true,
        printsFrames: true,
        customisePrints: true,
        downloadSectionId: 60449656,
      }),
    }));
    expect(productUpsert.mock.calls.some(([call]) => (
      call.where.listingId_productKey.productKey === 'digital'
      && call.update.productType === 'digital'
      && call.update.etsyListingId === '4541724479'
    ))).toBe(true);
    expect(productUpsert.mock.calls.some(([call]) => (
      call.where.listingId_productKey.productKey === 'unframed_a4'
      && call.update.frameKey === 'no_frame'
    ))).toBe(true);
    expect(productUpsert.mock.calls.some(([call]) => (
      call.where.listingId_productKey.productKey === 'framed_a4'
      && call.update.frameKey === 'frame'
    ))).toBe(true);
  });
});
