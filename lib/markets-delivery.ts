import { Prisma } from '@prisma/client';
import { prisma } from '@/lib/prisma';
import { getEtsyOAuthConnectionStatus } from '@/lib/etsy-oauth';
import { ISO_COUNTRY_CODES } from '@/lib/iso-country-codes';
import { effectiveListingTemplateSettings } from '@/lib/listing-template-settings';
import { getTemplateEtsySyncVariants } from '@/lib/etsy-sync-targets';
import { composeDeliveryDescription, validateEtsyDescription } from '@/lib/delivery-description';
import { createEtsyDeliveryApi, EtsyDeliveryError, etsyDeliveryDestinationCountry, type EtsyDeliveryApi } from '@/lib/etsy-delivery-api';
import { etsyDeliveryFingerprint, getEtsyDeliveryProfile, importEtsyDeliveryProfile, syncEtsyDeliveryProfile } from '@/lib/etsy-delivery-sync';
import { deliveryId, deliverySettingsFingerprint, MarketsDeliveryError, validateDeliveryProfileValues, validateDeliverySettings } from '@/lib/markets-delivery-core';
import type { ListingEditorContext } from '@/lib/listing-editor';
import type { DeliveryAffectedListing, DeliveryProfile, DeliveryProfileValues, DeliverySettingsInput, EffectiveListingDelivery, MarketsDeliveryPageData, MarketsDeliverySettingsState } from '@/lib/markets-delivery-types';

type ProfileRow = Prisma.DeliveryProfileGetPayload<{ include: { destinations: true } }>;
type SettingsRow = Prisma.MarketDeliverySettingsGetPayload<object>;
type PhysicalVariant = 'print' | 'customised';
const profileInclude = { destinations: { orderBy: { countryCode: 'asc' as const } } };
const listingSelect = {
  id: true, shopId: true, title: true, description: true, localDirectoryName: true,
  etsyId: true, etsyCustomisedId: true, rawJson: true, etsyCustomisedRawJson: true,
  deliveryAssignmentSyncs: { select: { variant: true, etsyListingId: true, etsyShippingProfileId: true } },
  ourCategoryId: true, subSectionId: true,
  productConfig: { select: { customisePrints: true, customTop: true, customBottom: true, printsFramesOverride: true, digitalDownloadOverride: true } },
  ourCategory: { select: {
    id: true, name: true, followedTemplateId: true,
    printsFrames: true, customisePrints: true, digitalDownload: true, customTop: true, customBottom: true,
    printFrameSection: { select: { id: true } }, customisedSection: { select: { id: true } }, downloadSection: { select: { id: true } },
  } },
} as const;
type ListingRow = Prisma.EtsyListingGetPayload<{ select: typeof listingSelect }>;

async function shopFor(externalId: string) {
  if (!/^\d{1,20}$/.test(externalId) || BigInt(externalId) < 1n) throw new MarketsDeliveryError('Choose a valid shop.');
  const shop = await prisma.etsyShop.findUnique({ where: { etsyShopId: BigInt(externalId) } });
  if (!shop) throw new MarketsDeliveryError('Shop not found.', 404);
  return shop;
}

function shopListingsWhere(shop: { id: number; etsyShopId: bigint }) {
  return { subSection: { is: { shopSection: { is: { OR: [{ shopId: shop.id }, { etsyShopId: shop.etsyShopId }] } } } } };
}

async function shopCurrency(shop: { id: number; etsyShopId: bigint; currencyCode: string | null }) {
  if (shop.currencyCode) return shop.currencyCode;
  const rows = await prisma.etsyListing.findMany({
    where: { ...shopListingsWhere(shop), priceCurrencyCode: { not: null } },
    select: { priceCurrencyCode: true }, distinct: ['priceCurrencyCode'],
  });
  return rows.length === 1 ? rows[0].priceCurrencyCode : null;
}

function toSettings(row: SettingsRow | null | undefined): DeliverySettingsInput | null {
  return row ? {
    printProfileId: row.printProfileId === null ? null : String(row.printProfileId),
    customisedProfileId: row.customisedProfileId === null ? null : String(row.customisedProfileId),
    includeDeliveryInformation: row.includeDeliveryInformation, deliveryInformation: row.deliveryInformation,
  } : null;
}

function valuesOf(row: ProfileRow): DeliveryProfileValues {
  return {
    name: row.name, currencyCode: row.currencyCode, originCountryIso: row.originCountryIso,
    originPostalCode: row.originPostalCode, readinessStateId: row.readinessStateId,
    includeDeliveryInformation: row.includeDeliveryInformation, deliveryInformation: row.deliveryInformation,
    destinations: row.destinations.map(({ countryCode, primaryCostMinor, secondaryCostMinor, minDeliveryDays, maxDeliveryDays, carrierId, mailClass }) => ({ countryCode, primaryCostMinor, secondaryCostMinor, minDeliveryDays, maxDeliveryDays, carrierId, mailClass })),
  };
}

function dto(row: ProfileRow, externalShopId: string, linkedListingCount = 0): DeliveryProfile {
  return {
    ...valuesOf(row), id: String(row.id), shopId: externalShopId,
    etsyShippingProfileId: row.etsyShippingProfileId, revision: row.revision,
    syncStatus: row.syncStatus as DeliveryProfile['syncStatus'], linkedListingCount,
    lastSyncedAt: row.lastSyncedAt?.toISOString() ?? null, error: row.error,
    archivedAt: row.archivedAt?.toISOString() ?? null, updatedAt: row.updatedAt.toISOString(), isCalculated: row.isCalculated,
  };
}

