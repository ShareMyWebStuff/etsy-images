import { Prisma } from '@prisma/client';
import { readFile } from '@/lib/s3-listing-storage';
import path from 'node:path';
import {
  createListingDirectory,
  createSubSectionDirectory,
  listingDirectoryExists,
  listingDirectoryIsEmpty,
  listSubSectionListingDirectories,
  getListingDirectoryPath,
} from '@/lib/local-shop-directory';
import { getEtsyKeystring, getValidEtsyAccessToken } from '@/lib/etsy-oauth';
import { ETSY_PRIMARY_COLOURS } from '@/lib/etsy-colours';
import {
  buildEtsyInventoryPlan,
  buildPersonalizationQuestions,
  buildSingleDigitalInventoryBody,
  ETSY_DIGITAL_PRINTS_TAXONOMY_ID,
  ETSY_GICLEE_PRINTS_TAXONOMY_ID,
  resolveEtsyListingMode,
  type LocalSellableProduct,
} from '@/lib/etsy-product-inventory';
import { deleteDropboxBundleFolder, isDropboxInstructionPdfFile } from '@/lib/dropbox-bundle';
import {
  ensureListingProductDefaults,
  ensureListingProductDefaultsInTransaction,
} from '@/lib/listing-products';
import {
  PRICE_OPTION_BY_KEY,
  PRICE_OPTIONS,
  digitalPriceKeyForSection,
} from '@/lib/set-prices-core';
import { prisma } from '@/lib/prisma';

export type ImportableListingRow = {
  listingName: string;
};

export type NewListingConfiguration = {
  numberOfItems: number | null;
  includeAllItems: boolean;
  etsyProductType: 'physical' | 'digital';
};

const ALLOWED_ITEM_COUNTS = new Set([1, 3, 6, 12]);

function normalizeName(name: string) {
  return name.trim();
}

function normalizeForCompare(value: string) {
  return value.trim().toLocaleLowerCase();
}

function isString(value: string | null): value is string {
  return value !== null;
}

async function getListingContext(shopId: string, sectionId: string, subSectionId: string) {
  let etsyShopId: bigint;
  const numericSectionId = Number(sectionId);
  const numericSubSectionId = Number(subSectionId);

  try {
    etsyShopId = BigInt(shopId);
  } catch {
    throw new Error('Invalid shop id.');
  }

  if (!Number.isInteger(numericSectionId)) {
    throw new Error('Invalid section id.');
  }

  if (!Number.isInteger(numericSubSectionId)) {
    throw new Error('Invalid sub section id.');
  }

  const shop = await prisma.etsyShop.findUnique({
    where: {
      etsyShopId,
    },
    select: {
      id: true,
      etsyShopId: true,
      shopName: true,
      title: true,
    },
  });

  if (!shop) {
    throw new Error('Shop not found.');
  }

  const section = await prisma.etsyShopSection.findFirst({
    where: {
      id: numericSectionId,
      OR: [
        {
          shopId: shop.id,
        },
        {
          etsyShopId: shop.etsyShopId,
        },
      ],
    },
    select: {
      id: true,
      title: true,
      etsyShopSectionId: true,
      numberOfDownloads: true,
      includeAllDownloads: true,
    },
  });

  if (!section) {
    throw new Error('Section not found.');
  }

  const subSection = await prisma.etsyShopSubSection.findFirst({
    where: {
      id: numericSubSectionId,
      shopSectionId: section.id,
    },
    select: {
      id: true,
      name: true,
    },
  });

  if (!subSection) {
    throw new Error('Sub section not found.');
  }

  return {
    shop: {
      ...shop,
      displayName: shop.shopName ?? shop.title ?? `Shop ${shop.etsyShopId}`,
    },
    section,
    subSection,
  };
}

async function getExistingListingNames(subSectionId: number) {
  const listings = await prisma.etsyListing.findMany({
    where: {
      subSectionId,
    },
    select: {
      title: true,
      localDirectoryName: true,
    },
  });

  return new Set(
    listings.flatMap((listing) => [listing.title, listing.localDirectoryName].filter(isString).map((value) => normalizeForCompare(value)))
  );
}

async function assertListingMissingFromDatabase(subSectionId: number, listingName: string) {
  const existingListingNames = await getExistingListingNames(subSectionId);

  if (existingListingNames.has(normalizeForCompare(listingName))) {
    throw new Error(`A listing named "${listingName}" already exists in the database.`);
  }
}

async function recoverIncompleteLocalListingRow(subSectionId: number, listingName: string) {
  const normalizedName = normalizeForCompare(listingName);
  const existing = await prisma.etsyListing.findFirst({
    where: {
      subSectionId,
      OR: [
        { title: listingName },
        { localDirectoryName: listingName },
      ],
    },
    select: {
      id: true,
      etsyId: true,
      isLocal: true,
      title: true,
      localDirectoryName: true,
      productConfig: { select: { id: true } },
    },
  });

  if (!existing) return null;
  const isSameName = [existing.title, existing.localDirectoryName]
    .some((value) => value !== null && normalizeForCompare(value) === normalizedName);
  if (!isSameName || !existing.isLocal || existing.etsyId !== null || existing.productConfig) return null;

  await prisma.$transaction(
    (tx) => ensureListingProductDefaultsInTransaction(tx, existing.id),
    { isolationLevel: Prisma.TransactionIsolationLevel.Serializable }
  );
  return { id: existing.id };
}

function resolveNewListingConfiguration(
  context: Awaited<ReturnType<typeof getListingContext>>,
  requested?: NewListingConfiguration
): NewListingConfiguration {
  const includeAllItems = requested?.includeAllItems ?? context.section.includeAllDownloads;
  const numberOfItems = includeAllItems
    ? null
    : requested?.numberOfItems ?? context.section.numberOfDownloads ?? 1;
  const etsyProductType = requested?.etsyProductType ?? 'physical';

  if (!includeAllItems && !ALLOWED_ITEM_COUNTS.has(numberOfItems ?? 0)) {
    throw new Error('Choose 1, 3, 6, 12, or All items.');
  }
  if (etsyProductType !== 'physical' && etsyProductType !== 'digital') {
    throw new Error('Choose a Physical or Digital Etsy product.');
  }

  return { numberOfItems, includeAllItems, etsyProductType };
}

async function getInitialListingPriceAmount(
  tx: Prisma.TransactionClient,
  configuration: NewListingConfiguration
) {
  const priceKeys = configuration.etsyProductType === 'digital'
    ? [digitalPriceKeyForSection(configuration.numberOfItems ?? 1, configuration.includeAllItems) ?? 'digital_1']
    : PRICE_OPTIONS
        .filter(({ category }) => category === 'framed')
        .map(({ key }) => key);
  const savedPrices = await tx.adminProductPrice.findMany({
    where: { productKey: { in: priceKeys } },
    select: { productKey: true, amountPence: true },
  });
  const savedByKey = new Map(savedPrices.map(({ productKey, amountPence }) => [productKey, amountPence]));
  const applicablePrices = priceKeys.map((priceKey) => {
    const saved = savedByKey.get(priceKey);
    if (Number.isInteger(saved) && (saved ?? 0) > 0) return saved!;
    const fallback = PRICE_OPTION_BY_KEY.get(priceKey)?.defaultAmountPence;
    if (!fallback) throw new Error(`Set a valid price for ${priceKey} on the Set Prices page.`);
    return fallback;
  });
  return Math.min(...applicablePrices);
}

async function createLocalListingRow(
  context: Awaited<ReturnType<typeof getListingContext>>,
  listingName: string,
  requestedConfiguration?: NewListingConfiguration
) {
  const shopSectionId =
    context.section.etsyShopSectionId === null ? null : Number(context.section.etsyShopSectionId);
  const configuration = resolveNewListingConfiguration(context, requestedConfiguration);

  return prisma.$transaction(async (tx) => {
    const priceAmount = await getInitialListingPriceAmount(tx, configuration);
    const listing = await tx.etsyListing.create({
      data: {
        shopId: context.shop.etsyShopId.toString(),
        shopSectionId: shopSectionId !== null && Number.isSafeInteger(shopSectionId) ? shopSectionId : null,
        title: listingName,
        state: 'local',
        subSectionId: context.subSection.id,
        localDirectoryName: listingName,
        isLocal: true,
        quantity: 999,
        priceAmount,
        priceDivisor: 100,
        priceCurrencyCode: 'GBP',
        whoMade: 'i_did',
        whenMade: '2020_2026',
        isSupply: false,
        shouldAutoRenew: true,
        numberOfItems: configuration.numberOfItems,
        includeAllItems: configuration.includeAllItems,
        etsyProductType: configuration.etsyProductType,
        taxonomyId: configuration.etsyProductType === 'physical'
          ? ETSY_GICLEE_PRINTS_TAXONOMY_ID
          : ETSY_DIGITAL_PRINTS_TAXONOMY_ID,
        rawJson: Prisma.JsonNull,
      },
      select: {
        id: true,
      },
    });

    await ensureListingProductDefaultsInTransaction(tx, listing.id);
    return listing;
  }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
}

async function ensureSubSectionDirectory(context: Awaited<ReturnType<typeof getListingContext>>) {
  await createSubSectionDirectory(context.shop.displayName, context.section.title, context.subSection.name);
}

function getEtsyApiKeyHeader() {
  const sharedSecret = process.env.ETSY_SHARED_SECRET;

  if (!sharedSecret) {
    throw new Error('Missing ETSY_SHARED_SECRET environment variable.');
  }

  return `${getEtsyKeystring()}:${sharedSecret}`;
}

function toRawJson(value: unknown) {
  return JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue;
}

function parseEtsyListingId(payload: unknown) {
  if (payload && typeof payload === 'object' && 'listing_id' in payload) {
    const listingId = payload.listing_id;

    return listingId === null || listingId === undefined ? null : String(listingId);
  }

  return null;
}

function parseEtsyListingState(payload: unknown) {
  if (payload && typeof payload === 'object' && 'state' in payload) {
    return typeof payload.state === 'string' ? payload.state : null;
  }

  return null;
}

function parseEtsyListingUrl(payload: unknown) {
  if (payload && typeof payload === 'object' && 'url' in payload) {
    return typeof payload.url === 'string' ? payload.url : null;
  }

  return null;
}

async function fetchEtsyListingMutation<T>(path: string, init: RequestInit) {
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const accessToken = await getValidEtsyAccessToken();
    const response = await fetch(`https://openapi.etsy.com/v3/application${path}`, {
      ...init,
      signal: AbortSignal.timeout(30_000),
      headers: {
        Accept: 'application/json',
        Authorization: `Bearer ${accessToken}`,
        'x-api-key': getEtsyApiKeyHeader(),
        ...init.headers,
      },
    });
    const responseText = await response.text();

    if (response.ok) return (responseText ? JSON.parse(responseText) : null) as T;
    if (response.status !== 429 || attempt === 2) {
      throw new Error(`Etsy API returned ${response.status} ${response.statusText}${responseText ? `: ${responseText}` : ''}`);
    }
    const retryAfter = Number(response.headers.get('retry-after'));
    const delayMs = Number.isFinite(retryAfter) && retryAfter > 0
      ? Math.min(retryAfter * 1000, 30_000)
      : 1000 * (2 ** attempt);
    await new Promise((resolve) => setTimeout(resolve, delayMs));
  }
  throw new Error('Etsy API rate limit retry failed.');
}

