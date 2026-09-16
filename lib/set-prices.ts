import { randomUUID } from 'node:crypto';
import { Prisma } from '@prisma/client';

import { EtsyVariationNotFoundError, updateEtsyListingPrice, updateEtsyListingVariationPrices } from '@/lib/local-listings';
import { prisma } from '@/lib/prisma';
import {
  ETSY_SYNCABLE_KEYS,
  PHYSICAL_KEYS,
  PRICE_OPTION_BY_KEY,
  PRICE_OPTIONS,
  PRICE_SECTIONS,
  digitalPriceKeyForSection,
  getDefaultPriceRows,
  validatePriceEntries,
  type PriceCategory,
  type ProductPriceKey,
} from '@/lib/set-prices-core';

export type PriceJobItemStatus = 'waiting' | 'updating' | 'updated' | 'failed' | 'skipped';
export type PriceJobStatus = 'waiting' | 'running' | 'completed';

export type SavedProductPrice = {
  key: ProductPriceKey;
  category: PriceCategory;
  label: string;
  amountPence: number;
  currencyCode: 'GBP';
  affectedListings: number;
  unsupportedMappings: number;
};

export type DeliveryProfileWarning = {
  listingId?: string;
  listingName?: string;
  message: string;
};

export type PriceUpdateJobView = {
  id: string;
  changedKeys: ProductPriceKey[];
  status: PriceJobStatus;
  total: number;
  processed: number;
  succeeded: number;
  failed: number;
  skipped: number;
  currentListing: string | null;
  completedAt: string | null;
  items: Array<{
    id: string;
    listingId: string;
    listingName: string;
    status: PriceJobItemStatus;
    attempts: number;
    message: string | null;
  }>;
};

export type SetPricesData = {
  sections: Array<{
    key: PriceCategory;
    title: string;
    description: string;
    prices: SavedProductPrice[];
  }>;
  deliveryWarnings: DeliveryProfileWarning[];
  pendingEtsy: {
    keys: ProductPriceKey[];
    affectedListings: number;
    skippedListings: number;
    deliveryWarnings: DeliveryProfileWarning[];
  };
  latestJob: PriceUpdateJobView | null;
};

export type SavePricesResult = {
  data: SetPricesData;
  changedKeys: ProductPriceKey[];
  affectedListings: number;
  skippedListings: number;
  deliveryWarnings: DeliveryProfileWarning[];
};

type PriceInitializer = {
  adminProductPrice: {
    createMany(args: {
      data: Array<{ productKey: string; category: string; amountPence: number; currencyCode: string }>;
      skipDuplicates: boolean;
    }): Promise<unknown>;
  };
};

export async function ensureDefaultPrices(client: PriceInitializer = prisma) {
  await client.adminProductPrice.createMany({ data: getDefaultPriceRows(), skipDuplicates: true });
}

function rawRecord(value: Prisma.JsonValue | null): Record<string, Prisma.JsonValue> | null {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, Prisma.JsonValue> : null;
}

function moneyAmount(value: Prisma.JsonValue | undefined) {
  const money = rawRecord(value ?? null);
  return money && typeof money.amount === 'number' ? money.amount : null;
}

type ListingForImpact = Awaited<ReturnType<typeof loadListingsForImpact>>[number];

async function loadListingsForImpact() {
  return prisma.etsyListing.findMany({
    where: { etsyId: { not: null } },
    select: {
      id: true,
      etsyId: true,
      title: true,
      localDirectoryName: true,
      rawJson: true,
      shopId: true,
      etsyProductType: true,
      numberOfItems: true,
      includeAllItems: true,
      productConfig: { select: { digitalDownload: true } },
      products: {
        select: { productType: true, priceKey: true },
        orderBy: [{ position: 'asc' }, { id: 'asc' }],
      },
      subSection: {
        select: {
          shopSection: { select: { numberOfDownloads: true, includeAllDownloads: true } },
        },
      },
      priceMappings: {
        select: {
          productKey: true,
          etsyProductId: true,
          etsyOfferingId: true,
          fulfilmentProvider: true,
          isSupported: true,
          shippingProfileId: true,
        },
      },
    },
    orderBy: { id: 'asc' },
  });
}