async function profileFor(shopId: number, id: string) {
  const profile = await prisma.deliveryProfile.findFirst({ where: { id: deliveryId(id, 'delivery profile'), shopId }, include: profileInclude });
  if (!profile) throw new MarketsDeliveryError('Delivery profile not found in this shop.', 404);
  return profile;
}

function actualVariants(listing: ListingRow): PhysicalVariant[] {
  if (!listing.ourCategory) return [];
  return getTemplateEtsySyncVariants({ ...listing.ourCategory, ...effectiveListingTemplateSettings(listing.ourCategory, listing.productConfig) })
    .filter((variant): variant is PhysicalVariant => variant !== 'download');
}

function sharedPhysical(listing: ListingRow) {
  const template = listing.ourCategory;
  const settings = effectiveListingTemplateSettings(template, listing.productConfig);
  return Boolean(settings.printsFrames && settings.customisePrints && template?.printFrameSection
    && template.printFrameSection.id === template.customisedSection?.id);
}

function deliveryVariant(listing: ListingRow, variant: PhysicalVariant): PhysicalVariant {
  return sharedPhysical(listing) ? 'print' : variant;
}

function remoteProfileId(listing: ListingRow, variant: PhysicalVariant) {
  const physicalVariant = deliveryVariant(listing, variant);
  const raw = physicalVariant === 'print' ? listing.rawJson : listing.etsyCustomisedRawJson;
  if (raw && typeof raw === 'object' && !Array.isArray(raw)) {
    const nested = raw.shipping_profile;
    const id = raw.shipping_profile_id ?? (nested && typeof nested === 'object' && !Array.isArray(nested) ? nested.shipping_profile_id : null);
    if (typeof id === 'string' || typeof id === 'number') return String(id);
  }
  const etsyListingId = physicalVariant === 'print' ? listing.etsyId : listing.etsyCustomisedId;
  // A partial Etsy response may omit shipping fields; retain the confirmed
  // assignment for this exact Etsy listing, never an older replaced draft.
  return etsyListingId ? listing.deliveryAssignmentSyncs?.find(row => row.variant === physicalVariant && row.etsyListingId === etsyListingId)?.etsyShippingProfileId ?? null : null;
}

type Graph = Awaited<ReturnType<typeof loadGraph>>;
async function loadGraph(shop: { id: number; etsyShopId: bigint }) {
  const [listings, settings, templates, profiles] = await Promise.all([
    prisma.etsyListing.findMany({ where: shopListingsWhere(shop), select: listingSelect }),
    prisma.marketDeliverySettings.findMany({ where: { shopId: shop.id } }),
    prisma.ourCategory.findMany({ where: { shopId: shop.id }, select: { id: true, followedTemplateId: true } }),
    prisma.deliveryProfile.findMany({ where: { shopId: shop.id, archivedAt: null }, include: profileInclude }),
  ]);
  return { listings, settings, templates, profiles };
}

function templateSettingsFor(templateId: number | null, graph: Pick<Graph, 'settings' | 'templates'>) {
  const seen = new Set<number>();
  let current = templateId;
  while (current !== null && !seen.has(current)) {
    seen.add(current);
    const found = graph.settings.find(row => row.templateId === current);
    if (found) return found;
    current = graph.templates.find(row => row.id === current)?.followedTemplateId ?? null;
  }
  return null;
}

function selection(listing: ListingRow, graph: Pick<Graph, 'settings' | 'templates' | 'profiles'>, variant: PhysicalVariant, shippingProfileId?: string) {
  const own = graph.settings.find(row => row.listingId === listing.id);
  const inherited = templateSettingsFor(listing.ourCategoryId, graph);
  const settings = toSettings(own ?? inherited);
  const profileId = sharedPhysical(listing)
    ? settings?.printProfileId ?? settings?.customisedProfileId
    : variant === 'print' ? settings?.printProfileId : settings?.customisedProfileId;
  const profile = profileId
    ? graph.profiles.find(row => row.id === Number(profileId))
    : graph.profiles.find(row => row.etsyShippingProfileId === (shippingProfileId ?? remoteProfileId(listing, variant)));
  if (profileId && !profile) throw new MarketsDeliveryError('The selected delivery profile is unavailable. Choose an active profile from this shop before syncing.', 409);
  return { own, inherited, settings, profile: profile ?? null };
}

function effective(selectionValue: ReturnType<typeof selection>): EffectiveListingDelivery {
  const { own, settings, profile } = selectionValue;
  return {
    profileId: profile ? String(profile.id) : null,
    shippingProfileId: profile?.etsyShippingProfileId ?? null,
    readinessStateId: profile?.readinessStateId ?? null,
    includeDeliveryInformation: settings?.includeDeliveryInformation ?? profile?.includeDeliveryInformation ?? false,
    deliveryInformation: settings?.deliveryInformation ?? profile?.deliveryInformation ?? '',
    usesManagedProfile: profile !== null, inherited: !own,
    pending: profile !== null && (profile.syncStatus !== 'SYNCED' || profile.syncedRevision !== profile.revision),
    profileRevision: profile?.revision ?? null, profileSyncStatus: profile?.syncStatus as EffectiveListingDelivery['profileSyncStatus'] ?? null,
  };
}

