import { describe, expect, it } from 'vitest';
import {
  APP_SKU_MAX_LENGTH,
  buildEtsyInventoryPlan,
  buildPersonalizationQuestions,
  buildSingleDigitalInventoryBody,
  resolveEtsyListingMode,
} from '@/lib/etsy-product-inventory';

describe('Etsy product inventory', () => {
  it('maps digital, physical, and physical-with-download products to the Etsy contract', () => {
    expect(resolveEtsyListingMode('digital', true)).toEqual({ listingType: 'download', taxonomyId: 2078 });
    expect(resolveEtsyListingMode('physical', false)).toEqual({ listingType: 'physical', taxonomyId: 121 });
    expect(resolveEtsyListingMode('physical', true)).toEqual({ listingType: 'both', taxonomyId: 121 });
    expect(() => resolveEtsyListingMode('other', false)).toThrow('Unsupported Etsy product type');
  });

  it('expands a generic framed product into selected frame colours without exposing colour rows locally', () => {
    const plan = buildEtsyInventoryPlan([{
      key: 'a4:frame', productType: 'framed', sizeKey: 'a4', frameKey: 'frame',
      sku: 'WOODLAND-RHINOCEROSBEETLE', amountPence: 3499,
    }], ['black', 'white', 'oak'], 999, 12345);
    expect(plan.body.products).toHaveLength(3);
    expect(plan.body.products.map((product) => product.property_values[1].values[0])).toEqual(['Black', 'White', 'Oak']);
    expect(plan.body.products.every((product) => product.sku.length <= APP_SKU_MAX_LENGTH)).toBe(true);
    expect(plan.body.products.every((product) => product.sku === 'WOODLAND-RHINOCEROSBEETLE')).toBe(true);
    expect(plan.body.products.every((product) => product.offerings[0].price === 34.99)).toBe(true);
    expect(plan.body.products.every((product) => product.offerings[0].readiness_state_id === 12345)).toBe(true);
    expect(plan.body.readiness_state_on_property).toEqual([]);
    expect(plan.body.sku_on_property).toEqual([]);
  });

  it('creates a No Frame option and optional top/bottom questions with the configured fee', () => {
    const plan = buildEtsyInventoryPlan([{
      key: '20x28:no_frame', productType: 'unframed', sizeKey: '20x28', frameKey: 'no_frame',
      sku: 'PF-DONKEY-20X28-NF', amountPence: 3999,
    }], ['no_frame'], 10);
    expect(plan.body.products[0].property_values.map((value) => value.values[0])).toEqual(['20 x 28', 'No Frame']);
    const both = buildPersonalizationQuestions(true, true);
    expect(both).toHaveLength(2);
    expect(both.map((question) => question.question_text)).toEqual([
      'Text for the top of the image',
      'Text for the bottom of the image',
    ]);
    expect(both.every((question) => question.add_on_price === 0)).toBe(true);
    expect(buildPersonalizationQuestions(true, false)[0].add_on_price).toBe(0);
    expect(buildPersonalizationQuestions(false, true)[0].add_on_price).toBe(0);
    expect(buildPersonalizationQuestions(false, false)).toEqual([]);
  });

  it('keeps the priced digital product as a concrete option in a physical listing with downloads', () => {
    const plan = buildEtsyInventoryPlan([{
      key: 'digital', productType: 'digital', sizeKey: null, frameKey: null,
      sku: 'DG-DONKEY', amountPence: 349,
    }], ['black'], 999, 12345);
    expect(plan.body.products).toEqual([expect.objectContaining({
      sku: 'DG-DONKEY',
      property_values: [
        expect.objectContaining({ values: ['Digital Download'] }),
        expect.objectContaining({ values: ['No Frame'] }),
      ],
      offerings: [expect.objectContaining({ price: 3.49, readiness_state_id: 12345 })],
    })]);
  });

  it('builds the required one-product, no-variation inventory before a physical-to-download conversion', () => {
    const body = buildSingleDigitalInventoryBody({ sku: 'DG-DONKEY', amountPence: 499 }, 12, 67890);
    expect(body.products).toEqual([{
      sku: 'DG-DONKEY',
      offerings: [{ price: 4.99, quantity: 12, is_enabled: true, readiness_state_id: 67890 }],
      property_values: [],
    }]);
    expect(body.price_on_property).toEqual([]);
    expect(body.quantity_on_property).toEqual([]);
    expect(body.sku_on_property).toEqual([]);
  });
});
