import { describe, expect, it } from 'vitest';
import { getEtsyListingDetails } from '@/lib/etsy-listing-details';

const listing = {
  title: 'Printed turtle art',
  description: 'A framed or unframed print.',
  quantity: 20,
  digitalTitle: 'Downloadable turtle art',
  digitalDescription: 'A set of digital files.',
  digitalQuantity: 100,
};

describe('Etsy listing details', () => {
  it('uses the Digital Download fields for a digital Etsy listing', () => {
    expect(getEtsyListingDetails('download', listing)).toEqual({
      title: 'Downloadable turtle art',
      description: 'A set of digital files.',
      quantity: 100,
      label: 'Digital Download',
    });
  });

  it('uses the Print fields for physical and current combined Etsy listings', () => {
    for (const type of ['physical', 'both'] as const) {
      expect(getEtsyListingDetails(type, listing)).toEqual({
        title: 'Printed turtle art',
        description: 'A framed or unframed print.',
        quantity: 20,
        label: 'Print',
      });
    }
  });
});
