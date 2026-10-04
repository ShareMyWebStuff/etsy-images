export const PRINTSHRIMP_CUSTOM_FONTS = [
  {
    id: 'nunito-semibold',
    label: 'Nunito — Clean & rounded (SemiBold 600)',
    family: 'Nunito',
    weight: 600,
    relativePath: ['nunito', 'Nunito-Regular.ttf'],
  },
  {
    id: 'fredoka-bold',
    label: 'Fredoka — Bold & playful (Bold 700)',
    family: 'Fredoka',
    weight: 700,
    relativePath: ['fredoka', 'Fredoka-Bold.ttf'],
  },
  {
    id: 'quicksand-semibold',
    label: 'Quicksand — Soft & modern (SemiBold 600)',
    family: 'Quicksand',
    weight: 600,
    relativePath: ['quicksand', 'Quicksand-Regular.ttf'],
  },
  {
    id: 'patrick-hand-regular',
    label: 'Patrick Hand — Neat handwriting (Regular 400)',
    family: 'Patrick Hand',
    weight: 400,
    relativePath: ['patrickhand', 'PatrickHand-Regular.ttf'],
  },
  {
    id: 'caveat-bold',
    label: 'Caveat — Relaxed handwriting (Bold 700)',
    family: 'Caveat',
    weight: 700,
    relativePath: ['caveat', 'Caveat-Regular.ttf'],
  },
  {
    id: 'sacramento-regular',
    label: 'Sacramento — Elegant script (Regular 400)',
    family: 'Sacramento',
    weight: 400,
    relativePath: ['sacramento', 'Sacramento-Regular.ttf'],
  },
] as const;

export type PrintShrimpCustomFontId = typeof PRINTSHRIMP_CUSTOM_FONTS[number]['id'];

export function getPrintShrimpCustomFont(value: unknown) {
  return PRINTSHRIMP_CUSTOM_FONTS.find((font) => font.id === value) ?? null;
}