export async function refreshEtsySectionListings(sectionId: string) {
  const numericSectionId = Number(sectionId);
  if (!Number.isInteger(numericSectionId)) throw new Error('Invalid section id.');

  const section = await prisma.etsyShopSection.findUnique({
    where: { id: numericSectionId },
    include: {
      shop: true,
      subSections: {
        include: {
          listings: {
            where: { etsyId: { not: null } },
            select: { id: true, etsyId: true },
          },
        },
      },
    },
  });

  if (!section?.shop) throw new Error('Section context not found.');
  if (section.etsyShopSectionId === null) throw new Error('Create this section on Etsy before refreshing its listings.');

  const etsySectionId = Number(section.etsyShopSectionId);
  const listings = section.subSections.flatMap((subSection) => subSection.listings);

  for (const listing of listings) {
    const body = new URLSearchParams({ shop_section_id: String(etsySectionId) });
    await fetchEtsyListingMutation<unknown>(
      `/shops/${encodeURIComponent(section.shop.etsyShopId.toString())}/listings/${encodeURIComponent(listing.etsyId!)}`,
      {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body,
      }
    );
    await prisma.etsyListing.update({
      where: { id: listing.id },
      data: { shopSectionId: etsySectionId },
    });
  }

  return { updated: listings.length };
}

export async function checkEtsySectionListingStatuses(sectionId: string) {
  const numericSectionId = Number(sectionId);
  if (!Number.isInteger(numericSectionId)) throw new Error('Invalid section id.');

  const section = await prisma.etsyShopSection.findUnique({
    where: { id: numericSectionId },
    include: {
      shop: true,
      subSections: {
        include: {
          listings: {
            where: { etsyId: { not: null } },
            select: { id: true, etsyId: true },
          },
        },
      },
    },
  });

  if (!section?.shop) throw new Error('Section context not found.');

  const listings = section.subSections.flatMap((subSection) => subSection.listings);
  for (const listing of listings) {
    const payload = await fetchEtsyListingMutation<unknown>(
      `/listings/${encodeURIComponent(listing.etsyId!)}`,
      { method: 'GET' }
    );

    await prisma.etsyListing.update({
      where: { id: listing.id },
      data: {
        state: parseEtsyListingState(payload),
        url: parseEtsyListingUrl(payload),
        rawJson: toRawJson(payload),
      },
    });
  }

  return { updated: listings.length };
}

type EtsyInventoryOffering = Record<string, unknown> & {
  offering_id?: number | string;
  price?: { amount?: number; divisor?: number };
};

type EtsyInventoryProduct = Record<string, unknown> & {
  product_id?: number | string;
  offerings?: EtsyInventoryOffering[];
};

type EtsyInventory = {
  products?: EtsyInventoryProduct[];
  price_on_property?: number[];
  quantity_on_property?: number[];
  sku_on_property?: number[];
  readiness_state_on_property?: number[];
};

export class EtsyVariationNotFoundError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'EtsyVariationNotFoundError';
  }
}

function inventoryRequestBody(
  inventory: EtsyInventory,
  priceForOffering: (productId: string, offeringId: string, currentPrice: unknown) => number
) {
  return {
    products: (inventory.products ?? []).map((product) => {
      const { product_id: productId, is_deleted: _isDeleted, offerings = [], property_values: propertyValues = [], ...productFields } = product;
      return {
        ...productFields,
        offerings: offerings.map((offering) => {
          const { offering_id: offeringId, is_deleted: _offeringDeleted, price: oldPrice, ...offeringFields } = offering;
          return {
            ...offeringFields,
            price: priceForOffering(String(productId ?? ''), String(offeringId ?? ''), oldPrice),
          };
        }),
        property_values: Array.isArray(propertyValues)
          ? propertyValues.map((propertyValue) => {
              if (!propertyValue || typeof propertyValue !== 'object') return propertyValue;
              const { scale_name: _scaleName, ...fields } = propertyValue as Record<string, unknown>;
              return fields;
            })
          : [],
      };
    }),
    price_on_property: inventory.price_on_property ?? [],
    quantity_on_property: inventory.quantity_on_property ?? [],
    sku_on_property: inventory.sku_on_property ?? [],
    readiness_state_on_property: inventory.readiness_state_on_property ?? [],
  };
}

function decimalInventoryPrice(value: unknown) {
  if (typeof value === 'number') return value;
  if (value && typeof value === 'object') {
    const money = value as { amount?: unknown; divisor?: unknown };
    if (typeof money.amount === 'number' && typeof money.divisor === 'number' && money.divisor > 0) {
      return money.amount / money.divisor;
    }
  }
  throw new Error('Etsy returned an invalid offering price.');
}

export async function updateEtsyListingPrice(_shopId: string, etsyListingId: string, priceAmount: number, priceDivisor = 100) {
  const listingPath = `/listings/${encodeURIComponent(etsyListingId)}`;
  const inventoryReadPath = `${listingPath}/inventory?legacy=false`;
  const inventoryWritePath = `${listingPath}/inventory?legacy=false&max_variations_supported=3`;
  const inventory = await fetchEtsyListingMutation<EtsyInventory>(inventoryReadPath, { method: 'GET' });

  if (!inventory.products?.length) throw new Error('Etsy did not return listing inventory to update.');
  const price = priceAmount / priceDivisor;
  const requestBody = inventoryRequestBody(inventory, () => price);

  await fetchEtsyListingMutation<unknown>(inventoryWritePath, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(requestBody),
  });

  const savedListing = await fetchEtsyListingMutation<{ price?: { amount?: number; divisor?: number } }>(listingPath, { method: 'GET' });
  if (savedListing.price?.amount !== priceAmount || savedListing.price?.divisor !== priceDivisor) {
    throw new Error(`Etsy did not save the requested price of ${price.toFixed(2)}.`);
  }
  return savedListing;
}

export async function updateEtsyListingVariationPrices(
  etsyListingId: string,
  changes: Array<{ etsyProductId: string; etsyOfferingId: string; amountPence: number }>
) {
  if (changes.length === 0) throw new Error('No mapped Etsy variations were supplied.');
  const listingPath = `/listings/${encodeURIComponent(etsyListingId)}`;
  const inventoryReadPath = `${listingPath}/inventory?legacy=false`;
  const inventoryWritePath = `${listingPath}/inventory?legacy=false&max_variations_supported=3`;
  const inventory = await fetchEtsyListingMutation<EtsyInventory>(inventoryReadPath, { method: 'GET' });
  if (!inventory.products?.length) throw new Error('Etsy did not return listing inventory to update.');
  const changedPrices = new Map(changes.map((change) => [
    `${change.etsyProductId}:${change.etsyOfferingId}`,
    change.amountPence / 100,
  ]));
  const matched = new Set<string>();
  const requestBody = inventoryRequestBody(inventory, (productId, offeringId, currentPrice) => {
    const key = `${productId}:${offeringId}`;
    const price = changedPrices.get(key);
    if (price === undefined) return decimalInventoryPrice(currentPrice);
    matched.add(key);
    return price;
  });
  if (matched.size !== changedPrices.size) throw new EtsyVariationNotFoundError('One or more mapped Etsy variations no longer exist on this listing.');

  await fetchEtsyListingMutation<unknown>(inventoryWritePath, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(requestBody),
  });

  const saved = await fetchEtsyListingMutation<EtsyInventory>(inventoryReadPath, { method: 'GET' });
  const confirmed = new Set<string>();
  for (const product of saved.products ?? []) {
    for (const offering of product.offerings ?? []) {
      const key = `${String(product.product_id ?? '')}:${String(offering.offering_id ?? '')}`;
      const expected = changedPrices.get(key);
      if (expected !== undefined && decimalInventoryPrice(offering.price) === expected) confirmed.add(key);
    }
  }
  if (confirmed.size !== changedPrices.size) throw new EtsyVariationNotFoundError('Etsy no longer returned every mapped variation after the update.');
  return saved;
}

