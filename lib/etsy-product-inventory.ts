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

const SIZE_LABELS: Record<string, string> = {
  a4: 'A4',
  a3: 'A3',
  a2: 'A2',
  '8x10': '8 x 10',
  '11x14': '11 x 14',
  '12x16': '12 x 16',
  '16x20': '16 x 20',
  '18x24': '18 x 24',
  '20x28': '20 x 28',
  '24x36': '24 x 36',
};

const FRAME_LABELS: Record<string, string> = {
  no_frame: 'No Frame',
  black: 'Black',
  white: 'White',
  oak: 'Oak',
};

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
      concreteProducts.push({
        localProductKey: product.key,
        sku: product.sku,
        property_values: [
          { property_id: 513, property_name: 'Size', value_ids: [], values: [sizeLabel] },
          { property_id: 514, property_name: 'Frame', value_ids: [], values: [FRAME_LABELS[frameKey]] },
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

  if (concreteProducts.length === 0) {
    throw new Error('Select at least one physical Etsy product before syncing.');
  }

  return {
    concreteProducts,
    body: {
      products: concreteProducts.map(({ localProductKey: _localProductKey, ...product }) => product),
      price_on_property: [513, 514],
      quantity_on_property: [],
      // PrintShrimp matches one artwork SKU across every size and frame option.
      sku_on_property: [],
      readiness_state_on_property: [],
    },
  };
}

export function buildPersonalizationQuestions(customTop: boolean, customBottom: boolean) {
  const base = {
    question_type: 'text_input' as const,
    required: false,
    max_allowed_characters: 100,
    // Etsy requires an explicit zero to remove an existing add-on charge.
    add_on_price: 0,
  };
  return [
    customTop ? {
      ...base,
      question_text: 'Text for the top of the image',
      instructions: 'Enter the wording exactly as you would like it to appear at the top.',
    } : null,
    customBottom ? {
      ...base,
      question_text: 'Text for the bottom of the image',
      instructions: 'Enter the wording exactly as you would like it to appear at the bottom.',
    } : null,
  ].filter((question): question is NonNullable<typeof question> => question !== null);
}