function listingDigitalKey(listing: ListingForImpact) {
  // Keep this tolerant of older rows/test fixtures while the additive product
  // migration is being rolled out; a missing relation falls back to listing data.
  const productKey = (listing.products ?? []).find((product) => product.productType === 'digital')?.priceKey;
  if (productKey && PRICE_OPTION_BY_KEY.get(productKey)?.category === 'digital') {
    return productKey as ProductPriceKey;
  }
  if (listing.etsyProductType !== 'digital' && !listing.productConfig?.digitalDownload) return null;
  return digitalPriceKeyForSection(listing.numberOfItems ?? 1, listing.includeAllItems);
}

export function getPhysicalDeliveryWarnings(listing: ListingForImpact, keys: ProductPriceKey[]) {
  if (!keys.some((key) => PHYSICAL_KEYS.has(key))) return [];
  const raw = rawRecord(listing.rawJson);
  const rawProfile = rawRecord(raw?.shipping_profile ?? null);
  const mappingProfileId = listing.priceMappings.find((mapping) => keys.includes(mapping.productKey as ProductPriceKey))?.shippingProfileId;
  const profileId = mappingProfileId
    ?? (raw && (typeof raw.shipping_profile_id === 'string' || typeof raw.shipping_profile_id === 'number')
      ? String(raw.shipping_profile_id)
      : null);
  const name = listing.localDirectoryName ?? listing.title;
  if (!profileId) {
    return [{ listingId: String(listing.id), listingName: name, message: `${name} has no Etsy delivery profile recorded.` }];
  }
  const destinations = rawProfile && Array.isArray(rawProfile.shipping_profile_destinations)
    ? rawProfile.shipping_profile_destinations
    : [];
  if (destinations.length === 0) {
    return [{ listingId: String(listing.id), listingName: name, message: `${name}'s delivery-profile charges are not available locally; verify destination charges before applying physical prices.` }];
  }
  const hasFreeDestination = destinations.some((destination) => {
    const row = rawRecord(destination);
    return moneyAmount(row?.primary_cost) === 0;
  });
  return hasFreeDestination
    ? [{ listingId: String(listing.id), listingName: name, message: `${name} has free delivery for at least one destination; the base price may not cover fulfilment costs worldwide.` }]
    : [];
}

type ImpactPlan = {
  listing: ListingForImpact;
  keys: ProductPriceKey[];
  canUpdate: boolean;
  skipReason: string | null;
};

export function buildImpactPlans(listings: ListingForImpact[], changedKeys: ProductPriceKey[]) {
  const changed = new Set(changedKeys);
  const plans: ImpactPlan[] = [];
  for (const listing of listings) {
    const keys = new Set<ProductPriceKey>();
    const digitalKey = listingDigitalKey(listing);
    if (digitalKey && changed.has(digitalKey)) keys.add(digitalKey);
    for (const mapping of listing.priceMappings) {
      if (PHYSICAL_KEYS.has(mapping.productKey as ProductPriceKey) && changed.has(mapping.productKey as ProductPriceKey)) {
        keys.add(mapping.productKey as ProductPriceKey);
      }
    }
    if (keys.size === 0) continue;

    const priceKeys = [...keys];
    const mappedKeys = priceKeys.filter((key) => PHYSICAL_KEYS.has(key)
      || (PRICE_OPTION_BY_KEY.get(key)?.category === 'digital' && listing.etsyProductType !== 'digital'));
    const requiredMappings = listing.priceMappings.filter((mapping) => mappedKeys.includes(mapping.productKey as ProductPriceKey));
    const unsupported = requiredMappings.find((mapping) => !mapping.isSupported);
    const incomplete = mappedKeys.find((key) => !requiredMappings.some((mapping) =>
      mapping.productKey === key && mapping.etsyProductId && mapping.etsyOfferingId
    ));
    const skipReason = unsupported
      ? `${unsupported.fulfilmentProvider ?? 'The configured fulfilment provider'} does not support ${PRICE_OPTION_BY_KEY.get(unsupported.productKey)?.label ?? unsupported.productKey}.`
      : incomplete
        ? `The Etsy product and offering IDs have not been mapped for ${PRICE_OPTION_BY_KEY.get(incomplete)?.label ?? incomplete}.`
        : null;
    plans.push({ listing, keys: priceKeys, canUpdate: skipReason === null, skipReason });
  }
  return plans;
}

