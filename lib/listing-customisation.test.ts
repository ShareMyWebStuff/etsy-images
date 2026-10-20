import { describe, expect, it } from 'vitest';
import { effectiveListingCustomisation } from '@/lib/listing-customisation';

describe('effective listing customisation', () => {
  it('lets a listing disable template-enabled options', () => {
    expect(effectiveListingCustomisation(
      { customisePrints: true, customTop: true, customBottom: true },
      { customisePrints: true, customTop: false, customBottom: true },
    )).toEqual({ customisePrints: true, customTop: false, customBottom: true });
  });

  it('never enables options which are disabled on the template', () => {
    expect(effectiveListingCustomisation(
      { customisePrints: true, customTop: true, customBottom: false },
      { customisePrints: true, customTop: true, customBottom: true },
    )).toEqual({ customisePrints: true, customTop: true, customBottom: false });
  });

  it('switches all text off when listing customisation is disabled', () => {
    expect(effectiveListingCustomisation(
      { customisePrints: true, customTop: true, customBottom: true },
      { customisePrints: false, customTop: true, customBottom: true },
    )).toEqual({ customisePrints: false, customTop: false, customBottom: false });
  });
});

