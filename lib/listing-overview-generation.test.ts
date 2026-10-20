import { describe, expect, it } from 'vitest';

import { createListingOverviewFingerprint } from '@/lib/listing-overview-generation';

describe('createListingOverviewFingerprint', () => {
  it('is stable when object keys are supplied in a different order', () => {
    expect(createListingOverviewFingerprint({
      listing: { description: 'Friendly dinosaur', name: 'Allosaurus' },
      images: [{ id: 2, fileName: 'room.png' }],
    })).toBe(createListingOverviewFingerprint({
      images: [{ fileName: 'room.png', id: 2 }],
      listing: { name: 'Allosaurus', description: 'Friendly dinosaur' },
    }));
  });

  it('changes when a tracked listing or image value changes', () => {
    const original = createListingOverviewFingerprint({
      listing: { name: 'Allosaurus', description: 'Friendly dinosaur' },
      imageTemplate: { openingRegions: [{ id: 'area-1' }] },
    });

    expect(createListingOverviewFingerprint({
      listing: { name: 'Allosaurus', description: 'Brave dinosaur' },
      imageTemplate: { openingRegions: [{ id: 'area-1' }] },
    })).not.toBe(original);
    expect(createListingOverviewFingerprint({
      listing: { name: 'Allosaurus', description: 'Friendly dinosaur' },
      imageTemplate: { openingRegions: [{ id: 'area-2' }] },
    })).not.toBe(original);
  });
});