async function getPriceImpact(changedKeys: ProductPriceKey[]) {
  const listings = await loadListingsForImpact();
  const plans = buildImpactPlans(listings, changedKeys);
  return {
    listings,
    plans,
    affectedListings: plans.filter((plan) => plan.canUpdate).length,
    skippedListings: plans.filter((plan) => !plan.canUpdate).length,
    deliveryWarnings: plans.flatMap((plan) => getPhysicalDeliveryWarnings(plan.listing, plan.keys)),
  };
}

async function getAllOptionImpact() {
  const listings = await loadListingsForImpact();
  const counts = new Map<ProductPriceKey, { affected: number; unsupported: number }>(
    PRICE_OPTIONS.map((option) => [option.key, { affected: 0, unsupported: 0 }])
  );
  const warnings: DeliveryProfileWarning[] = [];
  for (const plan of buildImpactPlans(listings, PRICE_OPTIONS.map((option) => option.key))) {
    for (const key of plan.keys) {
      const count = counts.get(key)!;
      if (plan.canUpdate) count.affected += 1;
      else count.unsupported += 1;
    }
    warnings.push(...getPhysicalDeliveryWarnings(plan.listing, plan.keys));
  }
  return { counts, warnings };
}

function jsonPriceKeys(value: Prisma.JsonValue): ProductPriceKey[] {
  if (!Array.isArray(value)) return [];
  return value.filter((key): key is ProductPriceKey =>
    typeof key === 'string' && ETSY_SYNCABLE_KEYS.has(key as ProductPriceKey)
  );
}

function mapJob(job: Awaited<ReturnType<typeof loadJobRecord>>): PriceUpdateJobView | null {
  if (!job) return null;
  return {
    id: job.id,
    changedKeys: [...parseChangedPrices(job.changedPrices).keys()],
    status: job.status as PriceJobStatus,
    total: job.total,
    processed: job.processed,
    succeeded: job.succeeded,
    failed: job.failed,
    skipped: job.skipped,
    currentListing: job.currentListing,
    completedAt: job.completedAt?.toISOString() ?? null,
    items: job.items.map((item) => ({
      id: String(item.id),
      listingId: String(item.listingId),
      listingName: item.listingName,
      status: item.status as PriceJobItemStatus,
      attempts: item.attempts,
      message: item.message,
    })),
  };
}

async function loadJobRecord(jobId: string) {
  return prisma.etsyPriceUpdateJob.findUnique({
    where: { id: jobId },
    include: { items: { orderBy: [{ id: 'asc' }] } },
  });
}

export async function getPriceUpdateJob(jobId: string) {
  await prisma.etsyPriceUpdateItem.updateMany({
    where: { jobId, status: 'updating', updatedAt: { lt: new Date(Date.now() - 10 * 60 * 1000) } },
    data: { status: 'waiting', message: 'Recovered after an interrupted update.' },
  });
  return mapJob(await loadJobRecord(jobId));
}

export async function getSetPricesData(): Promise<SetPricesData> {
  await ensureDefaultPrices();
  await prisma.etsyPriceUpdateItem.updateMany({
    where: { status: 'updating', updatedAt: { lt: new Date(Date.now() - 10 * 60 * 1000) } },
    data: { status: 'waiting', message: 'Recovered after an interrupted update.' },
  });
  const saved = await prisma.adminProductPrice.findMany({ orderBy: { id: 'asc' } });
  const pendingKeys = saved
    .filter((price) => price.etsySyncPending && ETSY_SYNCABLE_KEYS.has(price.productKey as ProductPriceKey))
    .map((price) => price.productKey as ProductPriceKey);
  const [impact, pendingImpact, latestJob] = await Promise.all([
    getAllOptionImpact(),
    getPriceImpact(pendingKeys),
    prisma.etsyPriceUpdateJob.findFirst({ orderBy: { createdAt: 'desc' }, include: { items: { orderBy: { id: 'asc' } } } }),
  ]);
  const savedByKey = new Map(saved.map((price) => [price.productKey, price]));
  return {
    sections: PRICE_SECTIONS.map((section) => ({
      key: section.key,
      title: section.title,
      description: section.description,
      prices: section.options.map((option) => {
        const price = savedByKey.get(option.key);
        const optionImpact = impact.counts.get(option.key)!;
        return {
          key: option.key,
          category: section.key,
          label: option.label,
          amountPence: price?.amountPence ?? option.defaultAmountPence,
          currencyCode: 'GBP',
          affectedListings: optionImpact.affected,
          unsupportedMappings: optionImpact.unsupported,
        };
      }),
    })),
    deliveryWarnings: impact.warnings,
    pendingEtsy: {
      keys: pendingKeys,
      affectedListings: pendingImpact.affectedListings,
      skippedListings: pendingImpact.skippedListings,
      deliveryWarnings: pendingImpact.deliveryWarnings,
    },
    latestJob: mapJob(latestJob),
  };
}

