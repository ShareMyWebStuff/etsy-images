import { Prisma } from '@prisma/client';
import { prisma } from '@/lib/prisma';
import { digitalPriceKeyForSection } from '@/lib/set-prices-core';

export const ETSY_PRODUCT_SIZES = [
  { key: 'a4', label: 'A4' },
  { key: 'a3', label: 'A3' },
  { key: 'a2', label: 'A2' },
  { key: '8x10', label: '8 × 10' },
  { key: '11x14', label: '11 × 14' },
  { key: '12x16', label: '12 × 16' },
  { key: '16x20', label: '16 × 20' },
  { key: '18x24', label: '18 × 24' },
  { key: '20x28', label: '20 × 28' },
  { key: '24x36', label: '24 × 36' },
] as const;

export const ETSY_PRODUCT_FRAMES = [
  { key: 'no_frame', label: 'No Frame', defaultEnabled: false },
  { key: 'black', label: 'Black', defaultEnabled: true },
  { key: 'white', label: 'White', defaultEnabled: true },
  { key: 'oak', label: 'Oak', defaultEnabled: true },
] as const;

export type EtsyProductSizeKey = (typeof ETSY_PRODUCT_SIZES)[number]['key'];
export type EtsyProductFrameKey = (typeof ETSY_PRODUCT_FRAMES)[number]['key'];

export type ListingProductsContext = {
  shopId: string;
  sectionId: string;
  subSectionId: string;
  listingId: string;
};

export type SaveListingProductsInput = ListingProductsContext & {
  listOnEtsy: boolean;
  digitalDownload: boolean;
  printsFrames?: boolean;
  customTop: boolean;
  customBottom: boolean;
  customiseDigitalDownloads: boolean;
  customisePrints?: boolean;
  downloadSectionId?: number | null;
  returnPolicyId?: string | null;
  sizes: Record<string, boolean>;
  frames: Record<string, boolean>;
  skus?: Record<string, string>;
};

export type ListingProductDefinition = {
  productKey: string;
  productType: 'digital' | 'physical';
  sizeKey: EtsyProductSizeKey | null;
  frameKey: 'no_frame' | 'frame' | null;
  priceKey: string;
  position: number;
};

type NormalizedListingProducts = {
  listOnEtsy: boolean;
  digitalDownload: boolean;
  printsFrames: boolean;
  customTop: boolean;
  customBottom: boolean;
  customiseDigitalDownloads: boolean;
  customisePrints: boolean;
  downloadSectionId: number | null;
  returnPolicyId: string | null;
  sizes: Record<EtsyProductSizeKey, boolean>;
  frames: Record<EtsyProductFrameKey, boolean>;
  skus: Record<string, string>;
};

export type ListingProductDefaultsOptions = {
  digitalDownload?: boolean;
  resetToProductType?: 'physical' | 'digital';
};

type ProductListing = {
  id: number;
  etsyId: string | null;
  etsyDownloadId: string | null;
  title: string;
  localDirectoryName: string | null;
  numberOfItems: number | null;
  includeAllItems: boolean;
  etsyProductType: string;
  productConfig?: { sku: string | null } | null;
};

const SIZE_KEYS = ETSY_PRODUCT_SIZES.map(({ key }) => key);
const FRAME_KEYS = ETSY_PRODUCT_FRAMES.map(({ key }) => key);
const ALL_PRODUCT_KEYS = new Set<string>([
  'digital',
  ...SIZE_KEYS.flatMap((sizeKey) => [`unframed_${sizeKey}`, `framed_${sizeKey}`]),
]);

