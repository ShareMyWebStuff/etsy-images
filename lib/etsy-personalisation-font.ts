export const ETSY_FONT_STYLE_QUESTION_TEXT = 'Font Style (default: Nunito)';

/** Etsy orders retain the question label used when the buyer placed the order. */
export function isEtsyFontStyleQuestion(name: string) {
  return /^font(?:\s+style)?(?:\s*\(default:\s*nunito\))?$/i.test(name.trim());
}