type PushableListing = {
  id: number;
  etsyId: string | null;
  title: string;
  description: string | null;
  quantity: number | null;
  priceAmount: number | null;
  priceDivisor: number | null;
  taxonomyId: number | null;
  shopSectionId: number | null;
  whoMade: string | null;
  isSupply: boolean | null;
  whenMade: string | null;
  shouldAutoRenew: boolean | null;
  etsyProductType: string;
  productConfig: { digitalDownload: boolean; returnPolicyId: string | null } | null;
  primaryColour: string | null;
  secondaryColour: string | null;
  tags: Array<{ tag: string }>;
  priceMappings: Array<{ shippingProfileId: string | null }>;
};

type MetadataSyncAreas = { details: boolean; tags: boolean; products?: boolean };

type PhysicalDeliverySettings = {
  shippingProfileId: string;
  readinessStateId: string;
  returnPolicyId: string;
};

export type EtsyReturnPolicyOption = {
  id: string;
  label: string;
  acceptsReturns: boolean;
  acceptsExchanges: boolean;
};

function effectiveEtsyListingType(listing: Pick<PushableListing, 'etsyProductType' | 'productConfig'>) {
  return resolveEtsyListingMode(listing.etsyProductType, listing.productConfig?.digitalDownload ?? false).listingType;
}

function appendIfPresent(body: URLSearchParams, key: string, value: boolean | number | string | null) {
  if (value === null) {
    return;
  }

  body.set(key, String(value));
}

function buildPushListingBody(
  listing: PushableListing & { rawJson: Prisma.JsonValue | null },
  section: Awaited<ReturnType<typeof getListingContext>>['section'],
  changedOnly = false,
  areas: MetadataSyncAreas = { details: true, tags: true, products: true },
  deliverySettings: PhysicalDeliverySettings | null = null
) {
  const listingType = effectiveEtsyListingType(listing);
  const missingFields = [
    listing.title.trim() ? null : 'title',
    listing.description?.trim() ? null : 'description',
    listing.priceAmount !== null && listing.priceDivisor !== null && listing.priceDivisor !== 0 ? null : 'price',
    listing.taxonomyId !== null ? null : 'taxonomyId',
    listing.whoMade ? null : 'whoMade',
    listing.whenMade ? null : 'whenMade',
    listing.isSupply !== null ? null : 'isSupply',
    listingType !== 'download' && (!changedOnly || areas.products) && !deliverySettings?.shippingProfileId ? 'shipping profile' : null,
    listingType !== 'download' && (!changedOnly || areas.products) && !deliverySettings?.readinessStateId ? 'processing profile' : null,
    listingType !== 'download' && (!changedOnly || areas.products) && !deliverySettings?.returnPolicyId ? 'return policy' : null,
  ].filter(isString);

  if (missingFields.length > 0) {
    throw new Error(`Add ${missingFields.join(', ')} before pushing this listing to Etsy.`);
  }

  const body = new URLSearchParams();
  const price = (listing.priceAmount! / listing.priceDivisor!).toFixed(2);

  body.set('title', listing.title);
  body.set('description', listing.description!);
  body.set('quantity', String(listing.quantity ?? 1));
  body.set('price', price);
  body.set('taxonomy_id', String(listing.taxonomyId));
  body.set('who_made', listing.whoMade!);
  body.set('when_made', listing.whenMade!);
  body.set('is_supply', String(listing.isSupply));
  body.set('type', listingType);
  if (deliverySettings) {
    body.set('shipping_profile_id', deliverySettings.shippingProfileId);
    body.set('readiness_state_id', deliverySettings.readinessStateId);
    body.set('return_policy_id', deliverySettings.returnPolicyId);
  }
  appendIfPresent(body, 'shop_section_id', listing.shopSectionId ?? (section.etsyShopSectionId === null ? null : Number(section.etsyShopSectionId)));
  appendIfPresent(body, 'should_auto_renew', listing.shouldAutoRenew);
  const tags = listing.tags.slice(0, 13).map(({ tag }) => tag.trim()).filter(Boolean);
  if (tags.length > 0 || (changedOnly && areas.tags)) body.set('tags', tags.join(','));
  if (!areas.details) {
    const productKeys = new Set(['price', 'taxonomy_id', 'type', 'shipping_profile_id', 'readiness_state_id', 'return_policy_id']);
    for (const key of [...body.keys()]) if (key !== 'tags' && !(areas.products && productKeys.has(key))) body.delete(key);
  }
  if (!areas.products) {
    for (const key of ['taxonomy_id', 'type', 'shipping_profile_id', 'readiness_state_id', 'return_policy_id']) body.delete(key);
    if (!areas.details) body.delete('price');
  }
  if (!areas.tags) body.delete('tags');

  if (changedOnly && listing.rawJson && typeof listing.rawJson === 'object' && !Array.isArray(listing.rawJson)) {
    const raw = listing.rawJson as Record<string, unknown>;
    const currentSectionId = listing.shopSectionId ?? (section.etsyShopSectionId === null ? null : Number(section.etsyShopSectionId));
    const unchanged = (key: string, value: unknown) => String(raw[key] ?? '') === String(value ?? '');
    const rawPrice = raw.price && typeof raw.price === 'object' && !Array.isArray(raw.price)
      ? raw.price as Record<string, unknown>
      : null;
    const comparisons: Record<string, boolean> = {
      title: unchanged('title', listing.title),
      description: unchanged('description', listing.description),
      quantity: unchanged('quantity', listing.quantity ?? 1),
      price: rawPrice !== null && Number(rawPrice.amount) === listing.priceAmount && Number(rawPrice.divisor) === listing.priceDivisor,
      taxonomy_id: unchanged('taxonomy_id', listing.taxonomyId),
      who_made: unchanged('who_made', listing.whoMade),
      when_made: unchanged('when_made', listing.whenMade),
      is_supply: unchanged('is_supply', listing.isSupply),
      type: String(raw.listing_type ?? raw.type ?? '') === listingType,
      shipping_profile_id: unchanged('shipping_profile_id', deliverySettings?.shippingProfileId),
      readiness_state_id: unchanged('readiness_state_id', deliverySettings?.readinessStateId),
      return_policy_id: unchanged('return_policy_id', deliverySettings?.returnPolicyId),
      shop_section_id: unchanged('shop_section_id', currentSectionId),
      should_auto_renew: unchanged('should_auto_renew', listing.shouldAutoRenew),
      tags: Array.isArray(raw.tags) && JSON.stringify(raw.tags.map(String)) === JSON.stringify(tags),
    };
    for (const [key] of [...body.entries()]) {
      if (comparisons[key]) body.delete(key);
    }
  }

  return body;
}

async function loadListingForAction(subSectionId: number, listingId: string) {
  const numericListingId = Number(listingId);

  if (!Number.isInteger(numericListingId)) {
    throw new Error('Invalid listing id.');
  }

  const listing = await prisma.etsyListing.findFirst({
    where: {
      id: numericListingId,
      subSectionId,
    },
    select: {
      id: true,
      etsyId: true,
      rawJson: true,
      title: true,
      description: true,
      state: true,
      quantity: true,
      priceAmount: true,
      priceDivisor: true,
      taxonomyId: true,
      shopSectionId: true,
      whoMade: true,
      isSupply: true,
      whenMade: true,
      shouldAutoRenew: true,
      etsyProductType: true,
      productConfig: { select: { digitalDownload: true, returnPolicyId: true } },
      primaryColour: true,
      secondaryColour: true,
      tags: { select: { tag: true }, orderBy: [{ position: 'asc' }] },
      priceMappings: { select: { shippingProfileId: true } },
      dropboxBundle: { select: { folderPath: true } },
      detailsChanged: true,
      tagsChanged: true,
      imagesChanged: true,
      downloadsChanged: true,
    },
  });

  if (!listing) {
    throw new Error('Listing not found.');
  }

  return listing;
}

export async function getImportableLocalListings(shopId: string, sectionId: string, subSectionId: string): Promise<ImportableListingRow[]> {
  const context = await getListingContext(shopId, sectionId, subSectionId);
  const existingListingNames = await getExistingListingNames(context.subSection.id);
  await ensureSubSectionDirectory(context);
  const directoryNames = await listSubSectionListingDirectories(
    context.shop.displayName,
    context.section.title,
    context.subSection.name
  );

  return directoryNames
    .filter((listingName) => !existingListingNames.has(normalizeForCompare(listingName)))
    .map((listingName) => ({
      listingName,
    }));
}

export async function importLocalListing(shopId: string, sectionId: string, subSectionId: string, listingName: string) {
  const context = await getListingContext(shopId, sectionId, subSectionId);
  const trimmedListingName = normalizeName(listingName);

  await ensureSubSectionDirectory(context);

  if (
    !(await listingDirectoryExists(
      context.shop.displayName,
      context.section.title,
      context.subSection.name,
      trimmedListingName
    ))
  ) {
    throw new Error(`A local folder named "${trimmedListingName}" was not found for this sub section.`);
  }

  const recovered = await recoverIncompleteLocalListingRow(context.subSection.id, trimmedListingName);
  if (recovered) return recovered;
  await assertListingMissingFromDatabase(context.subSection.id, trimmedListingName);

  return createLocalListingRow(context, trimmedListingName);
}

export async function createLocalListing(
  shopId: string,
  sectionId: string,
  subSectionId: string,
  listingName: string,
  configuration?: NewListingConfiguration
) {
  const context = await getListingContext(shopId, sectionId, subSectionId);
  const trimmedListingName = normalizeName(listingName);

  if (!trimmedListingName) {
    throw new Error('Enter a listing name.');
  }

  await ensureSubSectionDirectory(context);
  const recovered = await recoverIncompleteLocalListingRow(context.subSection.id, trimmedListingName);
  if (recovered) {
    await createListingDirectory(context.shop.displayName, context.section.title, context.subSection.name, trimmedListingName);
    return recovered;
  }
  await assertListingMissingFromDatabase(context.subSection.id, trimmedListingName);

  const directoryExists = await listingDirectoryExists(
    context.shop.displayName,
    context.section.title,
    context.subSection.name,
    trimmedListingName
  );
  if (directoryExists && !(await listingDirectoryIsEmpty(
    context.shop.displayName,
    context.section.title,
    context.subSection.name,
    trimmedListingName
  ))) {
    throw new Error(`A local folder named "${trimmedListingName}" already exists. Use Import instead.`);
  }

  await createListingDirectory(context.shop.displayName, context.section.title, context.subSection.name, trimmedListingName);

  return createLocalListingRow(context, trimmedListingName, configuration);
}