export async function getDeliveryProfileImpact(shopId: string, profileId: string, proposed?: unknown): Promise<DeliveryAffectedListing[]> {
  const shop = await shopFor(shopId);
  const profile = await profileFor(shop.id, profileId);
  const graph = await loadGraph(shop);
  if (proposed !== undefined) {
    const currencyCode = await shopCurrency(shop);
    if (!currencyCode) throw new MarketsDeliveryError('Import profiles from Etsy to confirm the shop currency before editing rates.');
    const values = validateDeliveryProfileValues(proposed, currencyCode, profile.destinations.map(row => row.countryCode).filter(code => !ISO_COUNTRY_CODES.includes(code)));
    graph.profiles = graph.profiles.map(row => row.id === profile.id ? { ...row, ...values, destinations: row.destinations } : row);
  }
  const result: DeliveryAffectedListing[] = [];
  for (const listing of graph.listings) for (const variant of actualVariants(listing)) {
    const selected = selection(listing, graph, variant);
    if (selected.profile?.id !== profile.id) continue;
    const delivery = effective(selected);
    const descriptionPreview = composeDeliveryDescription(listing.description ?? '', delivery.deliveryInformation, delivery.includeDeliveryInformation);
    validateEtsyDescription(descriptionPreview);
    result.push({ listingId: String(listing.id), listingName: listing.localDirectoryName ?? listing.title,
      templateName: listing.ourCategory?.name ?? null, variant,
      etsyListingId: variant === 'print' ? listing.etsyId : listing.etsyCustomisedId,
      inherited: !selected.own, descriptionPreview });
  }
  return result;
}

async function markPending(listings: Array<{ listingId: string; variant: PhysicalVariant; profileId?: number | null }>, profileId?: number, clearDescriptionConflict = false) {
  for (const listing of listings) {
    const previous = await prisma.deliveryAssignmentSync.findUnique({ where: { listingId_variant: { listingId: Number(listing.listingId), variant: listing.variant } } });
    const selectedId = listing.profileId !== undefined ? listing.profileId : profileId;
    const conflict = previous?.status === 'CONFLICT' && !clearDescriptionConflict;
    await prisma.deliveryAssignmentSync.upsert({
      where: { listingId_variant: { listingId: Number(listing.listingId), variant: listing.variant } },
      create: { listingId: Number(listing.listingId), variant: listing.variant, profileId: selectedId ?? null, status: 'PENDING' },
      update: { ...(selectedId !== undefined ? { profileId: selectedId } : {}), status: conflict ? 'CONFLICT' : 'PENDING', error: conflict ? previous.error : null },
    });
  }
}

export async function getMarketsDeliveryPageData(requestedShopId?: string): Promise<MarketsDeliveryPageData> {
  const shops = await prisma.etsyShop.findMany({ orderBy: [{ shopName: 'asc' }, { id: 'asc' }] });
  const selected = requestedShopId ? shops.find(shop => shop.etsyShopId.toString() === requestedShopId) : shops[0];
  if (requestedShopId && !selected) throw new MarketsDeliveryError('Shop not found.', 404);
  const connection = await getEtsyOAuthConnectionStatus();
  const canRead = connection.connected && connection.scopes.includes('shops_r');
  const canWrite = canRead && connection.scopes.includes('shops_w') && connection.scopes.includes('listings_w');
  const shopViews = await Promise.all(shops.map(async shop => ({ id: shop.etsyShopId.toString(), name: shop.shopName ?? shop.title ?? `Shop ${shop.etsyShopId}`, currencyCode: await shopCurrency(shop) })));
  const profiles = selected ? await prisma.deliveryProfile.findMany({ where: { shopId: selected.id }, include: profileInclude, orderBy: [{ archivedAt: 'asc' }, { name: 'asc' }] }) : [];
  const graph = selected ? await loadGraph(selected) : null;
  const linked = new Map<number, Set<string>>();
  if (graph) for (const listing of graph.listings) for (const variant of actualVariants(listing)) {
    const profile = selection(listing, graph, variant).profile;
    if (!profile) continue;
    const ids = linked.get(profile.id) ?? new Set<string>();
    const remoteId = variant === 'print' ? listing.etsyId : listing.etsyCustomisedId;
    ids.add(remoteId ? `etsy:${remoteId}` : `local:${listing.id}:${variant}`); linked.set(profile.id, ids);
  }
  const profileViews = profiles.map(row => dto(row, selected!.etsyShopId.toString(), linked.get(row.id)?.size ?? 0));
  return {
    shopId: selected?.etsyShopId.toString() ?? '', shops: shopViews,
    currencyCode: shopViews.find(shop => shop.id === selected?.etsyShopId.toString())?.currencyCode ?? null,
    profiles: profileViews,
    connection: { connected: connection.connected, canRead, canWrite, message: canWrite ? null : 'Reconnect Etsy and approve shops_r, shops_w and listings_w to import and sync delivery profiles.' },
    pricing: { available: false, message: 'Cost unavailable. The configured PrintShrimp integration does not provide verified destination-specific fulfilment quotes, so delivery-inclusive profit and Etsy fee estimates are not calculated.' },
  };
}

