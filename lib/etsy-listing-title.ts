export const ETSY_TITLE_RULES = `ETSY TITLE CHARACTER RULES
Use each of &, %, :, and + at most once per title. Prefer the word "and" when another ampersand would be needed.
Use letters, numbers, punctuation, mathematical symbols, spaces, and the marks ™, ©, or ®. Do not include emojis or other decorative symbols in titles.
Keep each complete title at 140 characters or fewer, including spaces and punctuation.`;

/** Preserve the first restricted symbol and spell out later occurrences. */
export function normalizeEtsyListingTitle(value: string): string {
  const seen = new Set<string>();
  const replacements: Record<string, string> = {
    '&': ' and ', '%': ' percent ', ':': ' - ', '+': ' plus ',
  };
  return value.normalize('NFC')
    .replace(/[^\p{L}\p{Nd}\p{P}\p{Sm}\p{Zs}™©®]/gu, ' ')
    .replace(/[&%:+]/g, (character) => {
      if (seen.has(character)) return replacements[character];
      seen.add(character);
      return character;
    })
    .replace(/\s+/g, ' ')
    .trim();
}
