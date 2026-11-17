import { isEtsyFontStyleQuestion } from '@/lib/etsy-personalisation-font';
import { DEFAULT_PRINTSHRIMP_CUSTOM_FONT_ID, PRINTSHRIMP_CUSTOM_FONTS } from '@/lib/printshrimp/custom-fonts';

export type EtsyOrderType = 'Normal' | 'Customised' | 'In Error';

export function etsyOrderVariationPairs(raw: unknown) {
  const record = raw && typeof raw === 'object' ? raw as Record<string, unknown> : {};
  return (Array.isArray(record.variations) ? record.variations : []).flatMap((value) => {
    if (!value || typeof value !== 'object') return [];
    const pair = value as Record<string, unknown>;
    const name = pair.formatted_name ?? pair.property_name ?? pair.name;
    const text = pair.formatted_value ?? pair.value ?? pair.value_name;
    return typeof name === 'string' && typeof text === 'string' ? [{ name: name.trim(), value: text.trim() }] : [];
  });
}

export function getEtsyItemCustomisation(item: { rawJson: unknown; topText?: string | null; bottomText?: string | null }) {
  const pairs = etsyOrderVariationPairs(item.rawJson);
  const fontStyle = pairs.find((pair) => isEtsyFontStyleQuestion(pair.name))?.value ?? '';
  const border = /^(yes|true|with border)$/i.test(pairs.find((pair) => /^border$/i.test(pair.name))?.value ?? '');
  const hasText = Boolean(item.topText?.trim() || item.bottomText?.trim());
  const noCustomisation = /no\s*custom|^none$/i.test(fontStyle);
  const font = !fontStyle && hasText
    ? PRINTSHRIMP_CUSTOM_FONTS.find((choice) => choice.id === DEFAULT_PRINTSHRIMP_CUSTOM_FONT_ID)
    : !noCustomisation
      ? PRINTSHRIMP_CUSTOM_FONTS.find((choice) => fontStyle.toLocaleLowerCase().includes(choice.family.toLocaleLowerCase()))
      : null;
  const error = hasText && !font
    ? 'Custom text was supplied with an unsupported Font Style, or No Customisation was selected. Message the buyer on Etsy to confirm their font before creating this order.'
    : null;
  const orderType: EtsyOrderType = error ? 'In Error' : border || hasText ? 'Customised' : 'Normal';
  return { border, fontStyle: fontStyle || font?.family || 'No Customisation', fontId: font?.id ?? null, orderType, error };
}

export function getEtsyOrderType(items: Array<{ orderType: EtsyOrderType }>): EtsyOrderType {
  if (items.some((item) => item.orderType === 'In Error')) return 'In Error';
  return items.some((item) => item.orderType === 'Customised') ? 'Customised' : 'Normal';
}