export async function deleteListing(shopId: string, sectionId: string, subSectionId: string, listingId: string) {
  const context = await getListingContext(shopId, sectionId, subSectionId);
  const listing = await loadListingForAction(context.subSection.id, listingId);

  if (listing.etsyId !== null) {
    throw new Error(`Cannot delete "${listing.title}" because it exists on Etsy.`);
  }

  if (listing.state === 'active' || listing.state === 'published') {
    throw new Error(`Cannot delete "${listing.title}" because it is published.`);
  }

  if (listing.dropboxBundle) {
    await deleteDropboxBundleFolder(listing.dropboxBundle.folderPath);
  }

  await prisma.etsyListing.delete({
    where: {
      id: listing.id,
    },
  });
}

export async function deleteListingFromEtsy(shopId: string, sectionId: string, subSectionId: string, listingId: string) {
  const context = await getListingContext(shopId, sectionId, subSectionId);
  const listing = await loadListingForAction(context.subSection.id, listingId);

  if (listing.etsyId === null) throw new Error('This listing is not on Etsy.');

  await fetchEtsyListingMutation<null>(`/listings/${encodeURIComponent(listing.etsyId)}`, { method: 'DELETE' });

  await prisma.$transaction([
    prisma.etsyListingImage.updateMany({ where: { listingId: listing.id }, data: { etsyImageId: null } }),
    prisma.etsyListingFile.updateMany({ where: { listingId: listing.id }, data: { etsyListingFileId: null } }),
    prisma.etsyListingZip.updateMany({ where: { listingId: listing.id }, data: { etsyListingFileId: null } }),
    prisma.etsyListingVideo.updateMany({ where: { listingId: listing.id }, data: { etsyVideoId: null } }),
    prisma.etsyListingProduct.updateMany({
      where: { listingId: listing.id },
      data: { etsyListingId: null, etsyProductId: null, etsyOfferingId: null },
    }),
    prisma.etsyListingPriceMapping.updateMany({
      where: { listingId: listing.id },
      data: { etsyProductId: null, etsyOfferingId: null },
    }),
    prisma.etsyListing.update({
      where: { id: listing.id },
      data: { etsyId: null, state: 'local', url: null, rawJson: Prisma.JsonNull, lastSyncedAt: null },
    }),
  ]);
}

export async function publishListing(shopId: string, sectionId: string, subSectionId: string, listingId: string) {
  const context = await getListingContext(shopId, sectionId, subSectionId);
  const listing = await loadListingForAction(context.subSection.id, listingId);

  if (listing.etsyId === null) {
    throw new Error('This listing does not have an Etsy listing id yet. Push it to Etsy first.');
  }

  const payload = await fetchEtsyListingMutation<unknown>(
    `/shops/${encodeURIComponent(context.shop.etsyShopId.toString())}/listings/${encodeURIComponent(listing.etsyId)}`,
    {
      method: 'PATCH',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: new URLSearchParams({
        state: 'active',
      }),
    }
  );

  await prisma.etsyListing.update({
    where: {
      id: listing.id,
    },
    data: {
      state: parseEtsyListingState(payload) ?? 'active',
      url: parseEtsyListingUrl(payload),
      rawJson: toRawJson(payload),
    },
  });
}

export async function makeListingInactive(shopId: string, sectionId: string, subSectionId: string, listingId: string) {
  const context = await getListingContext(shopId, sectionId, subSectionId);
  const listing = await loadListingForAction(context.subSection.id, listingId);
  if (listing.etsyId === null) throw new Error('This listing does not have an Etsy listing id.');

  const payload = await fetchEtsyListingMutation<unknown>(
    `/shops/${encodeURIComponent(context.shop.etsyShopId.toString())}/listings/${encodeURIComponent(listing.etsyId)}`,
    {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ state: 'inactive' }),
    }
  );

  await prisma.etsyListing.update({
    where: { id: listing.id },
    data: {
      state: parseEtsyListingState(payload) ?? 'inactive',
      url: parseEtsyListingUrl(payload),
      rawJson: toRawJson(payload),
    },
  });
}

function jsonObject(value: Prisma.JsonValue | null | undefined): Record<string, Prisma.JsonValue> | null {
  return value !== null && value !== undefined && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, Prisma.JsonValue>
    : null;
}

function positiveEtsyId(value: unknown) {
  if (typeof value !== 'string' && typeof value !== 'number' && typeof value !== 'bigint') return null;
  const text = String(value).trim();
  if (!/^\d+$/.test(text)) return null;
  try {
    return BigInt(text) > 0n ? text : null;
  } catch {
    return null;
  }
}

function payloadResults(payload: unknown): Array<Record<string, unknown>> {
  if (!payload || typeof payload !== 'object' || !('results' in payload)) return [];
  const results = (payload as { results?: unknown }).results;
  return Array.isArray(results)
    ? results.filter((item): item is Record<string, unknown> => item !== null && typeof item === 'object' && !Array.isArray(item))
    : [];
}

function oneConfiguredId(ids: Array<string | null>, conflictMessage: string) {
  const distinct = [...new Set(ids.filter((id): id is string => id !== null))];
  if (distinct.length > 1) throw new Error(conflictMessage);
  return distinct[0] ?? null;
}

export async function getEtsyReturnPolicies(shopId: string): Promise<EtsyReturnPolicyOption[]> {
  if (!/^\d+$/.test(shopId) || BigInt(shopId) <= 0n) throw new Error('Invalid Etsy shop id.');
  const response = await fetchEtsyListingMutation<unknown>(
    `/shops/${encodeURIComponent(shopId)}/policies/return`,
    { method: 'GET' }
  );
  return payloadResults(response).flatMap((policy) => {
    const id = positiveEtsyId(policy.return_policy_id);
    if (!id) return [];
    const acceptsReturns = policy.accepts_returns === true;
    const acceptsExchanges = policy.accepts_exchanges === true;
    const label = acceptsReturns && acceptsExchanges
      ? 'Returns and exchanges accepted'
      : acceptsReturns
        ? 'Returns accepted; exchanges not accepted'
        : acceptsExchanges
          ? 'Exchanges accepted; returns not accepted'
          : 'No returns or exchanges';
    return [{ id, label, acceptsReturns, acceptsExchanges }];
  });
}

async function resolvePhysicalDeliverySettings(
  shopId: string,
  listing: Pick<PushableListing, 'etsyId' | 'priceMappings' | 'productConfig'> & { rawJson: Prisma.JsonValue | null }
): Promise<PhysicalDeliverySettings> {
  const raw = jsonObject(listing.rawJson);
  const rawShippingProfile = jsonObject(raw?.shipping_profile);
  const recordedShippingProfileId = oneConfiguredId([
    positiveEtsyId(raw?.shipping_profile_id),
    positiveEtsyId(rawShippingProfile?.shipping_profile_id),
  ], 'Etsy returned conflicting shipping profile ids for this listing. Refresh the listing before syncing.');
  const mappedShippingProfileId = recordedShippingProfileId
    ? null
    : oneConfiguredId(
        listing.priceMappings.map(({ shippingProfileId: id }) => positiveEtsyId(id)),
        'This listing has conflicting Etsy shipping profiles recorded. Correct its delivery mapping before syncing.'
      );
  let shippingProfileId: string | null = recordedShippingProfileId ?? mappedShippingProfileId;
  shippingProfileId ??= positiveEtsyId(process.env.ETSY_SHIPPING_PROFILE_ID);

  if (!shippingProfileId) {
    const response = await fetchEtsyListingMutation<unknown>(
      `/shops/${encodeURIComponent(shopId)}/shipping-profiles`,
      { method: 'GET' }
    );
    const ids = payloadResults(response)
      .filter((profile) => profile.is_deleted !== true)
      .map((profile) => positiveEtsyId(profile.shipping_profile_id))
      .filter((id): id is string => id !== null);
    shippingProfileId = oneConfiguredId(ids, 'This Etsy shop has multiple shipping profiles. Set ETSY_SHIPPING_PROFILE_ID to the profile that physical prints should use.');
    if (!shippingProfileId) {
      throw new Error('Create an Etsy shipping profile for physical prints, or set ETSY_SHIPPING_PROFILE_ID, before syncing.');
    }
  }

  let readinessStateId = positiveEtsyId(raw?.readiness_state_id);
  const recordedListingType = typeof raw?.listing_type === 'string' ? raw.listing_type : null;
  if (!readinessStateId && listing.etsyId && recordedListingType !== 'download') {
    const inventory = await fetchEtsyListingMutation<EtsyInventory>(
      `/listings/${encodeURIComponent(listing.etsyId)}/inventory?legacy=false`,
      { method: 'GET' }
    );
    readinessStateId = oneConfiguredId(
      (inventory.products ?? []).flatMap((product) => (product.offerings ?? []).map((offering) => positiveEtsyId(offering.readiness_state_id))),
      'This listing uses more than one Etsy processing profile. Set ETSY_READINESS_STATE_ID to the processing profile that the generated print variations should use.'
    );
  }
  readinessStateId ??= positiveEtsyId(process.env.ETSY_READINESS_STATE_ID);

  if (!readinessStateId) {
    const response = await fetchEtsyListingMutation<unknown>(
      `/shops/${encodeURIComponent(shopId)}/readiness-state-definitions?limit=100`,
      { method: 'GET' }
    );
    const ids = payloadResults(response)
      .map((profile) => positiveEtsyId(profile.readiness_state_id))
      .filter((id): id is string => id !== null);
    readinessStateId = oneConfiguredId(ids, 'This Etsy shop has multiple processing profiles. Set ETSY_READINESS_STATE_ID to the processing profile that physical prints should use.');
    if (!readinessStateId) {
      throw new Error('Create an Etsy processing profile for physical prints, or set ETSY_READINESS_STATE_ID, before syncing.');
    }
  }

  let returnPolicyId = positiveEtsyId(listing.productConfig?.returnPolicyId);
  returnPolicyId ??= positiveEtsyId(raw?.return_policy_id);
  returnPolicyId ??= positiveEtsyId(process.env.ETSY_RETURN_POLICY_ID);
  if (!returnPolicyId) {
    const policies = await getEtsyReturnPolicies(shopId);
    const noReturnsPolicies = policies.filter((policy) => !policy.acceptsReturns && !policy.acceptsExchanges);
    const candidatePolicies = noReturnsPolicies.length > 0 ? noReturnsPolicies : policies;
    const conflictMessage = noReturnsPolicies.length > 0
      ? 'This Etsy shop has multiple No returns or exchanges policies. Choose one on the Etsy Products tab.'
      : 'This Etsy shop has multiple return policies. Choose one on the Etsy Products tab.';
    returnPolicyId = oneConfiguredId(candidatePolicies.map((policy) => policy.id), conflictMessage);
    if (!returnPolicyId) {
      throw new Error('Create an Etsy return policy for physical prints, then choose it on the Etsy Products tab before syncing.');
    }
  }

  return { shippingProfileId, readinessStateId, returnPolicyId };
}

