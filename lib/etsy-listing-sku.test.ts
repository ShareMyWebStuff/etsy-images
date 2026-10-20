import { describe, expect, it, vi } from 'vitest';

import { formatEtsyListingSku, getOrCreateEtsyListingSku, isGeneratedEtsyListingSku } from '@/lib/etsy-listing-sku';

describe('Etsy listing SKU generation', () => {
  it('formats the database sequence as a six-digit SKU', () => {
    expect(formatEtsyListingSku(1)).toBe('SKU_000001');
    expect(formatEtsyListingSku(342)).toBe('SKU_000342');
  });

  it('recognises only the generated SKU format', () => {
    expect(isGeneratedEtsyListingSku('SKU_000001')).toBe(true);
    expect(isGeneratedEtsyListingSku('SKU_00001')).toBe(false);
    expect(isGeneratedEtsyListingSku('DINOSAUR_001')).toBe(false);
  });

  it('rejects values outside the six-digit sequence', () => {
    expect(() => formatEtsyListingSku(0)).toThrow(/between 1 and 999999/);
    expect(() => formatEtsyListingSku(1_000_000)).toThrow(/between 1 and 999999/);
  });

  it('reuses the listing allocation returned by the database', async () => {
    const upsert = vi.fn().mockResolvedValue({ sequenceNumber: 48 });
    await expect(getOrCreateEtsyListingSku({ etsySkuAllocation: { upsert } } as never, 502))
      .resolves.toBe('SKU_000048');
    expect(upsert).toHaveBeenCalledWith({
      where: { listingId: 502 },
      create: { listingId: 502 },
      update: {},
      select: { sequenceNumber: true },
    });
  });
});
