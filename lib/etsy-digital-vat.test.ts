import { describe, expect, it } from 'vitest';
import { digitalPriceExcludingUkVat, etsyMoneyToPence } from '@/lib/etsy-digital-vat';

describe('Etsy digital VAT prices', () => {
  it('converts VAT-inclusive UK buyer prices to the net Etsy listing price', () => {
    expect(digitalPriceExcludingUkVat(349)).toBe(291);
    expect(digitalPriceExcludingUkVat(499)).toBe(416);
    expect(digitalPriceExcludingUkVat(749)).toBe(624);
    expect(digitalPriceExcludingUkVat(1999)).toBe(1666);
  });

  it('rejects invalid amounts', () => {
    expect(() => digitalPriceExcludingUkVat(0)).toThrow(/positive whole number of pence/i);
    expect(() => digitalPriceExcludingUkVat(349.5)).toThrow(/positive whole number of pence/i);
  });

  it('reads the integer-pence price returned by Etsy', () => {
    expect(etsyMoneyToPence({ amount: 291, divisor: 100, currency_code: 'GBP' })).toBe(291);
    expect(etsyMoneyToPence({ amount: 349, divisor: 1000 })).toBe(35);
    expect(etsyMoneyToPence({ amount: 349, divisor: 0 })).toBeNull();
    expect(etsyMoneyToPence(null)).toBeNull();
  });
});
