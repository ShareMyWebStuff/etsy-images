import { describe, expect, it } from 'vitest';

import {
  PRICE_OPTIONS,
  PRICE_SECTIONS,
  digitalPriceKeyForSection,
  formatGbp,
  getDefaultPriceRows,
  parseGbpInput,
  validatePriceEntries,
} from '@/lib/set-prices-core';

describe('Set Prices catalogue and validation', () => {
  it('defines all three sections and every requested stable product option', () => {
    expect(PRICE_SECTIONS.map((section) => section.title)).toEqual([
      'Digital Downloads',
      'Unframed Prints',
      'Framed Prints',
    ]);
    expect(PRICE_OPTIONS).toHaveLength(23);
    expect(new Set(PRICE_OPTIONS.map((option) => option.key)).size).toBe(23);
    expect(PRICE_OPTIONS.filter((option) => option.category === 'digital').map((option) => option.label)).toEqual([
      '1 Image Download', '3 Downloads', '6 Downloads', '12 Downloads', 'Complete Set',
    ]);
    expect(PRICE_OPTIONS.filter((option) => option.category === 'unframed').map((option) => option.label)).toContain('24 × 36 inches');
    expect(PRICE_OPTIONS.filter((option) => option.category === 'framed').map((option) => option.label)).toContain('24 × 36 inches');
  });

  it('uses the requested integer-pence defaults', () => {
    expect(Object.fromEntries(getDefaultPriceRows().map((row) => [row.productKey, row.amountPence]))).toMatchObject({
      digital_1: 349,
      digital_complete: 1999,
      unframed_a4: 1599,
      unframed_24x36: 4499,
      framed_a4: 3499,
      framed_a3: 4499,
      framed_a2: 6999,
      framed_8x10: 3499,
      framed_11x14: 3999,
      framed_12x16: 4499,
      framed_16x20: 5999,
      framed_18x24: 7499,
      framed_24x36: 10999,
    });
  });

  it('parses and formats GBP without floating-point storage', () => {
    expect(parseGbpInput('3.49')).toBe(349);
    expect(parseGbpInput('4.9')).toBe(490);
    expect(formatGbp(10999)).toBe('109.99');
    expect(parseGbpInput('0')).toBeNull();
    expect(parseGbpInput('-1.00')).toBeNull();
    expect(parseGbpInput('3.499')).toBeNull();
    expect(parseGbpInput('not money')).toBeNull();
  });

  it('validates a complete payload and rejects missing, duplicate, unknown, or invalid prices', () => {
    const valid = PRICE_OPTIONS.map((option) => ({ key: option.key, amountPence: option.defaultAmountPence }));
    expect(validatePriceEntries(valid)).toHaveLength(23);
    expect(() => validatePriceEntries(valid.slice(1))).toThrow(/every product option/i);
    expect(() => validatePriceEntries([...valid, valid[0]])).toThrow(/more than once/i);
    expect(() => validatePriceEntries(valid.map((entry, index) => index === 0 ? { key: 'unknown', amountPence: 1 } : entry))).toThrow(/unknown product/i);
    expect(() => validatePriceEntries(valid.map((entry, index) => index === 0 ? { ...entry, amountPence: 0 } : entry))).toThrow(/positive GBP/i);
  });

  it('maps digital listings by stable section download settings', () => {
    expect(digitalPriceKeyForSection(1, false)).toBe('digital_1');
    expect(digitalPriceKeyForSection(3, false)).toBe('digital_3');
    expect(digitalPriceKeyForSection(6, false)).toBe('digital_6');
    expect(digitalPriceKeyForSection(12, false)).toBe('digital_12');
    expect(digitalPriceKeyForSection(1, true)).toBe('digital_complete');
    expect(digitalPriceKeyForSection(2, false)).toBeNull();
  });
});