export async function pushListing(
  shopId: string,
  sectionId: string,
  subSectionId: string,
  listingId: string,
  requestedAreas?: MetadataSyncAreas,
  resolvedDeliverySettings?: PhysicalDeliverySettings | null
) {
  const context = await getListingContext(shopId, sectionId, subSectionId);
  const listing = await loadListingForAction(context.subSection.id, listingId);
  const areas = listing.etsyId === null
    ? { details: true, tags: true, products: true }
    : requestedAreas ?? { details: true, tags: true, products: true };
  const listingType = effectiveEtsyListingType(listing);
  const needsDeliverySettings = listingType !== 'download' && (listing.etsyId === null || areas.products);
  const deliverySettings = !needsDeliverySettings
    ? null
    : resolvedDeliverySettings ?? await resolvePhysicalDeliverySettings(context.shop.etsyShopId.toString(), listing);
  const body = buildPushListingBody(listing, context.section, listing.etsyId !== null, areas, deliverySettings);
  const shopPath = `/shops/${encodeURIComponent(context.shop.etsyShopId.toString())}/listings`;
  const listingPath = listing.etsyId === null
    ? `${shopPath}${deliverySettings ? '?legacy=false' : ''}`
    : `${shopPath}/${encodeURIComponent(listing.etsyId)}${deliverySettings ? '?legacy=false' : ''}`;
  const payload =
    listing.etsyId === null
      ? await fetchEtsyListingMutation<unknown>(listingPath, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/x-www-form-urlencoded',
          },
          body,
        })
      : body.size === 0
      ? listing.rawJson
      : await fetchEtsyListingMutation<unknown>(listingPath, {
          method: 'PATCH',
          headers: {
            'Content-Type': 'application/x-www-form-urlencoded',
          },
          body,
        });
  const etsyId = parseEtsyListingId(payload) ?? listing.etsyId;

  if (etsyId === null) {
    throw new Error('Etsy did not return a listing id.');
  }

  await prisma.etsyListing.update({
    where: {
      id: listing.id,
    },
    data: {
      etsyId,
      shopId: context.shop.etsyShopId.toString(),
      shopSectionId:
        context.section.etsyShopSectionId === null ? null : Number(context.section.etsyShopSectionId),
      state: parseEtsyListingState(payload) ?? listing.state ?? 'draft',
      url: parseEtsyListingUrl(payload),
      rawJson: toRawJson(payload),
    },
  });
}

function parseAssetId(payload: unknown, key: 'listing_image_id' | 'listing_file_id') {
  if (payload && typeof payload === 'object' && key in payload) {
    const value = (payload as Record<string, unknown>)[key];
    return value === null || value === undefined ? null : String(value);
  }
  return null;
}

type EtsyTaxonomyProperty = {
  property_id?: number;
  display_name?: string;
  name?: string;
  possible_values?: Array<{ value_id?: number; name?: string }>;
};

function extractTaxonomyProperties(payload: unknown): EtsyTaxonomyProperty[] {
  if (Array.isArray(payload)) return payload as EtsyTaxonomyProperty[];
  if (payload && typeof payload === 'object' && 'results' in payload && Array.isArray(payload.results)) {
    return payload.results as EtsyTaxonomyProperty[];
  }
  return [];
}

function normalizePropertyName(value: string) {
  return value.trim().toLocaleLowerCase().replace('colour', 'color');
}

function normalizeColourForCompare(value: string) {
  return normalizeForCompare(value).replace(/\bgrey\b/g, 'gray');
}

async function syncListingColours(listing: {
  etsyId: string;
  taxonomyId: number | null;
  primaryColour: string | null;
  secondaryColour: string | null;
}, shopId: string) {
  const selectedColours = [
    { propertyName: 'primary color', value: listing.primaryColour },
    { propertyName: 'secondary color', value: listing.secondaryColour },
  ].filter((selection): selection is { propertyName: string; value: string } => selection.value !== null);

  if (selectedColours.length === 0) return;
  if (listing.taxonomyId === null) throw new Error('Choose a taxonomy before syncing listing colours.');

  const propertiesPayload = await fetchEtsyListingMutation<unknown>(
    `/seller-taxonomy/nodes/${encodeURIComponent(listing.taxonomyId)}/properties`,
    { method: 'GET' }
  );
  const properties = extractTaxonomyProperties(propertiesPayload);

  for (const selection of selectedColours) {
    const property = properties.find((item) =>
      normalizePropertyName(item.display_name ?? item.name ?? '') === selection.propertyName
    );
    if (!property?.property_id) {
      throw new Error(`Etsy taxonomy ${listing.taxonomyId} does not support ${selection.propertyName}.`);
    }

    const colour = ETSY_PRIMARY_COLOURS.find((option) =>
      option.value === selection.value || (selection.value === 'grey' && option.value === 'gray')
    );
    const colourLabel = colour && 'etsyLabel' in colour ? colour.etsyLabel : colour?.label ?? selection.value;
    const possibleValue = property.possible_values?.find((value) =>
      normalizeColourForCompare(value.name ?? '') === normalizeColourForCompare(colourLabel)
    );
    if (!possibleValue?.value_id) {
      throw new Error(`${colourLabel} is not available for Etsy ${selection.propertyName}.`);
    }

    const body = new URLSearchParams();
    body.set('value_ids', String(possibleValue.value_id));
    body.set('values', possibleValue.name ?? colourLabel);
    await fetchEtsyListingMutation<unknown>(
      `/shops/${encodeURIComponent(shopId)}/listings/${encodeURIComponent(listing.etsyId)}/properties/${property.property_id}`,
      {
        method: 'PUT',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body,
      }
    );
  }
}

async function uploadEtsyAsset(pathname: string, field: 'image' | 'file', filePath: string, fileName: string, rank: number) {
  const formData = new FormData();
  formData.set(field, new Blob([new Uint8Array(await readFile(filePath))]), fileName);
  formData.set('rank', String(rank));
  if (field === 'file') formData.set('name', fileName);
  return fetchEtsyListingMutation<unknown>(pathname, { method: 'POST', body: formData });
}

async function associateEtsyAsset(
  pathname: string,
  field: 'listing_image_id' | 'listing_file_id',
  assetId: string,
  rank: number,
  name?: string
) {
  const formData = new FormData();
  formData.set(field, assetId);
  formData.set('rank', String(rank));
  if (name) formData.set('name', name);
  return fetchEtsyListingMutation<unknown>(pathname, { method: 'POST', body: formData });
}

function remoteAssetIds(payload: unknown, idField: 'listing_image_id' | 'listing_file_id') {
  return [...remoteAssetsById(payload, idField).keys()];
}

function remoteAssetsById(payload: unknown, idField: 'listing_image_id' | 'listing_file_id') {
  const records = new Map<string, Record<string, unknown>>();
  if (!payload || typeof payload !== 'object' || !('results' in payload) || !Array.isArray(payload.results)) return records;
  for (const item of payload.results) {
    if (!item || typeof item !== 'object' || !(idField in item)) continue;
    const id = (item as Record<string, unknown>)[idField];
    if (id !== null && id !== undefined) records.set(String(id), item as Record<string, unknown>);
  }
  return records;
}

function remoteAssetRank(asset: Record<string, unknown> | undefined) {
  const rank = Number(asset?.rank);
  return Number.isInteger(rank) && rank > 0 ? rank : null;
}

function remoteFileName(asset: Record<string, unknown> | undefined) {
  for (const value of [asset?.filename, asset?.name]) {
    if (typeof value === 'string' && value.trim()) return value.trim();
  }
  return null;
}

