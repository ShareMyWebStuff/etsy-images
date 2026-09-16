export const PRICE_SECTIONS = [
  {
    key: 'digital',
    title: 'Digital Downloads',
    description: 'Base prices for downloadable Etsy listings.',
    options: [
      { key: 'digital_1', label: '1 Image Download', defaultAmountPence: 349 },
      { key: 'digital_3', label: '3 Downloads', defaultAmountPence: 499 },
      { key: 'digital_6', label: '6 Downloads', defaultAmountPence: 749 },
      { key: 'digital_12', label: '12 Downloads', defaultAmountPence: 999 },
      { key: 'digital_complete', label: 'Complete Set', defaultAmountPence: 1999 },
    ],
  },
  {
    key: 'unframed',
    title: 'Unframed Prints',
    description: 'Base product prices before Etsy delivery charges.',
    options: [
      { key: 'unframed_a4', label: 'A4', defaultAmountPence: 1599 },
      { key: 'unframed_a3', label: 'A3', defaultAmountPence: 1799 },
      { key: 'unframed_a2', label: 'A2', defaultAmountPence: 2599 },
      { key: 'unframed_8x10', label: '8 × 10 inches', defaultAmountPence: 1599 },
      { key: 'unframed_11x14', label: '11 × 14 inches', defaultAmountPence: 1999 },
      { key: 'unframed_12x16', label: '12 × 16 inches', defaultAmountPence: 2599 },
      { key: 'unframed_16x20', label: '16 × 20 inches', defaultAmountPence: 2899 },
      { key: 'unframed_18x24', label: '18 × 24 inches', defaultAmountPence: 3599 },
      { key: 'unframed_20x28', label: '20 × 28 inches', defaultAmountPence: 3999 },
      { key: 'unframed_24x36', label: '24 × 36 inches', defaultAmountPence: 4499 },
    ],
  },
  {
    key: 'framed',
    title: 'Framed Prints',
    description: 'Base product prices before Etsy delivery charges.',
    options: [
      { key: 'framed_a4', label: 'A4', defaultAmountPence: 3499 },
      { key: 'framed_a3', label: 'A3', defaultAmountPence: 4499 },
      { key: 'framed_a2', label: 'A2', defaultAmountPence: 6999 },
      { key: 'framed_8x10', label: '8 × 10 inches', defaultAmountPence: 3499 },
      { key: 'framed_11x14', label: '11 × 14 inches', defaultAmountPence: 3999 },
      { key: 'framed_12x16', label: '12 × 16 inches', defaultAmountPence: 4499 },
      { key: 'framed_16x20', label: '16 × 20 inches', defaultAmountPence: 5999 },
      { key: 'framed_18x24', label: '18 × 24 inches', defaultAmountPence: 7499 },
      { key: 'framed_20x28', label: '20 × 28 inches', defaultAmountPence: 8499 },
      { key: 'framed_24x36', label: '24 × 36 inches', defaultAmountPence: 10999 },
    ],
  },
  {
    key: 'customisation',
    title: 'Customisation',
    description: 'Fee for customising a listing.',
    options: [
      { key: 'customisation_fee', label: 'Fee', defaultAmountPence: 499 },
    ],
  },
] as const;

export type PriceCategory = (typeof PRICE_SECTIONS)[number]['key'];
export type ProductPriceKey = (typeof PRICE_SECTIONS)[number]['options'][number]['key'];

export const PRICE_OPTIONS = PRICE_SECTIONS.flatMap((section) =>
  section.options.map((option) => ({ ...option, category: section.key }))
);
export const PRICE_OPTION_BY_KEY = new Map<string, (typeof PRICE_OPTIONS)[number]>(
  PRICE_OPTIONS.map((option) => [option.key, option])
);
export const PHYSICAL_KEYS = new Set<ProductPriceKey>(
  PRICE_OPTIONS.filter((option) => option.category === 'unframed' || option.category === 'framed').map((option) => option.key)
);
export const ETSY_SYNCABLE_KEYS = new Set<ProductPriceKey>(
  PRICE_OPTIONS.filter((option) => option.category !== 'customisation').map((option) => option.key)
);

export function getDefaultPriceRows() {
  return PRICE_OPTIONS.map((option) => ({
    productKey: option.key,
    category: option.category,
    amountPence: option.defaultAmountPence,
    currencyCode: 'GBP',
  }));
}

export function validatePriceEntries(input: unknown) {
  if (!Array.isArray(input)) throw new Error('Submit every product price as a list.');
  const seen = new Set<string>();
  const normalized: Array<{ key: ProductPriceKey; amountPence: number }> = [];

  for (const entry of input) {
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) throw new Error('A submitted price is invalid.');
    const key = 'key' in entry && typeof entry.key === 'string' ? entry.key : '';
    const amountPence = 'amountPence' in entry ? entry.amountPence : null;
    if (!PRICE_OPTION_BY_KEY.has(key)) throw new Error(`Unknown product price key: ${key || 'missing'}.`);
    if (seen.has(key)) throw new Error(`The price for ${PRICE_OPTION_BY_KEY.get(key)!.label} was submitted more than once.`);
    if (!Number.isInteger(amountPence) || Number(amountPence) <= 0 || Number(amountPence) > 100_000_000) {
      throw new Error(`${PRICE_OPTION_BY_KEY.get(key)!.label} must be a positive GBP amount with no more than two decimal places.`);
    }
    seen.add(key);
    normalized.push({ key: key as ProductPriceKey, amountPence: Number(amountPence) });
  }

  if (seen.size !== PRICE_OPTIONS.length) throw new Error('Submit a valid price for every product option.');
  return normalized;
}

export function parseGbpInput(value: string) {
  const trimmed = value.trim();
  if (!/^\d+(?:\.\d{1,2})?$/.test(trimmed)) return null;
  const [pounds, pence = ''] = trimmed.split('.');
  const amount = Number(pounds) * 100 + Number(pence.padEnd(2, '0'));
  return Number.isSafeInteger(amount) && amount > 0 && amount <= 100_000_000 ? amount : null;
}

export function formatGbp(amountPence: number) {
  return (amountPence / 100).toFixed(2);
}

export function digitalPriceKeyForSection(numberOfDownloads: number, includeAllDownloads: boolean): ProductPriceKey | null {
  if (includeAllDownloads) return 'digital_complete';
  if (numberOfDownloads === 1) return 'digital_1';
  if (numberOfDownloads === 3) return 'digital_3';
  if (numberOfDownloads === 6) return 'digital_6';
  if (numberOfDownloads === 12) return 'digital_12';
  return null;
}
