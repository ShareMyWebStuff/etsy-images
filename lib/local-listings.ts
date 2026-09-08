import { Prisma } from '@prisma/client';
import { readFile } from '@/lib/s3-listing-storage';
import path from 'node:path';
import {
  createListingDirectory,
  createSubSectionDirectory,
  listingDirectoryExists,
  listSubSectionListingDirectories,
  getListingDirectoryPath,
} from '@/lib/local-shop-directory';
import { getEtsyKeystring, getValidEtsyAccessToken } from '@/lib/etsy-oauth';
import { ETSY_PRIMARY_COLOURS } from '@/lib/etsy-colours';
import { deleteDropboxBundleFolder } from '@/lib/dropbox-bundle';
import { prisma } from '@/lib/prisma';

export type ImportableListingRow = {
  listingName: string;
};

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

async function createLocalListingRow(context: Awaited<ReturnType<typeof getListingContext>>, listingName: string) {
  const shopSectionId =
    context.section.etsyShopSectionId === null ? null : Number(context.section.etsyShopSectionId);

  return prisma.etsyListing.create({
    data: {
      shopId: context.shop.etsyShopId.toString(),
      shopSectionId: shopSectionId !== null && Number.isSafeInteger(shopSectionId) ? shopSectionId : null,
      title: listingName,
      state: 'local',
      subSectionId: context.subSection.id,
      localDirectoryName: listingName,
      isLocal: true,
      rawJson: Prisma.JsonNull,
    },
    select: {
      id: true,
    },
  });
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
  const inventory = await fetchEtsyListingMutation<EtsyInventory>(`${listingPath}/inventory`, { method: 'GET' });

  if (!inventory.products?.length) throw new Error('Etsy did not return listing inventory to update.');
  const price = priceAmount / priceDivisor;
  const requestBody = inventoryRequestBody(inventory, () => price);

  await fetchEtsyListingMutation<unknown>(`${listingPath}/inventory`, {
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
  const inventory = await fetchEtsyListingMutation<EtsyInventory>(`${listingPath}/inventory`, { method: 'GET' });
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

  await fetchEtsyListingMutation<unknown>(`${listingPath}/inventory`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(requestBody),
  });

  const saved = await fetchEtsyListingMutation<EtsyInventory>(`${listingPath}/inventory`, { method: 'GET' });
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
  isPersonalizable: boolean | null;
  primaryColour: string | null;
  secondaryColour: string | null;
  tags: Array<{ tag: string }>;
};

type MetadataSyncAreas = { details: boolean; tags: boolean };

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
  areas: MetadataSyncAreas = { details: true, tags: true }
) {
  const missingFields = [
    listing.title.trim() ? null : 'title',
    listing.description?.trim() ? null : 'description',
    listing.priceAmount !== null && listing.priceDivisor !== null && listing.priceDivisor !== 0 ? null : 'price',
    listing.taxonomyId !== null ? null : 'taxonomyId',
    listing.whoMade ? null : 'whoMade',
    listing.whenMade ? null : 'whenMade',
    listing.isSupply !== null ? null : 'isSupply',
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
  body.set('type', 'download');
  appendIfPresent(body, 'shop_section_id', listing.shopSectionId ?? (section.etsyShopSectionId === null ? null : Number(section.etsyShopSectionId)));
  appendIfPresent(body, 'should_auto_renew', listing.shouldAutoRenew);
  appendIfPresent(body, 'is_personalizable', listing.isPersonalizable);
  const tags = listing.tags.slice(0, 13).map(({ tag }) => tag.trim()).filter(Boolean);
  if (tags.length > 0 || (changedOnly && areas.tags)) body.set('tags', tags.join(','));
  if (!areas.details) {
    for (const key of [...body.keys()]) if (key !== 'tags') body.delete(key);
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
      type: unchanged('type', 'download'),
      shop_section_id: unchanged('shop_section_id', currentSectionId),
      should_auto_renew: unchanged('should_auto_renew', listing.shouldAutoRenew),
      is_personalizable: unchanged('is_personalizable', listing.isPersonalizable),
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
      isPersonalizable: true,
      primaryColour: true,
      secondaryColour: true,
      tags: { select: { tag: true }, orderBy: [{ position: 'asc' }] },
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
  await assertListingMissingFromDatabase(context.subSection.id, trimmedListingName);

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

  return createLocalListingRow(context, trimmedListingName);
}

export async function createLocalListing(shopId: string, sectionId: string, subSectionId: string, listingName: string) {
  const context = await getListingContext(shopId, sectionId, subSectionId);
  const trimmedListingName = normalizeName(listingName);

  if (!trimmedListingName) {
    throw new Error('Enter a listing name.');
  }

  await ensureSubSectionDirectory(context);
  await assertListingMissingFromDatabase(context.subSection.id, trimmedListingName);

  if (
    await listingDirectoryExists(
      context.shop.displayName,
      context.section.title,
      context.subSection.name,
      trimmedListingName
    )
  ) {
    throw new Error(`A local folder named "${trimmedListingName}" already exists. Use Import instead.`);
  }

  await createListingDirectory(context.shop.displayName, context.section.title, context.subSection.name, trimmedListingName);

  return createLocalListingRow(context, trimmedListingName);
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

export async function pushListing(
  shopId: string,
  sectionId: string,
  subSectionId: string,
  listingId: string,
  requestedAreas?: MetadataSyncAreas
) {
  const context = await getListingContext(shopId, sectionId, subSectionId);
  const listing = await loadListingForAction(context.subSection.id, listingId);
  const areas = listing.etsyId === null ? { details: true, tags: true } : requestedAreas ?? { details: true, tags: true };
  const body = buildPushListingBody(listing, context.section, listing.etsyId !== null, areas);
  const shopPath = `/shops/${encodeURIComponent(context.shop.etsyShopId.toString())}/listings`;
  const payload =
    listing.etsyId === null
      ? await fetchEtsyListingMutation<unknown>(shopPath, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/x-www-form-urlencoded',
          },
          body,
        })
      : body.size === 0
      ? listing.rawJson
      : await fetchEtsyListingMutation<unknown>(`${shopPath}/${encodeURIComponent(listing.etsyId)}`, {
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
  if (!payload || typeof payload !== 'object' || !('results' in payload) || !Array.isArray(payload.results)) return [];
  return payload.results.flatMap((item) => {
    if (!item || typeof item !== 'object' || !(idField in item)) return [];
    const id = (item as Record<string, unknown>)[idField];
    return id === null || id === undefined ? [] : [String(id)];
  });
}

async function syncChangedImages(
  shopId: string,
  etsyListingId: string,
  listingDirectory: string,
  images: Array<{ id: number; localFileName: string | null; originalFileName: string | null; etsyImageId: string | null }>
) {
  const assetPath = `/shops/${encodeURIComponent(shopId)}/listings/${encodeURIComponent(etsyListingId)}`;
  const remotePayload = await fetchEtsyListingMutation<unknown>(
    `/listings/${encodeURIComponent(etsyListingId)}/images`,
    { method: 'GET' }
  );
  const remoteIds = new Set(remoteAssetIds(remotePayload, 'listing_image_id'));
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
    const payload = image.etsyImageId && remoteIds.has(image.etsyImageId)
      ? await associateEtsyAsset(`${assetPath}/images`, 'listing_image_id', image.etsyImageId, rank)
      : await uploadEtsyAsset(
          `${assetPath}/images`,
          'image',
          path.join(listingDirectory, image.localFileName),
          image.originalFileName ?? image.localFileName,
          rank
        );
    const etsyImageId = parseAssetId(payload, 'listing_image_id') ?? image.etsyImageId;
    await prisma.etsyListingImage.update({ where: { id: image.id }, data: { etsyImageId, rank } });
  }
}

async function syncChangedDownloads(
  shopId: string,
  etsyListingId: string,
  listingDirectory: string,
  files: Array<{ id: number; localFileName: string | null; originalFileName: string | null; etsyListingFileId: string | null }>,
  zippedFiles: Array<{ id: number; fileName: string; etsyListingFileId: string | null }>
) {
  const assetPath = `/shops/${encodeURIComponent(shopId)}/listings/${encodeURIComponent(etsyListingId)}`;
  const remotePayload = await fetchEtsyListingMutation<unknown>(`${assetPath}/files`, { method: 'GET' });
  const remoteIds = new Set(remoteAssetIds(remotePayload, 'listing_file_id'));
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
      const payload = zip.etsyListingFileId && remoteIds.has(zip.etsyListingFileId)
        ? await associateEtsyAsset(`${assetPath}/files`, 'listing_file_id', zip.etsyListingFileId, rank, zip.fileName)
        : await uploadEtsyAsset(`${assetPath}/files`, 'file', path.join(listingDirectory, 'zipped', zip.fileName), zip.fileName, rank);
      const etsyListingFileId = parseAssetId(payload, 'listing_file_id') ?? zip.etsyListingFileId;
      await prisma.etsyListingZip.update({ where: { id: zip.id }, data: { etsyListingFileId } });
    }
    return;
  }

  if (files.length > 5) throw new Error('Create up to five ZIP files before syncing more than five downloads.');
  for (let index = 0; index < files.length; index += 1) {
    const file = files[index];
    if (!file.localFileName) continue;
    const rank = index + 1;
    const name = file.originalFileName ?? file.localFileName;
    const payload = file.etsyListingFileId && remoteIds.has(file.etsyListingFileId)
      ? await associateEtsyAsset(`${assetPath}/files`, 'listing_file_id', file.etsyListingFileId, rank, name)
      : await uploadEtsyAsset(`${assetPath}/files`, 'file', path.join(listingDirectory, 'downloads', file.localFileName), name, rank);
    const etsyListingFileId = parseAssetId(payload, 'listing_file_id') ?? file.etsyListingFileId;
    await prisma.etsyListingFile.update({ where: { id: file.id }, data: { etsyListingFileId, rank } });
  }
}