export function buildListingProductTypeDefaults(
  etsyProductType: 'physical' | 'digital',
  skus: Record<string, string> = {},
): NormalizedListingProducts {
  return {
    listOnEtsy: true,
    digitalDownload: etsyProductType === 'digital',
    printsFrames: true,
    customTop: true,
    customBottom: true,
    customiseDigitalDownloads: false,
    customisePrints: true,
    downloadSectionId: null,
    returnPolicyId: null,
    sizes: Object.fromEntries(SIZE_KEYS.map((key) => [key, true])) as Record<EtsyProductSizeKey, boolean>,
    frames: Object.fromEntries(ETSY_PRODUCT_FRAMES.map(({ key, defaultEnabled }) => [
      key,
      etsyProductType === 'physical' ? defaultEnabled : false,
    ])) as Record<EtsyProductFrameKey, boolean>,
    skus,
  };
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function requireBoolean(value: unknown, label: string): boolean {
  if (typeof value !== 'boolean') throw new Error(`${label} must be true or false.`);
  return value;
}

function normalizeBooleanOptions<TKey extends string>(
  value: unknown,
  allowedKeys: readonly TKey[],
  label: string
): Record<TKey, boolean> {
  if (!isPlainRecord(value)) throw new Error(`${label} must contain every available option.`);
  const submittedKeys = Object.keys(value);
  const allowedKeySet = new Set<string>(allowedKeys);
  const unknownKey = submittedKeys.find((key) => !allowedKeySet.has(key));
  if (unknownKey) throw new Error(`Unknown ${label.toLocaleLowerCase()} option: ${unknownKey}.`);
  const missingKey = allowedKeys.find((key) => !Object.prototype.hasOwnProperty.call(value, key));
  if (missingKey) throw new Error(`Missing ${label.toLocaleLowerCase()} option: ${missingKey}.`);
  if (submittedKeys.length !== allowedKeys.length) throw new Error(`${label} must contain every available option exactly once.`);

  return Object.fromEntries(
    allowedKeys.map((key) => [key, requireBoolean(value[key], `${label} ${key}`)])
  ) as Record<TKey, boolean>;
}

export function validateListingProductsInput(input: SaveListingProductsInput): NormalizedListingProducts {
  const sizes = normalizeBooleanOptions(input.sizes, SIZE_KEYS, 'Sizes');
  const frames = normalizeBooleanOptions(input.frames, FRAME_KEYS, 'Frames');
  const skus: Record<string, string> = {};
  if (input.returnPolicyId !== null && input.returnPolicyId !== undefined && typeof input.returnPolicyId !== 'string') {
    throw new Error('Choose a valid Etsy return policy.');
  }
  const returnPolicyId = input.returnPolicyId?.trim() ?? '';
  if (input.downloadSectionId !== undefined && input.downloadSectionId !== null
    && (!Number.isSafeInteger(input.downloadSectionId) || input.downloadSectionId <= 0 || input.downloadSectionId > 2_147_483_647)) {
    throw new Error('Choose a valid Etsy download section.');
  }

  if (input.skus !== undefined) {
    if (!isPlainRecord(input.skus)) throw new Error('SKUs must be submitted by product key.');
    for (const [productKey, rawSku] of Object.entries(input.skus)) {
      if (!ALL_PRODUCT_KEYS.has(productKey)) throw new Error(`Unknown product key: ${productKey}.`);
      if (typeof rawSku !== 'string') throw new Error(`The SKU for ${productKey} must be text.`);
      const sku = rawSku.trim();
      if (Array.from(sku).length > 32) throw new Error(`The SKU for ${productKey} cannot be longer than 32 characters.`);
      skus[productKey] = sku;
    }
  }

  return {
    listOnEtsy: requireBoolean(input.listOnEtsy, 'List on Etsy'),
    digitalDownload: requireBoolean(input.digitalDownload, 'Digital Download'),
    printsFrames: input.printsFrames === undefined ? true : requireBoolean(input.printsFrames, 'Prints / Frames'),
    customTop: requireBoolean(input.customTop, 'Top customisation'),
    customBottom: requireBoolean(input.customBottom, 'Bottom customisation'),
    customiseDigitalDownloads: requireBoolean(input.customiseDigitalDownloads, 'Customise digital downloads'),
    customisePrints: input.customisePrints === undefined ? true : requireBoolean(input.customisePrints, 'Customise prints'),
    downloadSectionId: input.downloadSectionId ?? null,
    returnPolicyId: returnPolicyId === ''
      ? null
      : /^\d+$/.test(returnPolicyId)
        ? returnPolicyId
        : (() => { throw new Error('Choose a valid Etsy return policy.'); })(),
    sizes,
    frames,
    skus,
  };
}

export function buildListingProductDefinitions(
  listing: Pick<ProductListing, 'numberOfItems' | 'includeAllItems'>,
  config: Pick<NormalizedListingProducts, 'digitalDownload' | 'printsFrames' | 'sizes' | 'frames'>
): ListingProductDefinition[] {
  const products: ListingProductDefinition[] = [];
  let position = 0;

  if (config.digitalDownload) {
    const digitalPriceKey = digitalPriceKeyForSection(
      listing.numberOfItems ?? 1,
      listing.includeAllItems
    ) ?? 'digital_1';
    products.push({
      productKey: 'digital',
      productType: 'digital',
      sizeKey: null,
      frameKey: null,
      priceKey: digitalPriceKey,
      position: position++,
    });
  }

  if (!config.printsFrames) return products;

  const framedEnabled = config.frames.black || config.frames.white || config.frames.oak;
  for (const { key: sizeKey } of ETSY_PRODUCT_SIZES) {
    if (!config.sizes[sizeKey]) continue;
    if (config.frames.no_frame) {
      products.push({
        productKey: `unframed_${sizeKey}`,
        productType: 'physical',
        sizeKey,
        frameKey: 'no_frame',
        priceKey: `unframed_${sizeKey}`,
        position: position++,
      });
    }
    if (framedEnabled) {
      products.push({
        productKey: `framed_${sizeKey}`,
        productType: 'physical',
        sizeKey,
        frameKey: 'frame',
        priceKey: `framed_${sizeKey}`,
        position: position++,
      });
    }
  }

  return products;
}

function skuSlug(value: string) {
  return value
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLocaleUpperCase()
    .replace(/[^A-Z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '') || 'LISTING';
}

function fitSku(parts: string[], suffix: string) {
  const joinedPrefix = parts.filter(Boolean).join('-');
  const maximumPrefixLength = 32 - suffix.length - (suffix ? 1 : 0);
  const prefix = joinedPrefix.slice(0, Math.max(1, maximumPrefixLength)).replace(/-+$/g, '') || 'SKU';
  return suffix ? `${prefix}-${suffix}` : prefix;
}

function generatedSku(
  listing: Pick<ProductListing, 'id' | 'title' | 'localDirectoryName' | 'productConfig'>,
  product: ListingProductDefinition,
  usedSkus: Set<string>
) {
  const productPrefix = product.productType === 'digital'
    ? 'DG'
    : product.frameKey === 'frame' ? 'FR' : 'UF';
  const size = product.sizeKey?.toLocaleUpperCase() ?? '';
  const name = skuSlug(listing.productConfig?.sku ?? listing.localDirectoryName ?? listing.title);
  const stableSuffix = String(listing.id);
  let candidate = fitSku([productPrefix, size, name], stableSuffix);
  let attempt = 2;

  while (usedSkus.has(candidate.toLocaleLowerCase())) {
    candidate = fitSku([productPrefix, size, name], `${stableSuffix}-${attempt++}`);
  }
  return candidate;
}

async function persistListingProducts(
  tx: Prisma.TransactionClient,
  listing: ProductListing,
  config: NormalizedListingProducts
) {
  const definitions = buildListingProductDefinitions(listing, config);
  if (config.listOnEtsy && definitions.length === 0) {
    throw new Error('Select at least one Etsy product, or uncheck List this listing on Etsy.');
  }
  const [existingProducts, otherSkus] = await Promise.all([
    tx.etsyListingProduct.findMany({ where: { listingId: listing.id } }),
    tx.etsyListingProduct.findMany({
      where: { listingId: { not: listing.id } },
      select: { sku: true },
    }),
  ]);
  const existingByKey = new Map(existingProducts.map((product) => [product.productKey, product]));
  const usedSkus = new Set(otherSkus.map(({ sku }) => sku.toLocaleLowerCase()));
  const listingSku = listing.productConfig?.sku ?? skuSlug(listing.localDirectoryName ?? listing.title).slice(0, 32);
  const listingWithSku = { ...listing, productConfig: { sku: listingSku } };
  const desiredProducts = definitions.map((definition) => {
    const hasSubmittedSku = Object.prototype.hasOwnProperty.call(config.skus, definition.productKey);
    const submittedSku = hasSubmittedSku ? config.skus[definition.productKey] : undefined;
    const sku = submittedSku || generatedSku(listingWithSku, definition, usedSkus);
    const normalizedSku = sku.trim();

    if (!normalizedSku) throw new Error(`Enter an Etsy SKU for ${definition.productKey}.`);
    if (Array.from(normalizedSku).length > 32) {
      throw new Error(`The SKU for ${definition.productKey} cannot be longer than 32 characters.`);
    }
    if (usedSkus.has(normalizedSku.toLocaleLowerCase())) {
      throw new Error(`The Etsy SKU "${normalizedSku}" is already used by another product.`);
    }
    usedSkus.add(normalizedSku.toLocaleLowerCase());
    return { ...definition, sku: normalizedSku };
  });
  const desiredKeys = desiredProducts.map(({ productKey }) => productKey);

  await tx.etsyListingProductConfig.upsert({
    where: { listingId: listing.id },
    create: {
      listingId: listing.id,
      listOnEtsy: config.listOnEtsy,
      digitalDownload: config.digitalDownload,
      printsFrames: config.printsFrames,
      customTop: config.customTop,
      customBottom: config.customBottom,
      customiseDigitalDownloads: config.customiseDigitalDownloads,
      customisePrints: config.customisePrints,
      downloadSectionId: config.downloadSectionId,
      returnPolicyId: config.returnPolicyId,
      sku: listingSku,
    },
    update: {
      listOnEtsy: config.listOnEtsy,
      digitalDownload: config.digitalDownload,
      printsFrames: config.printsFrames,
      customTop: config.customTop,
      customBottom: config.customBottom,
      customiseDigitalDownloads: config.customiseDigitalDownloads,
      customisePrints: config.customisePrints,
      downloadSectionId: config.downloadSectionId,
      returnPolicyId: config.returnPolicyId,
      sku: listingSku,
    },
  });

  await tx.etsyListingSizeOption.deleteMany({
    where: { listingId: listing.id, sizeKey: { notIn: SIZE_KEYS } },
  });
  for (const [position, sizeKey] of SIZE_KEYS.entries()) {
    await tx.etsyListingSizeOption.upsert({
      where: { listingId_sizeKey: { listingId: listing.id, sizeKey } },
      create: { listingId: listing.id, sizeKey, enabled: config.sizes[sizeKey], position },
      update: { enabled: config.sizes[sizeKey], position },
    });
  }

  await tx.etsyListingFrameOption.deleteMany({
    where: { listingId: listing.id, frameKey: { notIn: FRAME_KEYS } },
  });
  for (const [position, frameKey] of FRAME_KEYS.entries()) {
    await tx.etsyListingFrameOption.upsert({
      where: { listingId_frameKey: { listingId: listing.id, frameKey } },
      create: { listingId: listing.id, frameKey, enabled: config.frames[frameKey], position },
      update: { enabled: config.frames[frameKey], position },
    });
  }

  if (desiredKeys.length > 0) {
    await tx.etsyListingProduct.deleteMany({
      where: { listingId: listing.id, productKey: { notIn: desiredKeys } },
    });
  } else {
    await tx.etsyListingProduct.deleteMany({ where: { listingId: listing.id } });
  }

  for (const product of desiredProducts) {
    const existing = existingByKey.get(product.productKey);
    if (!existing || existing.sku.toLocaleLowerCase() === product.sku.toLocaleLowerCase()) continue;
    let temporarySku = `TMP-${listing.id}-${existing.id}`;
    let attempt = 2;
    while (usedSkus.has(temporarySku.toLocaleLowerCase())) {
      temporarySku = fitSku(['TMP', String(listing.id), String(existing.id)], String(attempt++));
    }
    usedSkus.add(temporarySku.toLocaleLowerCase());
    await tx.etsyListingProduct.update({
      where: { id: existing.id },
      data: { sku: temporarySku },
    });
  }

  for (const product of desiredProducts) {
    const existing = existingByKey.get(product.productKey);
    await tx.etsyListingProduct.upsert({
      where: { listingId_productKey: { listingId: listing.id, productKey: product.productKey } },
      create: {
        listingId: listing.id,
        productKey: product.productKey,
        productType: product.productType,
        sizeKey: product.sizeKey,
        frameKey: product.frameKey,
        sku: product.sku,
        priceKey: product.priceKey,
        position: product.position,
        etsyListingId: product.productType === 'digital' ? listing.etsyDownloadId : listing.etsyId,
        etsyProductId: existing?.etsyProductId ?? null,
        etsyOfferingId: existing?.etsyOfferingId ?? null,
      },
      update: {
        productType: product.productType,
        sizeKey: product.sizeKey,
        frameKey: product.frameKey,
        sku: product.sku,
        priceKey: product.priceKey,
        position: product.position,
        etsyListingId: product.productType === 'digital' ? listing.etsyDownloadId : listing.etsyId,
      },
    });
  }

  await tx.etsyListing.update({
    where: { id: listing.id },
    data: {
      productsChanged: true,
      lastLocalChangeAt: new Date(),
      ...(definitions.some((product) => product.productType === 'physical')
        ? { etsyProductType: 'physical', taxonomyId: 121 }
        : definitions.some((product) => product.productType === 'digital')
          ? { etsyProductType: 'digital', taxonomyId: 2078 }
          : {}),
    },
  });
}

async function loadListingForContext(tx: Prisma.TransactionClient, context: ListingProductsContext) {
  const listingId = Number(context.listingId);
  const sectionId = Number(context.sectionId);
  const subSectionId = Number(context.subSectionId);
  if (!Number.isInteger(listingId) || !Number.isInteger(sectionId) || !Number.isInteger(subSectionId)) {
    throw new Error('Invalid listing context.');
  }
  let etsyShopId: bigint;
  try {
    etsyShopId = BigInt(context.shopId);
  } catch {
    throw new Error('Invalid shop id.');
  }

  const listing = await tx.etsyListing.findFirst({
    where: {
      id: listingId,
      subSectionId,
      subSection: {
        is: {
          shopSectionId: sectionId,
          shopSection: {
            is: {
              OR: [
                { etsyShopId },
                { shop: { is: { etsyShopId } } },
              ],
            },
          },
        },
      },
    },
    select: {
      id: true,
      etsyId: true,
      etsyDownloadId: true,
      title: true,
      localDirectoryName: true,
      numberOfItems: true,
      includeAllItems: true,
      etsyProductType: true,
      productConfig: { select: { sku: true } },
    },
  });
  if (!listing) throw new Error('Listing not found.');
  return listing;
}

export async function saveListingProducts(input: SaveListingProductsInput) {
  const config = validateListingProductsInput(input);
  try {
    await prisma.$transaction(async (tx) => {
      const listing = await loadListingForContext(tx, input);
      if (config.downloadSectionId !== null) {
        const section = await tx.etsyDownloadSection.findUnique({
          where: {
            etsyShopId_etsyShopSectionId: {
              etsyShopId: BigInt(input.shopId),
              etsyShopSectionId: config.downloadSectionId,
            },
          },
          select: { id: true },
        });
        if (!section) throw new Error('Choose a Download Section from this Etsy shop.');
      }
      await persistListingProducts(tx, listing, config);
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
      throw new Error('Each Etsy SKU must be unique. One of these SKUs is already in use.');
    }
    throw error;
  }
}

export async function saveListingSku(context: ListingProductsContext, value: string) {
  const sku = value.trim();
  if (!sku) throw new Error('Enter an Etsy SKU.');
  if (Array.from(sku).length > 32) throw new Error('The Etsy SKU cannot be longer than 32 characters.');

  try {
    await prisma.$transaction(async (tx) => {
      const listing = await loadListingForContext(tx, context);
      const configuration = await tx.etsyListing.findUnique({
        where: { id: listing.id },
        select: {
          productConfig: true,
          sizeOptions: true,
          frameOptions: true,
        },
      });
      if (!configuration?.productConfig) throw new Error('Save the Etsy Products options before setting the SKU.');
      await tx.etsyListingProductConfig.update({
        where: { listingId: listing.id },
        data: { sku },
      });
      await persistListingProducts(tx, { ...listing, productConfig: { sku } }, {
        listOnEtsy: configuration.productConfig.listOnEtsy,
        digitalDownload: configuration.productConfig.digitalDownload,
        printsFrames: configuration.productConfig.printsFrames,
        customTop: configuration.productConfig.customTop,
        customBottom: configuration.productConfig.customBottom,
        customiseDigitalDownloads: configuration.productConfig.customiseDigitalDownloads,
        customisePrints: configuration.productConfig.customisePrints,
        downloadSectionId: configuration.productConfig.downloadSectionId,
        returnPolicyId: configuration.productConfig.returnPolicyId,
        sizes: Object.fromEntries(SIZE_KEYS.map((key) => [
          key,
          configuration.sizeOptions.find((option) => option.sizeKey === key)?.enabled ?? true,
        ])) as Record<EtsyProductSizeKey, boolean>,
        frames: Object.fromEntries(ETSY_PRODUCT_FRAMES.map(({ key, defaultEnabled }) => [
          key,
          configuration.frameOptions.find((option) => option.frameKey === key)?.enabled ?? defaultEnabled,
        ])) as Record<EtsyProductFrameKey, boolean>,
        skus: {},
      });
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
      throw new Error('That Etsy SKU is already used by another listing.');
    }
    throw error;
  }
}

export async function ensureListingProductDefaultsInTransaction(
  tx: Prisma.TransactionClient,
  listingId: number,
  options?: ListingProductDefaultsOptions
) {
  if (!Number.isInteger(listingId) || listingId <= 0) throw new Error('Invalid listing id.');
  const listing = await tx.etsyListing.findUnique({
    where: { id: listingId },
    select: {
      id: true,
      etsyId: true,
      etsyDownloadId: true,
      title: true,
      localDirectoryName: true,
      numberOfItems: true,
      includeAllItems: true,
      etsyProductType: true,
      productConfig: true,
      sizeOptions: true,
      frameOptions: true,
      products: {
        select: {
          productKey: true,
          productType: true,
          sizeKey: true,
          frameKey: true,
          sku: true,
          priceKey: true,
          position: true,
          etsyListingId: true,
        },
      },
    },
  });
  if (!listing) throw new Error('Listing not found.');

  const existingSizes = new Map(listing.sizeOptions.map(({ sizeKey, enabled }) => [sizeKey, enabled]));
  const existingFrames = new Map(listing.frameOptions.map(({ frameKey, enabled }) => [frameKey, enabled]));
  if (options?.resetToProductType && options.resetToProductType !== listing.etsyProductType) {
    throw new Error('The requested Etsy product defaults do not match the listing product type.');
  }
  const defaults: NormalizedListingProducts = options?.resetToProductType
    ? { ...buildListingProductTypeDefaults(options.resetToProductType), downloadSectionId: listing.productConfig?.downloadSectionId ?? null }
    : {
        listOnEtsy: listing.productConfig?.listOnEtsy ?? true,
        digitalDownload: listing.productConfig?.digitalDownload
          ?? options?.digitalDownload
          ?? listing.etsyProductType === 'digital',
        printsFrames: listing.productConfig?.printsFrames ?? true,
        customTop: listing.productConfig?.customTop ?? true,
        customBottom: listing.productConfig?.customBottom ?? true,
        customiseDigitalDownloads: listing.productConfig?.customiseDigitalDownloads ?? false,
        customisePrints: listing.productConfig?.customisePrints ?? true,
        downloadSectionId: listing.productConfig?.downloadSectionId ?? null,
        returnPolicyId: listing.productConfig?.returnPolicyId ?? null,
        sizes: Object.fromEntries(SIZE_KEYS.map((key) => [key, existingSizes.get(key) ?? true])) as Record<EtsyProductSizeKey, boolean>,
        frames: Object.fromEntries(ETSY_PRODUCT_FRAMES.map(({ key, defaultEnabled }) => [
          key,
          existingFrames.get(key) ?? (listing.etsyProductType === 'digital' ? false : defaultEnabled),
        ])) as Record<EtsyProductFrameKey, boolean>,
        skus: {},
      };
  const expectedProducts = buildListingProductDefinitions(listing, defaults);
  const existingProductsByKey = new Map(listing.products.map((product) => [product.productKey, product]));
  const hasCompleteSizes = listing.sizeOptions.length === SIZE_KEYS.length
    && SIZE_KEYS.every((key) => existingSizes.has(key));
  const hasCompleteFrames = listing.frameOptions.length === FRAME_KEYS.length
    && FRAME_KEYS.every((key) => existingFrames.has(key));
  const hasCompleteProducts = listing.products.length === expectedProducts.length
    && expectedProducts.every((expected) => {
      const current = existingProductsByKey.get(expected.productKey);
      return current
        && current.productType === expected.productType
        && current.sizeKey === expected.sizeKey
        && current.frameKey === expected.frameKey
        && current.priceKey === expected.priceKey
        && current.position === expected.position
        && current.etsyListingId === (expected.productType === 'digital' ? listing.etsyDownloadId : listing.etsyId);
    });

  // Etsy refreshes run repeatedly. Existing complete product configuration must remain
  // untouched so a read-only refresh neither regenerates SKUs nor raises a false sync flag.
  if (!options?.resetToProductType
    && listing.productConfig && hasCompleteSizes && hasCompleteFrames && hasCompleteProducts) return;

  await persistListingProducts(tx, listing, defaults);
}

export async function ensureListingProductDefaults(
  listingId: number,
  options?: ListingProductDefaultsOptions
) {
  try {
    await prisma.$transaction(
      (tx) => ensureListingProductDefaultsInTransaction(tx, listingId, options),
      { isolationLevel: Prisma.TransactionIsolationLevel.Serializable }
    );
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
      throw new Error('Unable to generate unique Etsy product SKUs for this listing.');
    }
    throw error;
  }
}
