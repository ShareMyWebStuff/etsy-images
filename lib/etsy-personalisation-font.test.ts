import { describe, expect, it } from 'vitest';

import { ETSY_FONT_STYLE_QUESTION_TEXT, isEtsyFontStyleQuestion } from './etsy-personalisation-font';
import { DEFAULT_PRINTSHRIMP_CUSTOM_FONT_ID, getPrintShrimpCustomFont } from './printshrimp/custom-fonts';

describe('Etsy font question labels', () => {
  it.each(['Font', 'Font Style', ' Font Style (default: Nunito) ', 'font style (DEFAULT: NUNITO)'])(
    'recognises the font field on existing and newly synced orders: %s', (label) => {
      expect(isEtsyFontStyleQuestion(label)).toBe(true);
    },
  );

  it.each(['', 'Font Size', 'Top Text', 'Font Style (default: Arial)', 'Custom Font Style'])(
    'does not treat another personalisation field as the font: %s', (label) => {
      expect(isEtsyFontStyleQuestion(label)).toBe(false);
    },
  );

  it('advertises the same default font used to fulfil orders', () => {
    const font = getPrintShrimpCustomFont(DEFAULT_PRINTSHRIMP_CUSTOM_FONT_ID)!;
    expect(ETSY_FONT_STYLE_QUESTION_TEXT).toBe(`Font Style (default: ${font.family})`);
  });
});
