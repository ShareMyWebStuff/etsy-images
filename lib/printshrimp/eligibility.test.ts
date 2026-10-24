import { describe, expect, it } from 'vitest';

import { isPrintShrimpPhysicalListing } from '@/lib/printshrimp/eligibility';

describe('PrintShrimp listing eligibility', () => {
  it('allows standard and customised physical prints', () => {
    expect(isPrintShrimpPhysicalListing({ syncVariants: ['print'] })).toBe(true);
    expect(isPrintShrimpPhysicalListing({ syncVariants: ['customised'] })).toBe(true);
    expect(isPrintShrimpPhysicalListing({ syncVariants: ['print', 'download'] })).toBe(true);
  });

  it('does not allow digital-only listings', () => {
    expect(isPrintShrimpPhysicalListing({ syncVariants: ['download'] })).toBe(false);
    expect(isPrintShrimpPhysicalListing({ syncVariants: [] })).toBe(false);
  });
});
