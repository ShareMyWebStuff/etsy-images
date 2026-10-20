export const UK_DIGITAL_VAT_PERCENT = 20;

/**
 * Converts the intended VAT-inclusive UK buyer price into the net price that
 * Etsy expects for a digital listing. Etsy adds and remits the buyer's VAT.
 */
export function digitalPriceExcludingUkVat(amountIncludingVatPence: number) {
  if (!Number.isSafeInteger(amountIncludingVatPence) || amountIncludingVatPence <= 0) {
    throw new Error('The VAT-inclusive digital price must be a positive whole number of pence.');
  }

  return Math.max(1, Math.round(
    amountIncludingVatPence * 100 / (100 + UK_DIGITAL_VAT_PERCENT),
  ));
}

export function etsyMoneyToPence(value: unknown) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const money = value as { amount?: unknown; divisor?: unknown };
  if (typeof money.amount !== 'number' || typeof money.divisor !== 'number' || money.divisor <= 0) return null;
  const amountPence = Math.round(money.amount * 100 / money.divisor);
  return Number.isSafeInteger(amountPence) && amountPence > 0 ? amountPence : null;
}