async function syncChangedImages(
  shopId: string,
  etsyListingId: string,
  listingDirectory: string,
  images: Array<{ id: number; localFileName: string | null; originalFileName: string | null; etsyImageId: string | null; rank: number | null }>
) {
  const assetPath = `/shops/${encodeURIComponent(shopId)}/listings/${encodeURIComponent(etsyListingId)}`;
  const remotePayload = await fetchEtsyListingMutation<unknown>(
    `/listings/${encodeURIComponent(etsyListingId)}/images`,
    { method: 'GET' }
  );
  const remoteAssets = remoteAssetsById(remotePayload, 'listing_image_id');
  const remoteIds = new Set(remoteAssets.keys());
  const retainedIds = new Set(images.flatMap((image) => image.etsyImageId ? [image.etsyImageId] : []));

  for (const remoteId of remoteIds) {
    if (!retainedIds.has(remoteId)) {
      await fetchEtsyListingMutation<null>(`${assetPath}/images/${encodeURIComponent(remoteId)}`, { method: 'DELETE' });
    }
  }

  for (let index = 0; index < images.length; index += 1) {
    const image = images[index];
    if (!image.localFileName) continue;
    const rank = index + 1;
    let etsyImageId = image.etsyImageId;
    if (image.etsyImageId && remoteIds.has(image.etsyImageId)) {
      if (remoteAssetRank(remoteAssets.get(image.etsyImageId)) !== rank) {
        const payload = await associateEtsyAsset(`${assetPath}/images`, 'listing_image_id', image.etsyImageId, rank);
        etsyImageId = parseAssetId(payload, 'listing_image_id') ?? image.etsyImageId;
      }
    } else {
      const payload = await uploadEtsyAsset(
          `${assetPath}/images`,
          'image',
          path.join(listingDirectory, image.localFileName),
          image.originalFileName ?? image.localFileName,
          rank
        );
      etsyImageId = parseAssetId(payload, 'listing_image_id');
    }
    if (!etsyImageId) throw new Error(`Etsy did not return an image id for ${image.originalFileName ?? image.localFileName}.`);
    if (image.etsyImageId !== etsyImageId || image.rank !== rank) {
      await prisma.etsyListingImage.update({ where: { id: image.id }, data: { etsyImageId, rank } });
    }
  }
}

async function syncChangedDownloads(
  shopId: string,
  etsyListingId: string,
  listingDirectory: string,
  files: Array<{ id: number; localFileName: string | null; originalFileName: string | null; filename: string | null; rank: number | null; etsyListingFileId: string | null }>,
  zippedFiles: Array<{ id: number; fileName: string; etsyListingFileId: string | null }>
) {
  const assetPath = `/shops/${encodeURIComponent(shopId)}/listings/${encodeURIComponent(etsyListingId)}`;
  const remotePayload = await fetchEtsyListingMutation<unknown>(`${assetPath}/files`, { method: 'GET' });
  const remoteAssets = remoteAssetsById(remotePayload, 'listing_file_id');
  const remoteIds = new Set(remoteAssets.keys());
  const usingZips = zippedFiles.length > 0;
  const retainedIds = new Set((usingZips ? zippedFiles : files).flatMap((file) =>
    file.etsyListingFileId ? [file.etsyListingFileId] : []
  ));

  for (const remoteId of remoteIds) {
    if (!retainedIds.has(remoteId)) {
      await fetchEtsyListingMutation<null>(`${assetPath}/files/${encodeURIComponent(remoteId)}`, { method: 'DELETE' });
    }
  }

  if (usingZips) {
    for (let index = 0; index < zippedFiles.length; index += 1) {
      const zip = zippedFiles[index];
      const rank = index + 1;
      let etsyListingFileId = zip.etsyListingFileId;
      const remoteAsset = zip.etsyListingFileId ? remoteAssets.get(zip.etsyListingFileId) : undefined;
      if (zip.etsyListingFileId && remoteAsset) {
        const remoteName = remoteFileName(remoteAsset);
        if (remoteAssetRank(remoteAsset) !== rank || (remoteName !== null && remoteName !== zip.fileName)) {
          const payload = await associateEtsyAsset(`${assetPath}/files`, 'listing_file_id', zip.etsyListingFileId, rank, zip.fileName);
          etsyListingFileId = parseAssetId(payload, 'listing_file_id') ?? zip.etsyListingFileId;
        }
      } else {
        const payload = await uploadEtsyAsset(`${assetPath}/files`, 'file', path.join(listingDirectory, 'zipped', zip.fileName), zip.fileName, rank);
        etsyListingFileId = parseAssetId(payload, 'listing_file_id');
      }
      if (!etsyListingFileId) throw new Error(`Etsy did not return a file id for ${zip.fileName}.`);
      if (zip.etsyListingFileId !== etsyListingFileId) {
        await prisma.etsyListingZip.update({ where: { id: zip.id }, data: { etsyListingFileId } });
      }
    }
    return;
  }

  if (files.length > 5) throw new Error('Create up to five ZIP files before syncing more than five downloads.');
  for (let index = 0; index < files.length; index += 1) {
    const file = files[index];
    if (!file.localFileName) continue;
    const rank = index + 1;
    const name = file.originalFileName ?? file.localFileName;
    let etsyListingFileId = file.etsyListingFileId;
    const remoteAsset = file.etsyListingFileId ? remoteAssets.get(file.etsyListingFileId) : undefined;
    if (file.etsyListingFileId && remoteAsset) {
      const remoteName = remoteFileName(remoteAsset);
      if (remoteAssetRank(remoteAsset) !== rank || (remoteName !== null && remoteName !== name)) {
        const payload = await associateEtsyAsset(`${assetPath}/files`, 'listing_file_id', file.etsyListingFileId, rank, name);
        etsyListingFileId = parseAssetId(payload, 'listing_file_id') ?? file.etsyListingFileId;
      }
    } else {
      const payload = await uploadEtsyAsset(`${assetPath}/files`, 'file', path.join(listingDirectory, 'downloads', file.localFileName), name, rank);
      etsyListingFileId = parseAssetId(payload, 'listing_file_id');
    }
    if (!etsyListingFileId) throw new Error(`Etsy did not return a file id for ${name}.`);
    if (file.etsyListingFileId !== etsyListingFileId || file.rank !== rank || file.filename !== name) {
      await prisma.etsyListingFile.update({ where: { id: file.id }, data: { etsyListingFileId, rank, filename: name } });
    }
  }
}

async function removeRemoteEtsyDownloads(shopId: string, etsyListingId: string, listingId: number) {
  const assetPath = `/shops/${encodeURIComponent(shopId)}/listings/${encodeURIComponent(etsyListingId)}`;
  const remotePayload = await fetchEtsyListingMutation<unknown>(`${assetPath}/files`, { method: 'GET' });
  for (const remoteId of remoteAssetIds(remotePayload, 'listing_file_id')) {
    await fetchEtsyListingMutation<null>(`${assetPath}/files/${encodeURIComponent(remoteId)}`, { method: 'DELETE' });
  }
  await prisma.$transaction([
    prisma.etsyListingFile.updateMany({ where: { listingId }, data: { etsyListingFileId: null } }),
    prisma.etsyListingZip.updateMany({ where: { listingId }, data: { etsyListingFileId: null } }),
  ]);
}

type ListingProductForSync = {
  id: number;
  productKey: string;
  productType: string;
  sizeKey: string | null;
  frameKey: string | null;
  sku: string;
  priceKey: string;
};

function productPricePence(product: Pick<ListingProductForSync, 'priceKey'>, prices: Map<string, number>) {
  const stored = prices.get(product.priceKey);
  const fallback = PRICE_OPTION_BY_KEY.get(product.priceKey)?.defaultAmountPence;
  const amountPence = stored ?? fallback;
  if (!Number.isInteger(amountPence) || (amountPence ?? 0) <= 0) {
    throw new Error(`Set a valid price for ${product.priceKey} on the Set Prices page before syncing.`);
  }
  return amountPence!;
}

type EtsyRemoteProductMapping = {
  etsyProductId: string;
  etsyOfferingId: string;
};

function remoteProductMappingForSku(inventory: EtsyInventory, sku: string): EtsyRemoteProductMapping {
  const normalizedSku = sku.trim().toLocaleLowerCase();
  const product = (inventory.products ?? []).find((item) =>
    typeof item.sku === 'string' && item.sku.trim().toLocaleLowerCase() === normalizedSku
  );
  const offering = product?.offerings?.find((item) => item.is_deleted !== true) ?? product?.offerings?.[0];
  const etsyProductId = positiveEtsyId(product?.product_id);
  const etsyOfferingId = positiveEtsyId(offering?.offering_id);
  if (!etsyProductId || !etsyOfferingId) {
    throw new Error(`Etsy did not return product and offering ids for SKU ${sku}.`);
  }
  return { etsyProductId, etsyOfferingId };
}

async function existingInventoryReadinessStateId(etsyListingId: string, rawJson: Prisma.JsonValue | null) {
  const explicitlyConfigured = positiveEtsyId(process.env.ETSY_READINESS_STATE_ID);
  if (explicitlyConfigured) return explicitlyConfigured;
  const raw = jsonObject(rawJson);
  const rawId = positiveEtsyId(raw?.readiness_state_id);
  if (rawId) return rawId;
  const inventory = await fetchEtsyListingMutation<EtsyInventory>(
    `/listings/${encodeURIComponent(etsyListingId)}/inventory?legacy=false`,
    { method: 'GET' }
  );
  const readinessStateId = oneConfiguredId(
    (inventory.products ?? []).flatMap((product) =>
      (product.offerings ?? []).map((offering) => positiveEtsyId(offering.readiness_state_id))
    ),
    'This listing uses more than one Etsy processing profile. Set ETSY_READINESS_STATE_ID before converting it to a Digital listing.'
  );
  if (!readinessStateId) {
    throw new Error('Etsy did not return the processing profile needed to safely reset this physical listing before converting it to Digital.');
  }
  return readinessStateId;
}

