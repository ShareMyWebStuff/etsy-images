import { ETSY_PRODUCT_SIZES } from '@/lib/listing-products';

export const ETSY_DIGITAL_PRINTS_TAXONOMY_ID = 2078;
export const ETSY_GICLEE_PRINTS_TAXONOMY_ID = 121;
export const APP_SKU_MAX_LENGTH = 32;

export function resolveEtsyListingMode(etsyProductType: string, digitalDownload: boolean) {
  if (etsyProductType === 'digital') {
    return { listingType: 'download' as const, taxonomyId: ETSY_DIGITAL_PRINTS_TAXONOMY_ID };
  }
  if (etsyProductType === 'physical') {
    return {
      listingType: digitalDownload ? 'both' as const : 'physical' as const,
      taxonomyId: ETSY_GICLEE_PRINTS_TAXONOMY_ID,
    };
  }
  throw new Error(`Unsupported Etsy product type: ${etsyProductType}.`);
}

// Keep Etsy's inventory variations in step with the sizes offered throughout
// the application. Etsy's variation text uses a plain `x`, while the UI uses
// the multiplication symbol for display.
const SIZE_LABELS: Record<string, string> = Object.fromEntries(
  ETSY_PRODUCT_SIZES.map(({ key, label }) => [key, label.replaceAll('×', 'x')]),
);

const FRAME_LABELS: Record<string, string> = {
  no_frame: 'No Frame',
  black: 'Black',
  white: 'White',
  oak: 'Oak',
};

const BORDER_LABELS = ['No', 'Yes'] as const;

export type LocalSellableProduct = {
  key: string;
  productType: string;
  sizeKey: string | null;
  frameKey: string | null;
  sku: string;
  amountPence: number;
};

export type EtsyInventoryProduct = {
  sku: string;
  property_values: Array<{
    property_id: number;
    property_name: string;
    value_ids: number[];
    values: string[];
  }>;
  offerings: Array<{
    price: number;
    quantity: number;
    is_enabled: boolean;
    readiness_state_id?: number;
  }>;
};

export function buildSingleDigitalInventoryBody(
  product: Pick<LocalSellableProduct, 'sku' | 'amountPence'>,
  quantity: number,
  readinessStateId?: number
) {
  return {
    products: [{
      sku: product.sku,
      offerings: [{
        price: product.amountPence / 100,
        quantity: Math.max(1, Math.trunc(quantity || 1)),
        is_enabled: true,
        ...(readinessStateId === undefined ? {} : { readiness_state_id: readinessStateId }),
      }],
      property_values: [],
    }],
    price_on_property: [],
    quantity_on_property: [],
    sku_on_property: [],
    readiness_state_on_property: [],
  };
}

export function buildEtsyInventoryPlan(
  products: LocalSellableProduct[],
  enabledFrameKeys: string[],
  quantity: number,
  readinessStateId?: number
) {
  const concreteProducts: Array<EtsyInventoryProduct & { localProductKey: string }> = [];
  const activeColours = enabledFrameKeys.filter((key) => key !== 'no_frame' && FRAME_LABELS[key]);

  for (const product of products) {
    if (product.productType === 'digital') {
      concreteProducts.push({
        localProductKey: product.key,
        sku: product.sku,
        property_values: [
          { property_id: 513, property_name: 'Size', value_ids: [], values: ['Digital Download'] },
          { property_id: 514, property_name: 'Frame', value_ids: [], values: ['No Frame'] },
          { property_id: 516, property_name: 'Border', value_ids: [], values: ['No'] },
        ],
        offerings: [{
          price: product.amountPence / 100,
          quantity: Math.max(1, Math.trunc(quantity || 1)),
          is_enabled: true,
          ...(readinessStateId === undefined ? {} : { readiness_state_id: readinessStateId }),
        }],
      });
      continue;
    }
    if (!product.sizeKey) continue;
    const frameKeys = product.frameKey === 'frame'
      ? activeColours
      : product.frameKey === 'no_frame'
        ? ['no_frame']
        : [];
    for (const frameKey of frameKeys) {
      const sizeLabel = SIZE_LABELS[product.sizeKey];
      if (!sizeLabel) throw new Error(`Unsupported Etsy product size: ${product.sizeKey}.`);
      for (const borderLabel of BORDER_LABELS) {
        concreteProducts.push({
          localProductKey: product.key,
          sku: product.sku,
          property_values: [
            { property_id: 513, property_name: 'Size', value_ids: [], values: [sizeLabel] },
            { property_id: 514, property_name: 'Frame', value_ids: [], values: [FRAME_LABELS[frameKey]] },
            { property_id: 516, property_name: 'Border', value_ids: [], values: [borderLabel] },
          ],
          offerings: [{
            price: product.amountPence / 100,
            quantity: Math.max(1, Math.trunc(quantity || 1)),
            is_enabled: true,
            ...(readinessStateId === undefined ? {} : { readiness_state_id: readinessStateId }),
          }],
        });
      }
    }
  }

  if (concreteProducts.length === 0) {
    throw new Error('Select at least one physical Etsy product before syncing.');
  }

  return {
    concreteProducts,
    body: {
      products: concreteProducts.map(({ localProductKey: _localProductKey, ...product }) => product),
      // Etsy requires zero, one, or all three property ids here when a listing
      // uses three variations. Border has the same price for No and Yes.
      price_on_property: [513, 514, 516],
      quantity_on_property: [],
      // PrintShrimp matches one artwork SKU across every size and frame option.
      sku_on_property: [],
      readiness_state_on_property: [],
    },
  };
}

export const ETSY_PERSONALISATION_FONT_OPTIONS = [
  'No Customisation',
  'Nunito',
  'Fredoka',
  'Quicksand',
  'Patrick Hand',
  'Caveat',
  'Sacramento',
] as const;

export function buildPersonalizationQuestions(
  customisePrints: boolean,
  customTop: boolean,
  customBottom: boolean,
  customisationFeePence: number,
) {
  if (!customisePrints || (!customTop && !customBottom)) return [];
  if (!Number.isSafeInteger(customisationFeePence) || customisationFeePence < 0) {
    throw new Error('Set a valid customisation fee on the Set Prices page before syncing.');
  }

  const textInputBase = {
    question_type: 'text_input' as const,
    required: false,
    max_allowed_characters: 40,
    add_on_price: customisationFeePence / 100,
  };
  return [
    {
      question_type: 'dropdown' as const,
      question_text: 'Font Style',
      required: true,
      options: ETSY_PERSONALISATION_FONT_OPTIONS.map((label) => ({ label })),
    },
    customTop && customBottom ? {
      ...textInputBase,
      question_text: 'Custom Text',
      max_allowed_characters: 100,
      instructions: 'Use Top: and/or Bottom: before your wording on separate lines. Max 40 characters each. One fee; leave blank for none.',
    } : customTop ? {
      ...textInputBase,
      question_text: 'Top Text',
      instructions: 'Enter the wording exactly as you would like it to appear at the top.',
    } : null,
    !customTop && customBottom ? {
      ...textInputBase,
      question_text: 'Bottom Text',
      instructions: 'Enter the wording exactly as you would like it to appear at the bottom.',
    } : null,
  ].filter((question): question is NonNullable<typeof question> => question !== null);
}