export async function saveDeliveryProfile(shopId: string, values: unknown, profileId?: string, expectedRevision?: number, confirmAffected = false) {
  const shop = await shopFor(shopId);
  const existing = profileId ? await profileFor(shop.id, profileId) : null;
  if (existing?.archivedAt) throw new MarketsDeliveryError('Archived delivery profiles cannot be edited.');
  if (existing?.isCalculated) throw new MarketsDeliveryError('Calculated Etsy profiles are read-only here. Edit them in Etsy or create a fixed-rate local profile.');
  if (existing?.pendingCreateToken) throw new MarketsDeliveryError('Reconcile the unconfirmed Etsy creation using Sync or Import before editing this profile.', 409);
  if (existing?.syncStartedAt && Date.now() - existing.updatedAt.getTime() < 600000) throw new MarketsDeliveryError('This profile is currently syncing. Wait before editing it.', 409);
  const currencyCode = await shopCurrency(shop);
  if (!currencyCode) throw new MarketsDeliveryError('The shop currency is unavailable. Import profiles from Etsy to refresh it before entering delivery charges.');
  const parsed = validateDeliveryProfileValues(values, currencyCode, existing?.destinations.map(row => row.countryCode).filter(code => !ISO_COUNTRY_CODES.includes(code)));
  const affected = existing ? await getDeliveryProfileImpact(shopId, String(existing.id), parsed) : [];
  if (affected.length && !confirmAffected) throw new MarketsDeliveryError('Review the affected listings and confirm the shared profile change before saving.', 409);
  if (existing && expectedRevision !== existing.revision) throw new MarketsDeliveryError('This profile changed in another tab. Reload it before saving.', 409);
  if (existing && JSON.stringify(valuesOf(existing)) === JSON.stringify(parsed)) return existing.id;
  const saved = await prisma.$transaction(async tx => {
    const { destinations, ...fields } = parsed;
    if (!existing) return tx.deliveryProfile.create({ data: { shopId: shop.id, ...fields, destinations: { create: destinations } } });
    const changed = await tx.deliveryProfile.updateMany({ where: {
      id: existing.id, shopId: shop.id, revision: existing.revision, archivedAt: null, pendingCreateToken: null,
      OR: [{ syncStartedAt: null }, { syncStartedAt: existing.syncStartedAt, updatedAt: { lt: new Date(Date.now() - 600000) } }],
    }, data: {
      ...fields, revision: { increment: 1 }, syncStatus: existing.etsyShippingProfileId ? 'PENDING' : 'LOCAL_ONLY', error: null, syncStartedAt: null,
    } });
    if (changed.count !== 1) throw new MarketsDeliveryError('This profile changed while saving. Reload before trying again.', 409);
    await tx.deliveryDestination.deleteMany({ where: { profileId: existing.id } });
    await tx.deliveryDestination.createMany({ data: destinations.map(destination => ({ ...destination, profileId: existing.id })) });
    return { id: existing.id };
  });
  await markPending(affected, saved.id);
  return saved.id;
}

export async function duplicateDeliveryProfile(shopId: string, profileId: string) {
  const shop = await shopFor(shopId);
  const source = await profileFor(shop.id, profileId);
  if (source.isCalculated || source.pendingCreateToken) throw new MarketsDeliveryError('This profile cannot be duplicated while calculated or awaiting Etsy reconciliation.');
  const { destinations, ...fields } = valuesOf(source);
  const copy = await prisma.deliveryProfile.create({ data: {
    shopId: shop.id, ...fields, name: `${fields.name} (copy)`.slice(0, 100),
    destinations: { create: destinations },
  } });
  return copy.id;
}

export async function archiveDeliveryProfile(shopId: string, profileId: string) {
  const shop = await shopFor(shopId);
  const profile = await profileFor(shop.id, profileId);
  if (profile.archivedAt) return;
  if (profile.pendingCreateToken || profile.syncStartedAt) throw new MarketsDeliveryError('Finish or reconcile the current sync before archiving this profile.', 409);
  await prisma.$transaction(async tx => {
    const where = { id: profile.id, shopId: shop.id, revision: profile.revision, archivedAt: null, syncStartedAt: null, pendingCreateToken: null };
    // Acquire the profile row before rechecking references; a sync claim cannot pass this archive transaction.
    const locked = await tx.deliveryProfile.updateMany({ where, data: { updatedAt: new Date() } });
    if (locked.count !== 1) throw new MarketsDeliveryError('This profile changed or started syncing. Refresh before archiving it.', 409);
    const references = await tx.marketDeliverySettings.count({ where: { shopId: shop.id, OR: [{ printProfileId: profile.id }, { customisedProfileId: profile.id }] } });
    const impact = await getDeliveryProfileImpact(shopId, profileId);
    if (references || impact.length) throw new MarketsDeliveryError('Replace this profile in its assigned listings and template defaults before archiving it. Etsy will not be changed.', 409);
    const archived = await tx.deliveryProfile.updateMany({ where, data: { archivedAt: new Date() } });
    if (archived.count !== 1) throw new MarketsDeliveryError('This profile changed while archiving. Refresh before trying again.', 409);
  });
}