async function putSingleDigitalInventory(
  etsyListingId: string,
  product: ListingProductForSync,
  listingSku: string,
  amountPence: number,
  quantity: number,
  readinessStateId: string | null
) {
  const numericReadinessStateId = readinessStateId === null ? null : Number(readinessStateId);
  if (numericReadinessStateId !== null && (!Number.isSafeInteger(numericReadinessStateId) || numericReadinessStateId <= 0)) {
    throw new Error('The selected Etsy processing profile id is invalid.');
  }
  const body = buildSingleDigitalInventoryBody(
    { sku: listingSku, amountPence },
    quantity,
    numericReadinessStateId ?? undefined
  );
  const inventory = await fetchEtsyListingMutation<EtsyInventory>(
    `/listings/${encodeURIComponent(etsyListingId)}/inventory?legacy=false&max_variations_supported=3`,
    {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    }
  );
  if (inventory.products?.length) return remoteProductMappingForSku(inventory, listingSku);
  const saved = await fetchEtsyListingMutation<EtsyInventory>(
    `/listings/${encodeURIComponent(etsyListingId)}/inventory?legacy=false`,
    { method: 'GET' }
  );
  return remoteProductMappingForSku(saved, listingSku);
}

async function persistDigitalProductMapping(
  listingId: number,
  etsyListingId: string,
  product: ListingProductForSync,
  mapping: EtsyRemoteProductMapping
) {
  await prisma.$transaction(async (tx) => {
    await tx.etsyListingProduct.updateMany({
      where: { listingId },
      data: { etsyListingId, etsyProductId: null, etsyOfferingId: null },
    });
    await tx.etsyListingProduct.update({
      where: { id: product.id },
      data: { etsyListingId, ...mapping },
    });
    await tx.etsyListingPriceMapping.deleteMany({
      where: { listingId, fulfilmentProvider: 'Etsy inventory' },
    });
    await tx.etsyListingPriceMapping.create({
      data: {
        listingId,
        productKey: product.priceKey,
        ...mapping,
        fulfilmentProvider: 'Etsy inventory',
        isSupported: true,
      },
    });
  });
}

async function syncPhysicalProductInventory(
  listing: { id: number; etsyId: string | null; quantity: number | null; productConfig: { sku: string | null } | null; products: ListingProductForSync[]; frameOptions: Array<{ frameKey: string; enabled: boolean }> },
  deliverySettings: PhysicalDeliverySettings,
  includeDigitalProduct: boolean
) {
  if (!listing.etsyId) throw new Error('Etsy listing was not created before its inventory was synced.');
  const etsyListingId = listing.etsyId;
  const physicalProducts = listing.products.filter((product) => product.productType === 'physical');
  if (physicalProducts.length === 0) throw new Error('Select at least one physical Etsy product before syncing.');
  const inventoryProducts = includeDigitalProduct
    ? listing.products.filter((product) => product.productType === 'physical' || product.productType === 'digital')
    : physicalProducts;
  const listingSku = listing.productConfig?.sku?.trim();
  if (!listingSku) throw new Error('Enter the listing Etsy SKU before syncing.');

  const priceKeys = [...new Set(inventoryProducts.map(({ priceKey }) => priceKey))];
  const savedPrices = await prisma.adminProductPrice.findMany({
    where: { productKey: { in: priceKeys } },
    select: { productKey: true, amountPence: true },
  });
  const prices = new Map(savedPrices.map(({ productKey, amountPence }) => [productKey, amountPence]));
  const localProducts: LocalSellableProduct[] = inventoryProducts.map((product) => ({
    key: product.productKey,
    productType: product.productType,
    sizeKey: product.sizeKey,
    frameKey: product.frameKey,
    sku: listingSku,
    amountPence: productPricePence(product, prices),
  }));
  const readinessStateId = Number(deliverySettings.readinessStateId);
  if (!Number.isSafeInteger(readinessStateId) || readinessStateId <= 0) {
    throw new Error('The selected Etsy processing profile id is invalid.');
  }
  const plan = buildEtsyInventoryPlan(
    localProducts,
    listing.frameOptions.filter(({ enabled }) => enabled).map(({ frameKey }) => frameKey),
    listing.quantity ?? 1,
    readinessStateId
  );
  const inventoryReadPath = `/listings/${encodeURIComponent(etsyListingId)}/inventory?legacy=false`;
  const inventoryWritePath = `${inventoryReadPath}&max_variations_supported=2`;
  let saved = await fetchEtsyListingMutation<EtsyInventory>(inventoryWritePath, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(plan.body),
  });
  if (!saved.products?.length) {
    saved = await fetchEtsyListingMutation<EtsyInventory>(inventoryReadPath, { method: 'GET' });
  }

  const propertySignature = (product: Record<string, unknown>) => {
    const values = Array.isArray(product.property_values) ? product.property_values : [];
    return values.map((property) => {
      if (!property || typeof property !== 'object') return '';
      const fields = property as Record<string, unknown>;
      const names = Array.isArray(fields.values) ? fields.values.map(String) : [];
      return `${String(fields.property_id ?? '')}:${names.join('|')}`;
    }).join(';');
  };
  const returnedByProperties = new Map((saved.products ?? []).map((product) => [propertySignature(product), product]));
  const mapped = plan.concreteProducts.map((concrete, index) => {
    const remote = returnedByProperties.get(propertySignature(concrete)) ?? saved.products?.[index];
    const offering = remote?.offerings?.find((item) => item.is_deleted !== true) ?? remote?.offerings?.[0];
    const etsyProductId = positiveEtsyId(remote?.product_id);
    const etsyOfferingId = positiveEtsyId(offering?.offering_id);
    if (!etsyProductId || !etsyOfferingId) {
      throw new Error(`Etsy did not return product and offering ids for ${propertySignature(concrete) || listingSku}.`);
    }
    const local = inventoryProducts.find(({ productKey }) => productKey === concrete.localProductKey)!;
    return { local, etsyProductId, etsyOfferingId };
  });

  await prisma.$transaction(async (tx) => {
    await tx.etsyListingProduct.updateMany({
      where: { listingId: listing.id },
      data: { etsyListingId },
    });
    for (const product of inventoryProducts) {
      const first = mapped.find(({ local }) => local.id === product.id);
      await tx.etsyListingProduct.update({
        where: { id: product.id },
        data: {
          etsyListingId,
          etsyProductId: first?.etsyProductId ?? null,
          etsyOfferingId: first?.etsyOfferingId ?? null,
        },
      });
    }
    await tx.etsyListingPriceMapping.deleteMany({
      where: { listingId: listing.id, fulfilmentProvider: 'Etsy inventory' },
    });
    await tx.etsyListingPriceMapping.createMany({
      data: mapped.map(({ local, etsyProductId, etsyOfferingId }) => ({
        listingId: listing.id,
        productKey: local.priceKey,
        etsyProductId,
        etsyOfferingId,
        fulfilmentProvider: 'Etsy inventory',
        isSupported: true,
        shippingProfileId: deliverySettings.shippingProfileId,
      })),
    });
  });
}

type EtsyPersonalizationQuestion = {
  question_id?: number | string;
  question_text?: string;
  instructions?: string | null;
  question_type?: string;
  required?: boolean;
  max_allowed_characters?: number;
  add_on_price?: number | { amount?: number; divisor?: number } | null;
};

function personalizationQuestions(payload: unknown): EtsyPersonalizationQuestion[] {
  if (!payload || typeof payload !== 'object' || !('personalization_questions' in payload)) return [];
  const questions = (payload as { personalization_questions?: unknown }).personalization_questions;
  return Array.isArray(questions)
    ? questions.filter((question): question is EtsyPersonalizationQuestion => question !== null && typeof question === 'object')
    : [];
}

async function syncListingPersonalization(
  shopId: string,
  etsyListingId: string,
  customTop: boolean,
  customBottom: boolean
) {
  const desired = buildPersonalizationQuestions(customTop, customBottom);
  const currentPayload = await fetchEtsyListingMutation<unknown>(
    `/listings/${encodeURIComponent(etsyListingId)}/personalization`,
    { method: 'GET' }
  );
  const current = personalizationQuestions(currentPayload);
  const mutationPath = `/shops/${encodeURIComponent(shopId)}/listings/${encodeURIComponent(etsyListingId)}/personalization`;
  if (desired.length === 0) {
    if (current.length > 0) await fetchEtsyListingMutation<null>(mutationPath, { method: 'DELETE' });
    return;
  }
  const alreadyCurrent = current.length === desired.length && desired.every((question) => {
    const saved = current.find((item) => item.question_text?.trim() === question.question_text);
    const rawPrice = saved?.add_on_price;
    const savedFeePence = typeof rawPrice === 'number'
      ? Math.round(rawPrice * 100)
      : rawPrice && typeof rawPrice === 'object' && typeof rawPrice.amount === 'number'
        ? Math.round(rawPrice.amount * 100 / (rawPrice.divisor || 100))
        : null;
    const expectedFeePence = Math.round(question.add_on_price * 100);
    return saved?.question_type === question.question_type
      && saved.required === question.required
      && saved.max_allowed_characters === question.max_allowed_characters
      && (saved.instructions ?? '') === question.instructions
      && (savedFeePence ?? 0) === expectedFeePence;
  });
  if (alreadyCurrent) return;
  const idByText = new Map(current.flatMap((question) => {
    const id = positiveEtsyId(question.question_id);
    const text = question.question_text?.trim();
    return id && text ? [[text, id] as const] : [];
  }));
  const questions = desired.map((question) => {
    const questionId = idByText.get(question.question_text);
    return { ...question, ...(questionId ? { question_id: questionId } : {}) };
  });
  await fetchEtsyListingMutation<unknown>(
    `${mutationPath}?supports_multiple_personalization_questions=true`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ personalization_questions: questions }),
    }
  );
}