export async function saveProductPrices(input: unknown): Promise<SavePricesResult> {
  const entries = validatePriceEntries(input);
  await ensureDefaultPrices();
  const existing = await prisma.adminProductPrice.findMany({ select: { productKey: true, amountPence: true } });
  const existingByKey = new Map(existing.map((price) => [price.productKey, price.amountPence]));
  const changed = entries.filter((entry) => existingByKey.get(entry.key) !== entry.amountPence);

  if (changed.length > 0) {
    await prisma.$transaction(async (tx) => {
      for (const entry of changed) {
        await tx.adminProductPrice.upsert({
          where: { productKey: entry.key },
          update: {
            amountPence: entry.amountPence,
            currencyCode: 'GBP',
            etsySyncPending: ETSY_SYNCABLE_KEYS.has(entry.key),
          },
          create: {
            productKey: entry.key,
            category: PRICE_OPTION_BY_KEY.get(entry.key)!.category,
            amountPence: entry.amountPence,
            currencyCode: 'GBP',
            etsySyncPending: ETSY_SYNCABLE_KEYS.has(entry.key),
          },
        });
      }
      if (changed.some((entry) => entry.key === 'customisation_fee')) {
        await tx.etsyListing.updateMany({
          where: {
            etsyId: { not: null },
            productConfig: { is: { OR: [{ customTop: true }, { customBottom: true }] } },
          },
          data: { productsChanged: true, lastLocalChangeAt: new Date() },
        });
      }
    });
  }

  const changedKeys = changed.filter((entry) => ETSY_SYNCABLE_KEYS.has(entry.key)).map((entry) => entry.key);
  const impact = await getPriceImpact(changedKeys);
  return {
    data: await getSetPricesData(),
    changedKeys,
    affectedListings: impact.affectedListings,
    skippedListings: impact.skippedListings,
    deliveryWarnings: impact.deliveryWarnings,
  };
}

function changedPriceSnapshot(rows: Array<{ productKey: string; amountPence: number }>, changedKeys: ProductPriceKey[]) {
  const requested = new Set(changedKeys);
  return Object.fromEntries(rows.filter((row) => requested.has(row.productKey as ProductPriceKey)).map((row) => [row.productKey, row.amountPence]));
}

export async function startPriceUpdateJob(input: unknown) {
  if (!Array.isArray(input)) throw new Error('Choose the changed prices to apply.');
  const changedKeys = [...new Set(input.filter((key): key is ProductPriceKey =>
    typeof key === 'string' && ETSY_SYNCABLE_KEYS.has(key as ProductPriceKey)
  ))];
  if (changedKeys.length === 0) throw new Error('There are no changed prices to apply.');
  const prices = await prisma.adminProductPrice.findMany({ where: { productKey: { in: changedKeys } }, select: { productKey: true, amountPence: true } });
  if (prices.length !== changedKeys.length) throw new Error('One or more saved prices could not be found.');
  const snapshot = changedPriceSnapshot(prices, changedKeys);
  const active = await prisma.etsyPriceUpdateJob.findFirst({ where: { status: { in: ['waiting', 'running'] } }, orderBy: { createdAt: 'desc' } });
  if (active) {
    const activeSnapshot = rawRecord(active.changedPrices);
    const matchesActiveJob = activeSnapshot
      && Object.keys(snapshot).length === Object.keys(activeSnapshot).length
      && Object.entries(snapshot).every(([key, amount]) => activeSnapshot[key] === amount);
    if (matchesActiveJob) return getPriceUpdateJob(active.id);
    throw new Error('Another Etsy price update is still running. Let it finish before applying these saved prices.');
  }

  const impact = await getPriceImpact(changedKeys);
  const jobId = randomUUID();
  await prisma.$transaction(async (transaction) => {
    await transaction.etsyPriceUpdateJob.create({
      data: {
        id: jobId,
        status: impact.plans.length === 0 ? 'completed' : 'waiting',
        changedPrices: snapshot,
        total: impact.plans.length,
        completedAt: impact.plans.length === 0 ? new Date() : null,
      },
    });
    if (impact.plans.length > 0) {
      await transaction.etsyPriceUpdateItem.createMany({
        data: impact.plans.map((plan) => ({
          jobId,
          listingId: plan.listing.id,
          listingName: plan.listing.localDirectoryName ?? plan.listing.title,
          etsyListingId: plan.listing.etsyId!,
          priceKeys: plan.keys,
          status: plan.canUpdate ? 'waiting' : 'skipped',
          message: plan.skipReason,
        })),
      });
    }
  });
  await refreshJobCounts(jobId);
  return getPriceUpdateJob(jobId);
}

