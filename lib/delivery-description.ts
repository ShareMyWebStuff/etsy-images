/** Internal ownership markers. They are removed before displaying or sending text to Etsy. */
export const MANAGED_DELIVERY_START = '<!-- etsy-listings:markets-delivery:v1:start -->';
export const MANAGED_DELIVERY_END = '<!-- etsy-listings:markets-delivery:v1:end -->';

/**
 * Application safety ceiling. Etsy's current OpenAPI description schema does not
 * publish maxLength; the API remains authoritative for validation of a request.
 */
export const MAX_ETSY_DESCRIPTION_LENGTH = 102_400;

/** Remove only complete sections carrying our exact internal ownership markers. */
export function stripManagedDeliverySection(description: string) {
  let result = '';
  let cursor = 0;
  while (cursor < description.length) {
    const start = description.indexOf(MANAGED_DELIVERY_START, cursor);
    if (start < 0) return result + description.slice(cursor);
    const end = description.indexOf(MANAGED_DELIVERY_END, start + MANAGED_DELIVERY_START.length);
    if (end < 0) return result + description.slice(cursor);
    // An incomplete/nested block has uncertain ownership: preserve it intact.
    const nested = description.indexOf(MANAGED_DELIVERY_START, start + MANAGED_DELIVERY_START.length);
    if (nested >= 0 && nested < end) return result + description.slice(cursor);
    result += description.slice(cursor, start);
    cursor = end + MANAGED_DELIVERY_END.length;
  }
  return result;
}

export function composeManagedDeliveryDescription(baseDescription: string, deliveryText: string, include: boolean) {
  const base = stripManagedDeliverySection(baseDescription);
  if (!include || !deliveryText.trim()) return base;
  if (deliveryText.includes(MANAGED_DELIVERY_START) || deliveryText.includes(MANAGED_DELIVERY_END)) {
    throw new Error('Delivery information contains a reserved description marker.');
  }
  return `${base}${MANAGED_DELIVERY_START}${base.length ? '\n\n' : ''}Delivery\n${deliveryText}${MANAGED_DELIVERY_END}`;
}

export function renderManagedDeliveryDescription(description: string) {
  let result = '';
  let cursor = 0;
  while (cursor < description.length) {
    const start = description.indexOf(MANAGED_DELIVERY_START, cursor);
    if (start < 0) return result + description.slice(cursor);
    const contentStart = start + MANAGED_DELIVERY_START.length;
    const end = description.indexOf(MANAGED_DELIVERY_END, contentStart);
    const nested = description.indexOf(MANAGED_DELIVERY_START, contentStart);
    if (end < 0 || (nested >= 0 && nested < end)) return result + description.slice(cursor);
    result += description.slice(cursor, start) + description.slice(contentStart, end);
    cursor = end + MANAGED_DELIVERY_END.length;
  }
  return result;
}

/**
 * Always compose from the separately stored base description, never from the last
 * Etsy response. Saving or syncing this rendered value back into the base would
 * lose ownership information and must be avoided.
 */
export function composeDeliveryDescription(baseDescription: string, deliveryText: string, include: boolean) {
  return renderManagedDeliveryDescription(composeManagedDeliveryDescription(baseDescription, deliveryText, include));
}

export function validateEtsyDescription(description: string) {
  if (Array.from(description).length > MAX_ETSY_DESCRIPTION_LENGTH) {
    throw new Error(`The complete description is longer than the application's ${MAX_ETSY_DESCRIPTION_LENGTH.toLocaleString('en-GB')} character limit. Shorten the base description or delivery information before syncing.`);
  }
}