export async function syncListingToEtsy(shopId: string, sectionId: string, subSectionId: string, listingId: string) {
  const context = await getListingContext(shopId, sectionId, subSectionId);

  if (context.section.etsyShopSectionId === null) throw new Error('Create this section on Etsy before syncing its listings.');

  const numericListingId = Number(listingId);
  const current = await prisma.etsyListing.findFirst({ where: { id: numericListingId, subSectionId: context.subSection.id } });
  if (!current) throw new Error('Listing not found.');

  await prisma.etsyListing.update({
    where: { id: current.id },
    data: {
      description: current.description?.trim() ? current.description : current.title,
      quantity: current.quantity ?? 999,
      priceAmount: current.priceAmount ?? 417,
      priceDivisor: current.priceDivisor ?? 100,
      priceCurrencyCode: current.priceCurrencyCode ?? 'GBP',
      taxonomyId: current.taxonomyId ?? 2078,
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
  const syncDownloads = isNewListing || current.downloadsChanged;

  if (syncDetails || syncTags || isNewListing) {
    await pushListing(shopId, sectionId, subSectionId, listingId, { details: syncDetails, tags: syncTags });
  }
  const listing = await prisma.etsyListing.findUnique({
    where: { id: current.id },
    include: { images: { orderBy: [{ rank: 'asc' }, { id: 'asc' }] }, files: { orderBy: [{ rank: 'asc' }, { id: 'asc' }] }, zippedFiles: { orderBy: [{ zipNumber: 'asc' }] } },
  });
  if (!listing?.etsyId) throw new Error('Etsy listing was not created.');

  if (syncDetails) {
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
    await syncChangedImages(context.shop.etsyShopId.toString(), listing.etsyId, listingDirectory, listing.images);
  }
  if (syncDownloads) {
    await syncChangedDownloads(
      context.shop.etsyShopId.toString(),
      listing.etsyId,
      listingDirectory,
      listing.files,
      listing.zippedFiles
    );
  }

  const syncedAt = new Date();
  await prisma.etsyListing.update({
    where: { id: listing.id },
    data: {
      lastSyncedAt: syncedAt,
      updatedAt: syncedAt,
      ...(syncDetails ? { detailsChanged: false } : {}),
      ...(syncTags ? { tagsChanged: false } : {}),
      ...(syncImages ? { imagesChanged: false } : {}),
      ...(syncDownloads ? { downloadsChanged: false } : {}),
    },
  });
}