export async function syncListingToEtsy(shopId: string, sectionId: string, subSectionId: string, listingId: string) {
  const context = await getListingContext(shopId, sectionId, subSectionId);

  if (context.section.etsyShopSectionId === null) throw new Error('Create this section on Etsy before syncing its listings.');

  const numericListingId = Number(listingId);
  let current = await prisma.etsyListing.findFirst({
    where: { id: numericListingId, subSectionId: context.subSection.id },
    include: {
      productConfig: true,
      sizeOptions: true,
      frameOptions: true,
      products: { orderBy: [{ position: 'asc' }, { id: 'asc' }] },
      priceMappings: { select: { shippingProfileId: true } },
    },
  });
  if (!current) throw new Error('Listing not found.');

  if (!current.productConfig || current.sizeOptions.length < 10 || current.frameOptions.length < 4) {
    await ensureListingProductDefaults(current.id);
    current = await prisma.etsyListing.findUnique({
      where: { id: current.id },
      include: {
        productConfig: true,
        sizeOptions: true,
        frameOptions: true,
        products: { orderBy: [{ position: 'asc' }, { id: 'asc' }] },
        priceMappings: { select: { shippingProfileId: true } },
      },
    });
    if (!current) throw new Error('Listing not found.');
  }
  if (!current.productConfig) throw new Error('Choose the Etsy Products for this listing before syncing.');

  const listingType = effectiveEtsyListingType(current);
  const currentRaw = jsonObject(current.rawJson);
  const remoteListingType = typeof currentRaw?.listing_type === 'string'
    ? currentRaw.listing_type
    : typeof currentRaw?.type === 'string'
      ? currentRaw.type
      : null;
  const listingTypeChanged = current.etsyId === null || remoteListingType !== listingType;
  const digitalProducts = current.products.filter((product) => product.productType === 'digital');
  const physicalProducts = current.products.filter((product) => product.productType === 'physical');
  if (listingType === 'download' && digitalProducts.length === 0) {
    throw new Error('Enable Digital Download on the Etsy Products tab before syncing a Digital listing.');
  }
  if (listingType !== 'download' && physicalProducts.length === 0) {
    throw new Error('Select at least one size and frame option on the Etsy Products tab before syncing a Physical listing.');
  }
  if (listingType === 'both' && digitalProducts.length === 0) {
    throw new Error('Digital Download is enabled, but no digital Etsy product was generated. Save the Etsy Products tab again.');
  }

  const baseProducts = listingType === 'download' ? digitalProducts : physicalProducts;
  const basePriceKeys = [...new Set(baseProducts.map(({ priceKey }) => priceKey))];
  const baseSavedPrices = await prisma.adminProductPrice.findMany({
    where: { productKey: { in: basePriceKeys } },
    select: { productKey: true, amountPence: true },
  });
  const basePrices = new Map(baseSavedPrices.map(({ productKey, amountPence }) => [productKey, amountPence]));
  const basePriceAmount = Math.min(...baseProducts.map((product) => productPricePence(product, basePrices)));
  const taxonomyId = resolveEtsyListingMode(current.etsyProductType, current.productConfig.digitalDownload).taxonomyId;
  const taxonomyChanged = current.taxonomyId !== taxonomyId;

  await prisma.etsyListing.update({
    where: { id: current.id },
    data: {
      description: current.description?.trim() ? current.description : current.title,
      quantity: current.quantity ?? 999,
      priceAmount: basePriceAmount,
      priceDivisor: 100,
      priceCurrencyCode: current.priceCurrencyCode ?? 'GBP',
      taxonomyId,
      whoMade: current.whoMade ?? 'i_did',
      whenMade: current.whenMade ?? '2020_2026',
      isSupply: current.isSupply ?? false,
      shouldAutoRenew: current.shouldAutoRenew ?? true,
      language: current.language ?? 'en-US',
      shopSectionId: Number(context.section.etsyShopSectionId),
    },
  });

  const isNewListing = current.etsyId === null;
  const syncDetails = isNewListing || current.detailsChanged;
  const syncTags = isNewListing || current.tagsChanged;
  const syncImages = isNewListing || current.imagesChanged;
  const syncProducts = isNewListing || current.productsChanged;
  const syncDownloads = isNewListing
    || current.downloadsChanged
    || (current.productsChanged && listingTypeChanged && listingType !== 'physical');
  const deliverySettings = listingType === 'download' || !syncProducts
    ? null
    : await resolvePhysicalDeliverySettings(context.shop.etsyShopId.toString(), current);
  let resetDigitalMapping: EtsyRemoteProductMapping | null = null;
  if (
    listingType === 'download'
    && syncProducts
    && current.etsyId
    && (remoteListingType === 'physical' || remoteListingType === 'both')
  ) {
    const readinessStateId = await existingInventoryReadinessStateId(current.etsyId, current.rawJson);
    resetDigitalMapping = await putSingleDigitalInventory(
      current.etsyId,
      digitalProducts[0],
      current.productConfig.sku ?? digitalProducts[0].sku,
      productPricePence(digitalProducts[0], basePrices),
      current.quantity ?? 999,
      readinessStateId
    );
  }

  if (listingType === 'physical' && current.etsyId && (listingTypeChanged || current.downloadsChanged)) {
    await removeRemoteEtsyDownloads(context.shop.etsyShopId.toString(), current.etsyId, current.id);
  }

  if (syncDetails || syncTags || syncProducts || isNewListing) {
    await pushListing(
      shopId,
      sectionId,
      subSectionId,
      listingId,
      { details: syncDetails, tags: syncTags, products: syncProducts },
      deliverySettings
    );
  }
  const listing = await prisma.etsyListing.findUnique({
    where: { id: current.id },
    include: {
      images: { orderBy: [{ rank: 'asc' }, { id: 'asc' }] },
      files: { orderBy: [{ rank: 'asc' }, { id: 'asc' }] },
      zippedFiles: { orderBy: [{ zipNumber: 'asc' }] },
      dropboxFiles: { select: { id: true } },
      productConfig: true,
      products: { orderBy: [{ position: 'asc' }, { id: 'asc' }] },
      frameOptions: { orderBy: [{ position: 'asc' }, { id: 'asc' }] },
    },
  });
  if (!listing?.etsyId || !listing.productConfig) throw new Error('Etsy listing was not created.');

  if (syncDetails || taxonomyChanged) {
    await syncListingColours(
      {
        etsyId: listing.etsyId,
        taxonomyId: listing.taxonomyId,
        primaryColour: listing.primaryColour,
        secondaryColour: listing.secondaryColour,
      },
      context.shop.etsyShopId.toString()
    );
  }

  const listingDirectory = getListingDirectoryPath(context.shop.displayName, context.section.title, context.subSection.name, listing.localDirectoryName ?? `Listing-${listing.id}`);
  if (syncImages) {
    // Preserve legacy rows above rank ten locally, while enforcing Etsy's
    // ten-image listing limit for the active image set.
    await syncChangedImages(context.shop.etsyShopId.toString(), listing.etsyId, listingDirectory, listing.images.slice(0, 10));
  }
  if (syncProducts) {
    if (listingType !== 'download') {
      if (!deliverySettings) throw new Error('Etsy delivery settings were not resolved for this physical listing.');
      await syncPhysicalProductInventory(listing, deliverySettings, listingType === 'both');
    } else {
      const digitalProduct = listing.products.find((product) => product.productType === 'digital');
      if (!digitalProduct) throw new Error('The Digital Download Etsy product is missing.');
      const mapping = resetDigitalMapping ?? await putSingleDigitalInventory(
        listing.etsyId,
        digitalProduct,
        listing.productConfig.sku ?? digitalProduct.sku,
        productPricePence(digitalProduct, basePrices),
        listing.quantity ?? 999,
        null
      );
      await persistDigitalProductMapping(listing.id, listing.etsyId, digitalProduct, mapping);
    }
    await syncListingPersonalization(
      context.shop.etsyShopId.toString(),
      listing.etsyId,
      listing.productConfig.customTop,
      listing.productConfig.customBottom
    );
  }
  if (syncDownloads && listingType !== 'physical') {
    const etsyDownloadFiles = listing.dropboxFiles.length > 0
      ? listing.files.filter(isDropboxInstructionPdfFile)
      : listing.files;
    await syncChangedDownloads(
      context.shop.etsyShopId.toString(),
      listing.etsyId,
      listingDirectory,
      etsyDownloadFiles,
      listing.zippedFiles
    );
  }

  let verifiedListing: unknown = null;
  if (syncProducts || syncDownloads) {
    verifiedListing = await fetchEtsyListingMutation<unknown>(
      `/listings/${encodeURIComponent(listing.etsyId)}?legacy=false`,
      { method: 'GET' }
    );
    const verifiedRaw = verifiedListing && typeof verifiedListing === 'object'
      ? verifiedListing as Record<string, unknown>
      : null;
    if (verifiedRaw?.listing_type !== listingType) {
      throw new Error(`Etsy returned listing type ${String(verifiedRaw?.listing_type ?? 'unknown')} after ${listingType} was requested. The Etsy Products flag has been kept for retry.`);
    }
  }

  const syncedAt = new Date();
  await prisma.etsyListing.update({
    where: { id: listing.id },
    data: {
      lastSyncedAt: syncedAt,
      updatedAt: syncedAt,
      ...(verifiedListing ? { rawJson: toRawJson(verifiedListing) } : {}),
      ...(syncDetails ? { detailsChanged: false } : {}),
      ...(syncTags ? { tagsChanged: false } : {}),
      ...(syncImages ? { imagesChanged: false } : {}),
      ...(syncDownloads ? { downloadsChanged: false } : {}),
      ...(syncProducts ? { productsChanged: false } : {}),
    },
  });
}