export async function syncDeliveryProfile(shopId: string, profileId: string, options: { expectedRevision?: number; confirmAffected?: boolean; resolveConflict?: string; api?: EtsyDeliveryApi } = {}) {
  const shop = await shopFor(shopId);
  const profile = await profileFor(shop.id, profileId);
  if (profile.archivedAt || profile.isCalculated) throw new MarketsDeliveryError('Only active fixed-rate delivery profiles can be synced here.');
  const currencyCode = await shopCurrency(shop);
  if (!currencyCode || currencyCode !== profile.currencyCode) throw new MarketsDeliveryError('Confirm the shop currency by importing from Etsy, then review this profile’s rates before syncing.');
  if (options.expectedRevision !== undefined && options.expectedRevision !== profile.revision) throw new MarketsDeliveryError('This profile changed. Reload before syncing.', 409);
  const affected = await getDeliveryProfileImpact(shopId, profileId);
  if (affected.length && !options.confirmAffected) throw new MarketsDeliveryError('Review the affected listings before syncing this shared profile.', 409);
  const startedAt = new Date();
  const leaseWhere = { id: profile.id, shopId: shop.id, revision: profile.revision, syncStartedAt: startedAt, archivedAt: null };
  const claim = await prisma.deliveryProfile.updateMany({ where: {
    id: profile.id, shopId: shop.id, revision: profile.revision, archivedAt: null,
    OR: [{ syncStartedAt: null }, { updatedAt: { lt: new Date(Date.now() - 600000) } }],
  }, data: { syncStartedAt: startedAt, updatedAt: startedAt, error: null } });
  if (claim.count !== 1) throw new MarketsDeliveryError('This delivery profile is already syncing. Wait before trying again.', 409);
  const lostClaim = () => new MarketsDeliveryError('This delivery sync no longer owns the current profile revision. Its local changes remain pending; refresh before retrying.', 409);
  try {
    const remote = await syncEtsyDeliveryProfile({
      profile: { ...valuesOf(profile), id: String(profile.id), shopId, etsyShippingProfileId: profile.etsyShippingProfileId, remoteFingerprint: profile.remoteFingerprint, pendingCreateToken: profile.pendingCreateToken },
      api: options.api, forceRemoteOverwrite: options.resolveConflict === 'overwrite',
      checkpoint: async checkpoint => {
        const retained = await prisma.deliveryProfile.updateMany({ where: leaseWhere, data: {
          etsyShippingProfileId: checkpoint.etsyShippingProfileId, remoteFingerprint: checkpoint.remoteFingerprint,
          remoteSnapshot: checkpoint.remoteSnapshot ? JSON.parse(JSON.stringify(checkpoint.remoteSnapshot)) as Prisma.InputJsonValue : Prisma.DbNull,
          pendingCreateToken: checkpoint.pendingCreateToken, updatedAt: new Date(),
        } });
        if (retained.count !== 1) throw lostClaim();
      },
    });
    await prisma.$transaction(async tx => {
      // Lock the claimed profile before mapping its destination IDs. A new owner or revision cannot be completed by this worker.
      const retained = await tx.deliveryProfile.updateMany({ where: leaseWhere, data: { updatedAt: new Date() } });
      if (retained.count !== 1) throw lostClaim();
      for (const destination of remote.shipping_profile_destinations) await tx.deliveryDestination.updateMany({
        where: { profileId: profile.id, countryCode: etsyDeliveryDestinationCountry(destination) },
        data: { etsyDestinationId: String(destination.shipping_profile_destination_id) },
      });
      const completed = await tx.deliveryProfile.updateMany({ where: leaseWhere, data: {
        syncStatus: 'SYNCED', syncedRevision: profile.revision, lastSyncedAt: new Date(), error: null, syncStartedAt: null,
        etsyShippingProfileId: String(remote.shipping_profile_id), remoteFingerprint: etsyDeliveryFingerprint(remote),
        remoteSnapshot: JSON.parse(JSON.stringify(remote)) as Prisma.InputJsonValue, pendingCreateToken: null, updatedAt: new Date(),
      } });
      if (completed.count !== 1) throw lostClaim();
    }, { timeout: 30_000 });
    await markPending(affected, profile.id);
  } catch (error) {
    try {
      await prisma.deliveryProfile.updateMany({ where: leaseWhere, data: {
        syncStatus: error instanceof EtsyDeliveryError && error.code === 'conflict' ? 'CONFLICT' : 'FAILED', syncStartedAt: null,
        error: error instanceof Error ? error.message : 'Delivery profile sync failed. Local changes remain pending.', updatedAt: new Date(),
      } });
    } catch {
      // Preserve the original failure if cleanup cannot reach the database; a later sync can reclaim an expired lease.
    }
    throw error;
  }
}

