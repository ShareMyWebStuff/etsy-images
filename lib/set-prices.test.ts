import { describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/prisma', () => ({ prisma: {} }));
vi.mock('@/lib/local-listings', () => ({
  EtsyVariationNotFoundError: class EtsyVariationNotFoundError extends Error {},
  updateEtsyListingPrice: vi.fn(),
  updateEtsyListingVariationPrices: vi.fn(),
}));

import { buildImpactPlans, ensureDefaultPrices, getPhysicalDeliveryWarnings } from '@/lib/set-prices';
import { PRICE_OPTIONS } from '@/lib/set-prices-core';

describe('Set Prices initialisation', () => {
  it('adds only missing defaults and remains safe to run repeatedly', async () => {
    const stored = new Map<string, number>([['digital_1', 777]]);
    const createMany = vi.fn(async ({ data, skipDuplicates }: { data: Array<{ productKey: string; amountPence: number }>; skipDuplicates: boolean }) => {
      for (const row of data) {
        if (!stored.has(row.productKey) || !skipDuplicates) stored.set(row.productKey, row.amountPence);
      }
      return { count: data.length };
    });
    const fakeClient = { adminProductPrice: { createMany } };

    await ensureDefaultPrices(fakeClient);
    await ensureDefaultPrices(fakeClient);

    expect(stored.size).toBe(26);
    expect(stored.get('digital_1')).toBe(777);
    expect(stored.get('framed_24x36')).toBe(10999);
    expect(stored.get('customisation_fee')).toBe(499);
    expect(createMany).toHaveBeenCalledTimes(2);
    expect(createMany.mock.calls.every(([args]) => args.skipDuplicates)).toBe(true);
  });
});

describe('Set Prices Etsy mapping', () => {
  const listing = (overrides: Record<string, unknown> = {}) => ({
    id: 1,
    etsyId: '123',
    title: 'Listing',
    localDirectoryName: 'Listing',
    rawJson: { listing_type: 'download' },
    shopId: '1',
    etsyProductType: 'digital',
    numberOfItems: 3,
    includeAllItems: false,
    productConfig: { digitalDownload: true },
    products: [{ productType: 'digital', priceKey: 'digital_3' }],
    files: [{ id: 1 }],
    subSection: { shopSection: { numberOfDownloads: 3, includeAllDownloads: false } },
    priceMappings: [],
    ...overrides,
  });

  it('updates only listings whose stable digital option changed', () => {
    expect(buildImpactPlans([listing()] as never, ['digital_3'])).toHaveLength(1);
    expect(buildImpactPlans([listing()] as never, ['digital_1'])).toHaveLength(0);
  });

  it('uses exact physical mapping keys and Etsy IDs', () => {
    const plans = buildImpactPlans([listing({
      rawJson: { listing_type: 'physical' },
      files: [],
      priceMappings: [{
        productKey: 'framed_a4',
        etsyProductId: 'product-1',
        etsyOfferingId: 'offering-1',
        fulfilmentProvider: 'PrintShrimp',
        isSupported: true,
        shippingProfileId: 'shipping-1',
      }],
    })] as never, ['framed_a4']);
    expect(plans).toHaveLength(1);
    expect(plans[0]).toMatchObject({ keys: ['framed_a4'], canUpdate: true, skipReason: null });
  });

  it('uses the mapped digital variation for a combined physical and download listing', () => {
    const combined = listing({
      etsyProductType: 'physical',
      productConfig: { digitalDownload: true },
      products: [{ productType: 'digital', priceKey: 'digital_3' }],
      priceMappings: [{
        productKey: 'digital_3',
        etsyProductId: 'digital-product',
        etsyOfferingId: 'digital-offering',
        fulfilmentProvider: 'Etsy inventory',
        isSupported: true,
        shippingProfileId: 'shipping-1',
      }],
    });
    expect(buildImpactPlans([combined] as never, ['digital_3'])[0]).toMatchObject({
      keys: ['digital_3'],
      canUpdate: true,
      skipReason: null,
    });
  });

  it('skips unsupported sizes and missing Etsy variations without guessing', () => {
    const unsupported = buildImpactPlans([listing({
      rawJson: { listing_type: 'physical' }, files: [],
      priceMappings: [{ productKey: 'unframed_a2', etsyProductId: '1', etsyOfferingId: '2', fulfilmentProvider: 'Provider', isSupported: false, shippingProfileId: null }],
    })] as never, ['unframed_a2'])[0];
    const missing = buildImpactPlans([listing({
      rawJson: { listing_type: 'physical' }, files: [],
      priceMappings: [{ productKey: 'framed_a3', etsyProductId: null, etsyOfferingId: null, fulfilmentProvider: 'Provider', isSupported: true, shippingProfileId: null }],
    })] as never, ['framed_a3'])[0];
    expect(unsupported.canUpdate).toBe(false);
    expect(unsupported.skipReason).toMatch(/does not support/i);
    expect(missing.canUpdate).toBe(false);
    expect(missing.skipReason).toMatch(/not been mapped/i);
  });

  it('warns about missing or free physical delivery profiles without blocking local prices', () => {
    const missing = getPhysicalDeliveryWarnings(listing({
      rawJson: { listing_type: 'physical', shipping_profile_id: null },
      files: [],
      priceMappings: [{ productKey: 'framed_a4', shippingProfileId: null }],
    }) as never, ['framed_a4']);
    const free = getPhysicalDeliveryWarnings(listing({
      rawJson: {
        listing_type: 'physical',
        shipping_profile_id: 99,
        shipping_profile: { shipping_profile_destinations: [{ primary_cost: { amount: 0, divisor: 100 } }] },
      },
      files: [],
      priceMappings: [{ productKey: 'framed_a4', shippingProfileId: '99' }],
    }) as never, ['framed_a4']);
    expect(missing[0].message).toMatch(/no Etsy delivery profile/i);
    expect(free[0].message).toMatch(/free delivery/i);
  });

  it('does not perform Etsy operations during default initialisation', async () => {
    const etsy = await import('@/lib/local-listings');
    await ensureDefaultPrices({ adminProductPrice: { createMany: vi.fn().mockResolvedValue({ count: PRICE_OPTIONS.length }) } });
    expect(etsy.updateEtsyListingPrice).not.toHaveBeenCalled();
    expect(etsy.updateEtsyListingVariationPrices).not.toHaveBeenCalled();
  });
});
