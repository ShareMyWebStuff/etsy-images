export const ETSY_LISTING_SKU_MAX_LENGTH = 32;

function skuPart(value: string) {
  return value
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLocaleUpperCase()
    .replace(/[^A-Z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '');
}

function fitSku(prefix: string, suffix = '') {
  const suffixWithSeparator = suffix ? `_${suffix}` : '';
  const maximumPrefixLength = ETSY_LISTING_SKU_MAX_LENGTH - suffixWithSeparator.length;
  const fittedPrefix = prefix
    .slice(0, Math.max(1, maximumPrefixLength))
    .replace(/_+$/g, '') || 'LISTING';
  return `${fittedPrefix}${suffixWithSeparator}`;
}

export function createEtsyListingSku(input: {
  sectionName: string;
  listingName: string;
  listingId: number;
  usedSkus?: Iterable<string>;
}) {
  const sectionName = input.sectionName
    .replace(/\s+wall\s+art(?:\s+listings?)?\s*$/i, '')
    .replace(/\s+listings?\s*$/i, '');
  const prefix = [skuPart(sectionName), skuPart(input.listingName)]
    .filter(Boolean)
    .join('_') || `LISTING_${input.listingId}`;
  const usedSkus = new Set(Array.from(input.usedSkus ?? [], (sku) => sku.toLocaleUpperCase()));
  let candidate = fitSku(prefix);
  if (!usedSkus.has(candidate.toLocaleUpperCase())) return candidate;

  let attempt = 1;
  do {
    const suffix = attempt === 1 ? String(input.listingId) : `${input.listingId}_${attempt}`;
    candidate = fitSku(prefix, suffix);
    attempt += 1;
  } while (usedSkus.has(candidate.toLocaleUpperCase()));
  return candidate;
}
