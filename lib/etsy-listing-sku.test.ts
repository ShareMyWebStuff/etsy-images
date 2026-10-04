import { describe, expect, it } from 'vitest';

import { createEtsyListingSku } from '@/lib/etsy-listing-sku';

describe('Etsy listing SKU generation', () => {
  it('creates a readable SKU from the section and listing names', () => {
    expect(createEtsyListingSku({
      sectionName: 'Sea Creatures Wall Art Listings',
      listingName: 'Green Sea Turtle',
      listingId: 342,
    })).toBe('SEA_CREATURES_GREEN_SEA_TURTLE');
  });

  it('removes accents and unsupported characters and stays within 32 characters', () => {
    const sku = createEtsyListingSku({
      sectionName: 'Créatures très longues Wall Art',
      listingName: "Rory's exceptionally long turtle",
      listingId: 342,
    });
    expect(sku).toMatch(/^[A-Z0-9_]+$/);
    expect(sku.length).toBeLessThanOrEqual(32);
  });

  it('adds a stable listing suffix when the readable SKU is already used', () => {
    expect(createEtsyListingSku({
      sectionName: 'Sea Creatures Wall Art',
      listingName: 'Green Sea Turtle',
      listingId: 342,
      usedSkus: ['sea_creatures_green_sea_turtle'],
    })).toBe('SEA_CREATURES_GREEN_SEA_TURT_342');
  });
});