export async function importDeliveryProfiles(shopId: string, options: { profileId?: string; resolveConflict?: boolean; expectedRevision?: number; api?: EtsyDeliveryApi } = {}) {
  const shop = await shopFor(shopId);
  if (options.resolveConflict && !options.profileId) throw new MarketsDeliveryError('Choose the specific profile to reload from Etsy.');
  const requested = options.profileId ? await profileFor(shop.id, options.profileId) : null;
  if (requested && options.expectedRevision !== undefined && requested.revision !== options.expectedRevision) throw new MarketsDeliveryError('This profile changed. Review its latest version before reloading from Etsy.', 409);
  if (requested && !requested.etsyShippingProfileId) throw new MarketsDeliveryError('This local profile has no confirmed Etsy ID. Use Sync to reconcile an uncertain creation first.', 409);
  const api = options.api ?? createEtsyDeliveryApi();
  const currencyCode = await api.getShopCurrency(shopId);
  await prisma.etsyShop.update({ where: { id: shop.id }, data: { currencyCode } });
  const remoteProfiles = requested?.etsyShippingProfileId ? [await api.getProfile(shopId, requested.etsyShippingProfileId)] : await api.listProfiles(shopId);
  let importedCount = 0;
  for (const summary of remoteProfiles.filter(row => !row.is_deleted)) {
    const remote = await getEtsyDeliveryProfile(api, shopId, String(summary.shipping_profile_id));
    const fingerprint = etsyDeliveryFingerprint(remote);
    const existing = await prisma.deliveryProfile.findFirst({ where: { shopId: shop.id, etsyShippingProfileId: String(remote.shipping_profile_id) }, include: profileInclude });
    if (requested && existing && existing.revision !== requested.revision) throw new MarketsDeliveryError('This profile changed while Etsy was being read. Review the latest local values before reloading.', 409);
    if (existing?.syncStartedAt) continue;
    if (existing && existing.syncStatus !== 'SYNCED' && !options.resolveConflict) {
      if (existing.remoteFingerprint !== fingerprint) await prisma.deliveryProfile.update({ where: { id: existing.id }, data: { syncStatus: 'CONFLICT', error: 'Etsy changed while local edits were pending. Choose Keep local and Sync, or explicitly reload from Etsy.' } });
      continue;
    }
    if (existing && fingerprint === existing.remoteFingerprint && !options.resolveConflict) continue;
    const values = importEtsyDeliveryProfile(remote, currencyCode);
    const { destinations, ...fields } = values;
    const saved = await prisma.$transaction(async tx => {
      const data = {
        ...fields, etsyShippingProfileId: String(remote.shipping_profile_id), isCalculated: remote.profile_type === 'calculated',
        syncStatus: 'SYNCED', remoteFingerprint: fingerprint, remoteSnapshot: JSON.parse(JSON.stringify(remote)) as Prisma.InputJsonValue,
        lastSyncedAt: new Date(), error: null, pendingCreateToken: null,
      };
      if (!existing) return tx.deliveryProfile.create({ data: { ...data, shopId: shop.id, syncedRevision: 1, destinations: { create: destinations.map(destination => ({ ...destination, etsyDestinationId: String(remote.shipping_profile_destinations.find(row => etsyDeliveryDestinationCountry(row) === destination.countryCode)!.shipping_profile_destination_id) })) } } });
      const updated = await tx.deliveryProfile.updateMany({ where: { id: existing.id, revision: existing.revision, syncStartedAt: null }, data: {
        ...data, revision: { increment: 1 }, syncedRevision: existing.revision + 1,
        includeDeliveryInformation: existing.includeDeliveryInformation, deliveryInformation: existing.deliveryInformation,
        readinessStateId: existing.readinessStateId,
      } });
      if (updated.count !== 1) throw new MarketsDeliveryError('This profile changed during import. Reload and review before trying again.', 409);
      await tx.deliveryDestination.deleteMany({ where: { profileId: existing.id } });
      await tx.deliveryDestination.createMany({ data: destinations.map(destination => ({ ...destination, profileId: existing.id, etsyDestinationId: String(remote.shipping_profile_destinations.find(row => etsyDeliveryDestinationCountry(row) === destination.countryCode)!.shipping_profile_destination_id) })) });
      return { id: existing.id };
    });
    if (existing) await markPending(await getDeliveryProfileImpact(shopId, String(saved.id)), saved.id);
    importedCount += 1;
  }
  return importedCount;
}

export async function getMarketsDeliveryMetadata(shopId: string) {
  await shopFor(shopId);
  const names = new Intl.DisplayNames(['en-GB'], { type: 'region' });
  const api = createEtsyDeliveryApi();
  const readiness = await api.listReadiness(shopId);
  return {
    countries: ISO_COUNTRY_CODES.map(code => ({ isoCountryCode: code, name: names.of(code) ?? code })),
    readinessProfiles: readiness.map(row => ({ readinessStateId: String(row.readiness_state_id), label: row.processing_days_display_label ?? `${row.readiness_state}: ${row.min_processing_days}–${row.max_processing_days} business days`, minProcessingDays: row.min_processing_days, maxProcessingDays: row.max_processing_days })),
  };
}

async function listingContext(context: ListingEditorContext) {
  const shop = await shopFor(context.shopId);
  const listing = await prisma.etsyListing.findFirst({ where: {
    id: deliveryId(context.listingId, 'listing'), subSectionId: deliveryId(context.subSectionId, 'subsection'),
    subSection: { is: { shopSectionId: deliveryId(context.sectionId, 'section'), shopSection: { is: { OR: [{ shopId: shop.id }, { etsyShopId: shop.etsyShopId }] } } } },
  }, select: listingSelect });
  if (!listing) throw new MarketsDeliveryError('Listing not found in this shop and section.', 404);
  return { shop, listing };
}

async function contextGraph(shop: { id: number }, listing: ListingRow) {
  const [settings, templates, profiles] = await Promise.all([
    prisma.marketDeliverySettings.findMany({ where: { shopId: shop.id, OR: [{ listingId: listing.id }, { templateId: { not: null } }] } }),
    prisma.ourCategory.findMany({ where: { shopId: shop.id }, select: { id: true, followedTemplateId: true } }),
    prisma.deliveryProfile.findMany({ where: { shopId: shop.id, archivedAt: null }, include: profileInclude }),
  ]);
  return { settings, templates, profiles };
}

export async function getEffectiveListingDelivery(context: ListingEditorContext, variant: 'print' | 'customised' | 'download', resolved: { shippingProfileId?: string } = {}): Promise<EffectiveListingDelivery> {
  if (variant === 'download') return { profileId: null, shippingProfileId: null, readinessStateId: null, includeDeliveryInformation: false, deliveryInformation: '', usesManagedProfile: false, inherited: true, pending: false, profileRevision: null, profileSyncStatus: null };
  const { shop, listing } = await listingContext(context);
  const graph = await contextGraph(shop, listing);
  const physicalVariant = deliveryVariant(listing, variant);
  const result = effective(selection(listing, graph, physicalVariant, resolved.shippingProfileId));
  const assignment = await prisma.deliveryAssignmentSync.findUnique({ where: { listingId_variant: { listingId: listing.id, variant: physicalVariant } } });
  result.descriptionConflict = assignment?.status === 'CONFLICT' ? assignment.error ?? 'The description changed directly in Etsy. Review it before overwriting.' : null;
  const raw = physicalVariant === 'print' ? listing.rawJson : listing.etsyCustomisedRawJson;
  result.remoteDescription = raw && typeof raw === 'object' && !Array.isArray(raw) && typeof raw.description === 'string' ? raw.description : null;
  result.pending ||= assignment ? assignment.status !== 'SYNCED' || assignment.settingsFingerprint !== deliverySettingsFingerprint(result) : result.usesManagedProfile || result.includeDeliveryInformation;
  return result;
}

