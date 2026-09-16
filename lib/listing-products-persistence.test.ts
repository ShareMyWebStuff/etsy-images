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
    const frameUpsert = vi.fn().mockResolvedValue({});
    const tx = {
      etsyListing: {
        findUnique: vi.fn().mockResolvedValue({
          id: 79,
          etsyId: '1234',
          title: 'Donkey set',
          localDirectoryName: 'Donkey-set',
          numberOfItems: 3,
          includeAllItems: false,
          etsyProductType: 'digital',
          productConfig: {
            listOnEtsy: false,
            digitalDownload: true,
            customTop: false,
            customBottom: false,
            returnPolicyId: null,
            sku: null,
          },
          sizeOptions: [{ sizeKey: 'a4', enabled: false }],
          frameOptions: [{ frameKey: 'black', enabled: true }],
          products: existingProducts,
        }),
        update: vi.fn().mockResolvedValue({}),
      },
      etsyListingProductConfig: { upsert: configUpsert },
      etsyListingSizeOption: {
        deleteMany: vi.fn().mockResolvedValue({ count: 0 }),
        upsert: vi.fn().mockResolvedValue({}),
      },
      etsyListingFrameOption: {
        deleteMany: vi.fn().mockResolvedValue({ count: 0 }),
        upsert: frameUpsert,
      },
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
      update: {
        listOnEtsy: true,
        digitalDownload: true,
        customTop: true,
        customBottom: true,
        returnPolicyId: null,
        sku: 'DONKEY-SET',
      },
    }));
    expect(frameUpsert).toHaveBeenCalledTimes(4);
    expect(frameUpsert.mock.calls.every(([call]) => call.update.enabled === false)).toBe(true);
    expect(productUpsert).toHaveBeenCalledTimes(1);
    expect(productUpsert).toHaveBeenCalledWith(expect.objectContaining({
      where: { listingId_productKey: { listingId: 79, productKey: 'digital' } },
      update: expect.objectContaining({ sku: 'DG-DONKEY-SET-79', productType: 'digital' }),
    }));
    const update = productUpsert.mock.calls[0][0].update;
    expect(update).not.toHaveProperty('etsyProductId');
    expect(update).not.toHaveProperty('etsyOfferingId');
  });
});
