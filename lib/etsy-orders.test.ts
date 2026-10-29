import { describe, expect, it } from 'vitest';

import {
  buildLocalListingHref,
  normalizePrintShrimpOrderSize,
  parseEtsyOrderTransaction,
  processingStatusForReceipt,
} from '@/lib/etsy-orders';

describe('Etsy order import helpers', () => {
  it('maps Etsy receipt states without reopening an already submitted order', () => {
    expect(processingStatusForReceipt({ status: 'paid', is_paid: true })).toBe('UNPROCESSED');
    expect(processingStatusForReceipt({ status: 'canceled', is_paid: true })).toBe('CANCELED');
    expect(processingStatusForReceipt({ status: 'completed', is_paid: true, is_shipped: true })).toBe('COMPLETED');
    expect(processingStatusForReceipt({ status: 'paid', is_paid: true }, 'SUBMITTED')).toBe('SUBMITTED');
  });

  it('normalizes supported Etsy size labels to PrintShrimp sizes', () => {
    expect(normalizePrintShrimpOrderSize('A1')).toBe('A1');
    expect(normalizePrintShrimpOrderSize('A4')).toBe('A4');
    expect(normalizePrintShrimpOrderSize('12 x 18 inches')).toBe('12x18');
    expect(normalizePrintShrimpOrderSize('50×70cm')).toBe('50x70cm');
    expect(normalizePrintShrimpOrderSize('9 x 12 inches')).toBeNull();
  });

  it('builds a local editor link from the linked sale item', () => {
    expect(buildLocalListingHref({
      id: 339,
      shopId: '66615491',
      subSectionId: 15,
      subSection: { shopSectionId: 10 },
    })).toBe('/listings/edit?shopId=66615491&sectionId=10&subSectionId=15&listingId=339');
  });

  it('extracts customised text, font, frame and quantity from Etsy variations', () => {
    const item = parseEtsyOrderTransaction({
      transaction_id: 123,
      listing_id: 456,
      title: 'Green Sea Turtle',
      quantity: 2,
      product_data: { sku: 'SEA_CREATURES_GREEN_SEA_TURTLE' },
      variations: [
        { formatted_name: 'Size', formatted_value: 'A3' },
        { formatted_name: 'Frame', formatted_value: 'White frame' },
        { formatted_name: 'Font Style', formatted_value: 'Fredoka - Bold & playful' },
        { formatted_name: 'Top Text', formatted_value: 'OLIVER' },
        { formatted_name: 'Bottom Text', formatted_value: 'MY ROOM' },
      ],
    });

    expect(item).toMatchObject({
      etsyTransactionId: 123n,
      etsyListingId: 456n,
      sku: 'SEA_CREATURES_GREEN_SEA_TURTLE',
      quantity: 2,
      size: 'A3',
      productType: 'Frame',
      frameColour: 'White',
      fontId: 'fredoka-bold',
      topText: 'OLIVER',
      bottomText: 'MY ROOM',
      isCustomised: true,
    });
  });

  it('keeps a no-customisation print as a standard item', () => {
    expect(parseEtsyOrderTransaction({
      transaction_id: '1',
      listing_id: '2',
      quantity: 1,
      variations: [
        { formatted_name: 'Size', formatted_value: '8 x 10 inches' },
        { formatted_name: 'Frame', formatted_value: 'No Frame' },
        { formatted_name: 'Font Style', formatted_value: 'No Customisation' },
      ],
    })).toMatchObject({ size: '8x10', productType: 'Print', frameColour: null, isCustomised: false });
  });

  it.each([
    { value: 'Top: OLIVER', topText: 'OLIVER', bottomText: null },
    { value: 'Bottom: MY ROOM', topText: null, bottomText: 'MY ROOM' },
    { value: 'Top: OLIVER\nBottom: MY ROOM', topText: 'OLIVER', bottomText: 'MY ROOM' },
    { value: 'Bottom: MY ROOM; Top: OLIVER', topText: 'OLIVER', bottomText: 'MY ROOM' },
    { value: 'top text: OLIVER | bottom text: MY ROOM', topText: 'OLIVER', bottomText: 'MY ROOM' },
    { value: '', topText: null, bottomText: null },
  ])('imports one-fee custom text: $value', ({ value, topText, bottomText }) => {
    expect(parseEtsyOrderTransaction({
      transaction_id: '1', listing_id: '2', quantity: 1,
      variations: [
        { formatted_name: 'Font Style', formatted_value: 'Caveat' },
        { formatted_name: 'Custom Text', formatted_value: value },
      ],
    })).toMatchObject({ topText, bottomText, fontId: 'caveat-bold', isCustomised: Boolean(topText || bottomText) });
  });

  it('keeps each imported text area within its 40 character limit', () => {
    expect(parseEtsyOrderTransaction({
      transaction_id: '1', listing_id: '2',
      variations: [{ formatted_name: 'Custom Text', formatted_value: `Top: ${'T'.repeat(41)}\nBottom: ${'B'.repeat(41)}` }],
    })).toMatchObject({ topText: 'T'.repeat(40), bottomText: 'B'.repeat(40) });
  });
});
