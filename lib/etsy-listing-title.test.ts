import { describe, expect, it } from 'vitest';
import { normalizeEtsyListingTitle } from '@/lib/etsy-listing-title';

describe('Etsy title character rules', () => {
  it('keeps the subject ampersand and spells out a second ampersand', () => {
    expect(normalizeEtsyListingTitle('Mr & Mrs Scarecrow Print | Nursery Wall Art | Unframed & Framed Options'))
      .toBe('Mr & Mrs Scarecrow Print | Nursery Wall Art | Unframed and Framed Options');
  });

  it('limits every restricted symbol to one occurrence without joining words', () => {
    const title = normalizeEtsyListingTitle('A&B&C: Print: Framed + Unframed + Digital | 10% or 20%');
    expect(title).toBe('A&B and C: Print - Framed + Unframed plus Digital | 10% or 20 percent');
    for (const symbol of ['&', '%', ':', '+']) expect([...title].filter((character) => character === symbol)).toHaveLength(1);
  });

  it('preserves valid Unicode text and punctuation while removing decorative symbols', () => {
    expect(normalizeEtsyListingTitle('  Cafe\u0301 🌻 Print\nScarecrow’s × 打印 ™ © ®  '))
      .toBe('Café Print Scarecrow’s × 打印 ™ © ®');
  });

  it('leaves a valid title unchanged and is safe to apply repeatedly', () => {
    const valid = 'Mr & Mrs Scarecrow: Nursery Print + Frame 10%';
    expect(normalizeEtsyListingTitle(valid)).toBe(valid);
    const corrected = normalizeEtsyListingTitle('Mr & Mrs Scarecrow | Unframed & Framed');
    expect(normalizeEtsyListingTitle(corrected)).toBe(corrected);
  });

  it('preserves overlong text so the caller can report the title length instead of silently truncating', () => {
    expect(normalizeEtsyListingTitle('A'.repeat(141))).toHaveLength(141);
  });
});