export async function getListingMarketsDelivery(context: ListingEditorContext): Promise<MarketsDeliverySettingsState> {
  const { shop, listing } = await listingContext(context);
  const graph = await contextGraph(shop, listing);
  const own = graph.settings.find(row => row.listingId === listing.id);
  const [print, customised] = await Promise.all([getEffectiveListingDelivery(context, 'print'), getEffectiveListingDelivery(context, 'customised')]);
  return { shopId: context.shopId, profiles: graph.profiles.map(row => dto(row, context.shopId)), settings: toSettings(own),
    templateSettings: toSettings(templateSettingsFor(listing.ourCategoryId, graph)), effective: { print, customised },
    isInherited: !own, pending: print.pending || customised.pending, baseDescription: listing.description ?? '' };
}

async function validateSelectedProfiles(shopId: number, settings: DeliverySettingsInput | null) {
  if (!settings) return;
  for (const id of new Set([settings.printProfileId, settings.customisedProfileId].filter((id): id is string => id !== null))) {
    const profile = await profileFor(shopId, id);
    if (profile.archivedAt) throw new MarketsDeliveryError('Choose an active delivery profile from this shop.');
  }
}

export async function saveListingMarketsDelivery(context: ListingEditorContext, input: unknown, options: { confirmDescriptionOverwrite?: boolean } = {}) {
  const { shop, listing } = await listingContext(context);
  const settings = validateDeliverySettings(input);
  await validateSelectedProfiles(shop.id, settings);
  if (sharedPhysical(listing) && settings?.printProfileId && settings.customisedProfileId && settings.printProfileId !== settings.customisedProfileId) {
    throw new MarketsDeliveryError('Print and Customised share one Etsy listing and must use the same delivery profile. Framed and unframed variations cannot have separate profiles.');
  }
  const key = { listingId: listing.id };
  if (!settings) await prisma.marketDeliverySettings.deleteMany({ where: key });
  else await prisma.marketDeliverySettings.upsert({ where: key, create: { ...settingsData(settings), listingId: listing.id, shopId: shop.id }, update: settingsData(settings) });
  const graph = await contextGraph(shop, listing);
  await markPending(actualVariants(listing).map(variant => ({ listingId: String(listing.id), variant, profileId: selection(listing, graph, variant).profile?.id ?? null })), undefined, options.confirmDescriptionOverwrite === true);
  return getListingMarketsDelivery(context);
}

function settingsData(settings: DeliverySettingsInput) {
  return { printProfileId: settings.printProfileId === null ? null : Number(settings.printProfileId), customisedProfileId: settings.customisedProfileId === null ? null : Number(settings.customisedProfileId), includeDeliveryInformation: settings.includeDeliveryInformation, deliveryInformation: settings.deliveryInformation };
}

export async function getTemplateMarketsDelivery(templateId: string, expectedShopId?: string): Promise<MarketsDeliverySettingsState> {
  const template = await prisma.ourCategory.findUnique({ where: { id: deliveryId(templateId, 'template') }, include: { shop: true } });
  if (!template) throw new MarketsDeliveryError('Template not found.', 404);
  if (expectedShopId && template.shop.etsyShopId.toString() !== expectedShopId) throw new MarketsDeliveryError('Template not found in this shop.', 404);
  const [settings, templates, profiles] = await Promise.all([
    prisma.marketDeliverySettings.findMany({ where: { shopId: template.shopId, templateId: { not: null } } }),
    prisma.ourCategory.findMany({ where: { shopId: template.shopId }, select: { id: true, followedTemplateId: true } }),
    prisma.deliveryProfile.findMany({ where: { shopId: template.shopId, archivedAt: null }, include: profileInclude }),
  ]);
  const own = settings.find(row => row.templateId === template.id);
  const inherited = toSettings(templateSettingsFor(template.followedTemplateId, { settings, templates }));
  const selected = toSettings(own) ?? inherited;
  const forVariant = (variant: PhysicalVariant) => effective({ own: undefined, inherited: null, settings: selected,
    profile: profiles.find(profile => String(profile.id) === (variant === 'print' ? selected?.printProfileId : selected?.customisedProfileId)) ?? null });
  const print = forVariant('print'); const customised = forVariant('customised');
  return { shopId: template.shop.etsyShopId.toString(), profiles: profiles.map(row => dto(row, template.shop.etsyShopId.toString())), settings: toSettings(own), templateSettings: inherited, effective: { print, customised }, isInherited: !own, pending: print.pending || customised.pending, baseDescription: '' };
}