function parseChangedPrices(value: Prisma.JsonValue) {
  const record = rawRecord(value);
  const parsed = new Map<ProductPriceKey, number>();
  if (!record) return parsed;
  for (const [key, amount] of Object.entries(record)) {
    if (ETSY_SYNCABLE_KEYS.has(key as ProductPriceKey) && typeof amount === 'number' && Number.isInteger(amount)) {
      parsed.set(key as ProductPriceKey, amount);
    }
  }
  return parsed;
}

async function refreshJobCounts(jobId: string) {
  const grouped = await prisma.etsyPriceUpdateItem.groupBy({
    by: ['status'],
    where: { jobId },
    _count: { _all: true },
  });
  const count = (status: PriceJobItemStatus) => grouped.find((row) => row.status === status)?._count._all ?? 0;
  const waiting = count('waiting');
  const updating = count('updating');
  const succeeded = count('updated');
  const failed = count('failed');
  const skipped = count('skipped');
  const finished = waiting === 0 && updating === 0;
  const job = finished ? await prisma.etsyPriceUpdateJob.findUnique({ where: { id: jobId }, select: { changedPrices: true, total: true } }) : null;
  if (job && job.total > 0 && failed === 0 && skipped === 0) {
    const snapshot = parseChangedPrices(job.changedPrices);
    await prisma.$transaction([...snapshot].map(([productKey, amountPence]) => prisma.adminProductPrice.updateMany({
      where: { productKey, amountPence },
      data: { etsySyncPending: false },
    })));
  }
  await prisma.etsyPriceUpdateJob.update({
    where: { id: jobId },
    data: {
      status: finished ? 'completed' : updating > 0 ? 'running' : 'waiting',
      processed: succeeded + failed + skipped,
      succeeded,
      failed,
      skipped,
      currentListing: finished ? null : undefined,
      completedAt: finished ? new Date() : null,
    },
  });
}

