import { describe, expect, it } from 'vitest';
import {
  ETSY_PRODUCT_FRAMES,
  ETSY_PRODUCT_SIZES,
  buildListingProductDefinitions,
  buildListingProductTypeDefaults,
  validateListingProductsInput,
} from '@/lib/listing-products';

function validInput() {
  return {
    shopId: '1',
    sectionId: '2',
    subSectionId: '3',
    listingId: '4',
    listOnEtsy: true,
    digitalDownload: true,
    printsFrames: true,
    customTop: true,
    customBottom: true,
    customiseDigitalDownloads: false,
    customisePrints: true,
    downloadSectionId: 123456,
    returnPolicyId: '12345',
    sizes: Object.fromEntries(ETSY_PRODUCT_SIZES.map(({ key }) => [key, true])),
    frames: Object.fromEntries(ETSY_PRODUCT_FRAMES.map(({ key }) => [key, key !== 'no_frame'])),
    skus: {},
  };
}

describe('listing Etsy product configuration', () => {
  it('uses clean, type-specific defaults when a rerun changes product type', () => {
    const digital = buildListingProductTypeDefaults('digital');
    expect(digital).toMatchObject({
      listOnEtsy: true,
      digitalDownload: true,
      printsFrames: true,
      customTop: true,
      customBottom: true,
      customiseDigitalDownloads: false,
      customisePrints: true,
      skus: {},
    });
    expect(Object.values(digital.sizes).every(Boolean)).toBe(true);
    expect(Object.values(digital.frames).some(Boolean)).toBe(false);

    const physical = buildListingProductTypeDefaults('physical');
    expect(physical).toMatchObject({
      listOnEtsy: true,
      digitalDownload: false,
      printsFrames: true,
      customTop: true,
      customBottom: true,
      customiseDigitalDownloads: false,
      customisePrints: true,
      frames: { no_frame: false, black: true, white: true, oak: true },
    });
    expect(Object.values(physical.sizes).every(Boolean)).toBe(true);
  });

  it('requires every exact size and frame key', () => {
    const input = validInput();
    delete input.sizes.a4;
    expect(() => validateListingProductsInput(input)).toThrow('Missing sizes option: a4.');

    const withUnknown = validInput();
    withUnknown.frames.gold = true;
    expect(() => validateListingProductsInput(withUnknown)).toThrow('Unknown frames option: gold.');
  });

  it('rejects unknown product keys and SKUs longer than Etsy allows', () => {
    expect(() => validateListingProductsInput({
      ...validInput(),
      skus: { unknown: 'SKU' },
    })).toThrow('Unknown product key: unknown.');
    expect(() => validateListingProductsInput({
      ...validInput(),
      skus: { digital: 'X'.repeat(33) },
    })).toThrow('cannot be longer than 32 characters');
  });

  it('accepts a numeric return policy id and rejects invalid values', () => {
    expect(validateListingProductsInput(validInput()).returnPolicyId).toBe('12345');
    expect(() => validateListingProductsInput({
      ...validInput(),
      returnPolicyId: 'not-an-id',
    })).toThrow('Choose a valid Etsy return policy.');
  });

  it('validates the digital-download customisation setting', () => {
    expect(validateListingProductsInput(validInput()).customiseDigitalDownloads).toBe(false);
    expect(validateListingProductsInput({ ...validInput(), customiseDigitalDownloads: true }).customiseDigitalDownloads).toBe(true);
    expect(() => validateListingProductsInput({
      ...validInput(),
      customiseDigitalDownloads: undefined as never,
    })).toThrow('Customise digital downloads must be true or false.');
  });

  it('defaults print customisation to on and validates explicit changes', () => {
    expect(validateListingProductsInput({ ...validInput(), customisePrints: undefined }).customisePrints).toBe(true);
    expect(validateListingProductsInput({ ...validInput(), customisePrints: false }).customisePrints).toBe(false);
    expect(() => validateListingProductsInput({ ...validInput(), customisePrints: 'off' as never }))
      .toThrow('Customise prints must be true or false.');
  });

  it('defaults Prints / Frames to on and validates explicit changes', () => {
    const input = validInput();
    expect(validateListingProductsInput({ ...input, printsFrames: undefined }).printsFrames).toBe(true);
    expect(validateListingProductsInput({ ...input, printsFrames: false }).printsFrames).toBe(false);
    expect(() => validateListingProductsInput({ ...input, printsFrames: 'off' as never }))
      .toThrow('Prints / Frames must be true or false.');
  });

  it('keeps the digital product but excludes physical products when Prints / Frames is off', () => {
    const products = buildListingProductDefinitions(
      { numberOfItems: 1, includeAllItems: false },
      validateListingProductsInput({ ...validInput(), printsFrames: false })
    );
    expect(products.map((product) => product.productKey)).toEqual(['digital']);
  });

  it('requires a valid numeric Etsy download section when one is selected', () => {
    expect(validateListingProductsInput(validInput()).downloadSectionId).toBe(123456);
    expect(() => validateListingProductsInput({ ...validInput(), downloadSectionId: -1 }))
      .toThrow('Choose a valid Etsy download section.');
    expect(() => validateListingProductsInput({ ...validInput(), downloadSectionId: 1.5 }))
      .toThrow('Choose a valid Etsy download section.');
  });

  it('creates one digital row and one generic framed row per selected size', () => {
    const config = validateListingProductsInput(validInput());
    const products = buildListingProductDefinitions(
      { numberOfItems: 6, includeAllItems: false },
      config
    );

    expect(products).toHaveLength(11);
    expect(products[0]).toMatchObject({ productKey: 'digital', priceKey: 'digital_6' });
    expect(products.filter(({ frameKey }) => frameKey === 'frame')).toHaveLength(10);
    expect(products.some(({ productKey }) => productKey.startsWith('unframed_'))).toBe(false);
  });

  it('uses the complete-set price and adds unframed rows only when No Frame is enabled', () => {
    const input = validInput();
    input.frames.no_frame = true;
    input.frames.black = false;
    input.frames.white = false;
    input.frames.oak = false;
    const products = buildListingProductDefinitions(
      { numberOfItems: null, includeAllItems: true },
      validateListingProductsInput(input)
    );

    expect(products[0]).toMatchObject({ productKey: 'digital', priceKey: 'digital_complete' });
    expect(products.filter(({ frameKey }) => frameKey === 'no_frame')).toHaveLength(10);
    expect(products.some(({ frameKey }) => frameKey === 'frame')).toBe(false);
  });

  it('falls back to the one-download price for legacy item counts', () => {
    const products = buildListingProductDefinitions(
      { numberOfItems: null, includeAllItems: false },
      validateListingProductsInput(validInput())
    );
    expect(products[0]).toMatchObject({ productKey: 'digital', priceKey: 'digital_1' });
  });
});