export async function saveTemplateMarketsDelivery(templateId: string, input: unknown, expectedShopId?: string) {
  const template = await prisma.ourCategory.findUnique({ where: { id: deliveryId(templateId, 'template') }, include: { shop: true } });
  if (!template) throw new MarketsDeliveryError('Template not found.', 404);
  if (expectedShopId && template.shop.etsyShopId.toString() !== expectedShopId) throw new MarketsDeliveryError('Template not found in this shop.', 404);
  const settings = validateDeliverySettings(input);
  await validateSelectedProfiles(template.shopId, settings);
  if (template.printsFrames && template.customisePrints && template.printFrameSectionId === template.customisedSectionId
    && settings?.printProfileId && settings.customisedProfileId && settings.printProfileId !== settings.customisedProfileId) {
    throw new MarketsDeliveryError('These products share one Etsy listing and must use the same delivery profile.');
  }
  const graph = await loadGraph(template.shop);
  const affected: Array<{ listingId: string; variant: PhysicalVariant }> = [];
  for (const listing of graph.listings) {
    if (graph.settings.some(row => row.listingId === listing.id)) continue;
    const visited = new Set<number>();
    let current = listing.ourCategoryId;
    while (current !== null && !visited.has(current)) {
      visited.add(current);
      if (current === template.id) { affected.push(...actualVariants(listing).map(variant => ({ listingId: String(listing.id), variant }))); break; }
      if (graph.settings.some(row => row.templateId === current)) break;
      current = graph.templates.find(row => row.id === current)?.followedTemplateId ?? null;
    }
  }
  if (!settings) await prisma.marketDeliverySettings.deleteMany({ where: { templateId: template.id } });
  else await prisma.marketDeliverySettings.upsert({ where: { templateId: template.id }, create: { ...settingsData(settings), templateId: template.id, shopId: template.shopId }, update: settingsData(settings) });
  const updated = await loadGraph(template.shop);
  await markPending(affected.map(item => {
    const listing = updated.listings.find(row => row.id === Number(item.listingId));
    return { ...item, profileId: listing ? selection(listing, updated, item.variant).profile?.id ?? null : null };
  }));
  return getTemplateMarketsDelivery(templateId);
}

type AssignmentResult = { baseDescription?: string; managedDescription?: string; expected?: EffectiveListingDelivery };

function assertDeliveryUnchanged(delivery: EffectiveListingDelivery, descriptions: AssignmentResult) {
  if (delivery.descriptionConflict) throw new MarketsDeliveryError(delivery.descriptionConflict, 409);
  if (descriptions.expected && deliverySettingsFingerprint(descriptions.expected) !== deliverySettingsFingerprint(delivery)) {
    throw new MarketsDeliveryError('Markets & Delivery settings changed while this listing was syncing. The listing remains pending; review and retry.', 409);
  }
}

export async function recordDeliveryAssignmentMetadata(context: ListingEditorContext, variant: PhysicalVariant, remoteId: string, descriptions: AssignmentResult = {}) {
  const { listing } = await listingContext(context);
  // Re-read current local defaults/overrides against the profile sent to Etsy:
  // persisting a new or partial Etsy response must not change the fallback lookup.
  const delivery = await getEffectiveListingDelivery(context, variant, { shippingProfileId: descriptions.expected?.shippingProfileId ?? undefined });
  assertDeliveryUnchanged(delivery, descriptions);
  const previous = await prisma.deliveryAssignmentSync.findUnique({ where: { listingId_variant: { listingId: listing.id, variant } } });
  if (!delivery.usesManagedProfile && !delivery.includeDeliveryInformation && !previous && delivery.deliveryInformation === '') return;
  const fields = { profileId: delivery.profileId === null ? null : Number(delivery.profileId), etsyListingId: remoteId,
    etsyShippingProfileId: delivery.shippingProfileId, profileRevision: delivery.profileRevision,
    settingsFingerprint: deliverySettingsFingerprint(delivery), status: 'PENDING', error: null,
    ...(descriptions.baseDescription !== undefined ? { baseDescription: descriptions.baseDescription } : {}),
    ...(descriptions.managedDescription !== undefined ? { managedDescription: descriptions.managedDescription } : {}),
  };
  await prisma.deliveryAssignmentSync.upsert({ where: { listingId_variant: { listingId: listing.id, variant }, status: { not: 'CONFLICT' } }, create: { ...fields, listingId: listing.id, variant }, update: fields });
}

export async function markDeliveryAssignmentSynced(context: ListingEditorContext, variant: PhysicalVariant, remoteId: string, descriptions: AssignmentResult = {}) {
  await recordDeliveryAssignmentMetadata(context, variant, remoteId, descriptions);
  const delivery = await getEffectiveListingDelivery(context, variant, { shippingProfileId: descriptions.expected?.shippingProfileId ?? undefined });
  assertDeliveryUnchanged(delivery, descriptions);
  if (delivery.usesManagedProfile && delivery.profileSyncStatus !== 'SYNCED') throw new MarketsDeliveryError('The delivery profile changed while this listing was syncing. Sync the profile, then retry the listing.', 409);
  const completed = await prisma.deliveryAssignmentSync.updateMany({ where: { listingId: Number(context.listingId), variant, status: { not: 'CONFLICT' }, settingsFingerprint: deliverySettingsFingerprint(delivery) }, data: { status: 'SYNCED', lastSyncedAt: new Date(), error: null, settingsFingerprint: deliverySettingsFingerprint(delivery), profileRevision: delivery.profileRevision } });
  if (delivery.usesManagedProfile || delivery.includeDeliveryInformation || delivery.deliveryInformation) {
    if (completed.count !== 1) throw new MarketsDeliveryError('Delivery settings or the remote description changed during sync. Review and retry this physical listing.', 409);
  }
}