export async function processNextPriceUpdateItem(jobId: string) {
  const job = await prisma.etsyPriceUpdateJob.findUnique({ where: { id: jobId } });
  if (!job) throw new Error('Price update job not found.');
  const item = await prisma.etsyPriceUpdateItem.findFirst({ where: { jobId, status: 'waiting' }, orderBy: { id: 'asc' } });
  if (!item) {
    await refreshJobCounts(jobId);
    return getPriceUpdateJob(jobId);
  }
  const claimed = await prisma.etsyPriceUpdateItem.updateMany({
    where: { id: item.id, status: 'waiting' },
    data: { status: 'updating', attempts: { increment: 1 }, message: null },
  });
  if (claimed.count === 0) return getPriceUpdateJob(jobId);
  await prisma.etsyPriceUpdateJob.update({ where: { id: jobId }, data: { status: 'running', currentListing: item.listingName, completedAt: null } });

  try {
    const listing = await prisma.etsyListing.findUnique({
      where: { id: item.listingId },
      include: {
        productConfig: { select: { digitalDownload: true } },
        products: { select: { productType: true, priceKey: true } },
        subSection: { include: { shopSection: true } },
        priceMappings: true,
      },
    });
    if (!listing?.etsyId || !listing.subSection?.shopSection) throw new Error('The Etsy listing mapping is no longer available.');
    const keys = jsonPriceKeys(item.priceKeys);
    const changedPrices = parseChangedPrices(job.changedPrices);
    const digitalProductKey = listing.products.find((product) => product.productType === 'digital')?.priceKey;
    const digitalKey = digitalProductKey && PRICE_OPTION_BY_KEY.get(digitalProductKey)?.category === 'digital'
      ? digitalProductKey as ProductPriceKey
      : listing.etsyProductType === 'digital' || listing.productConfig?.digitalDownload
        ? digitalPriceKeyForSection(listing.numberOfItems ?? 1, listing.includeAllItems)
        : null;

    if (digitalKey && keys.includes(digitalKey)) {
      const amountPence = changedPrices.get(digitalKey);
      if (!amountPence) throw new Error('The saved digital price is missing from this update job.');
      if (listing.etsyProductType === 'digital') {
        await updateEtsyListingPrice(listing.shopId, listing.etsyId, amountPence);
        await prisma.etsyListing.update({
          where: { id: listing.id },
          data: { priceAmount: amountPence, priceDivisor: 100, priceCurrencyCode: 'GBP', lastSyncedAt: new Date() },
        });
      } else {
        const mappings = listing.priceMappings.filter((mapping) => mapping.productKey === digitalKey);
        if (mappings.length === 0 || mappings.some((mapping) => !mapping.etsyProductId || !mapping.etsyOfferingId)) {
          throw new Error('The Etsy product and offering IDs for Digital Download are not mapped.');
        }
        await updateEtsyListingVariationPrices(listing.etsyId, mappings.map((mapping) => ({
          etsyProductId: mapping.etsyProductId!,
          etsyOfferingId: mapping.etsyOfferingId!,
          amountPence,
        })));
        await prisma.etsyListing.update({ where: { id: listing.id }, data: { lastSyncedAt: new Date() } });
      }
    }

    const physicalKeys = keys.filter((key) => PHYSICAL_KEYS.has(key));
    if (physicalKeys.length > 0) {
      const mappings = listing.priceMappings.filter((mapping) => physicalKeys.includes(mapping.productKey as ProductPriceKey));
      if (mappings.some((mapping) => !mapping.isSupported)) throw new Error('A configured physical size is not supported by its fulfilment provider.');
      const changes = mappings.flatMap((mapping) => {
        const amountPence = changedPrices.get(mapping.productKey as ProductPriceKey);
        return mapping.etsyProductId && mapping.etsyOfferingId && amountPence
          ? [{ etsyProductId: mapping.etsyProductId, etsyOfferingId: mapping.etsyOfferingId, amountPence }]
          : [];
      });
      const missingKey = physicalKeys.find((key) => !mappings.some((mapping) =>
        mapping.productKey === key && mapping.etsyProductId && mapping.etsyOfferingId
      ));
      if (missingKey) throw new Error(`The Etsy product/offerings for ${PRICE_OPTION_BY_KEY.get(missingKey)!.label} are not mapped.`);
      await updateEtsyListingVariationPrices(listing.etsyId, changes);
      await prisma.etsyListing.update({ where: { id: listing.id }, data: { lastSyncedAt: new Date() } });
    }

    await prisma.etsyPriceUpdateItem.update({ where: { id: item.id }, data: { status: 'updated', message: null } });
  } catch (error) {
    await prisma.etsyPriceUpdateItem.update({
      where: { id: item.id },
      data: {
        status: error instanceof EtsyVariationNotFoundError ? 'skipped' : 'failed',
        message: error instanceof Error ? error.message : 'Etsy update failed.',
      },
    });
  }

  await refreshJobCounts(jobId);
  return getPriceUpdateJob(jobId);
}

export async function retryFailedPriceUpdateItems(jobId: string) {
  const job = await prisma.etsyPriceUpdateJob.findUnique({ where: { id: jobId } });
  if (!job) throw new Error('Price update job not found.');
  const retried = await prisma.etsyPriceUpdateItem.updateMany({
    where: { jobId, status: 'failed' },
    data: { status: 'waiting', message: null },
  });
  if (retried.count === 0) throw new Error('There are no failed listings to retry.');
  await prisma.etsyPriceUpdateJob.update({ where: { id: jobId }, data: { status: 'waiting', completedAt: null } });
  await refreshJobCounts(jobId);
  return getPriceUpdateJob(jobId);
}
