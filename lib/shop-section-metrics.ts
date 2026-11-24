import type { SyncToEtsyListing } from '@/lib/sync-to-etsy';
import { effectiveListingTemplateSettings } from '@/lib/listing-template-settings';
import type { EtsySyncVariant } from '@/lib/etsy-sync-images';

export type ShopSectionMetrics = {
  noOfListings: number;
  noToGenerate: number;
  awaitingEtsySync: number;
  etsyLive: number;
  noOfActive: number;
  noOfDraft: number;
};
type TemplateSection = { id: number; etsyShopSectionId: number } | null;
export type SectionMetricListing = {
  id: number;
  shopId: string;
  subSectionId: number | null;
  shopSectionId: number | null;
  etsyCustomisedShopSectionId: number | null;
  etsyDownloadShopSectionId: number | null;
  state: string | null;
  etsyId: string | null;
  etsyCustomisedId: string | null;
  etsyCustomisedState: string | null;
  etsyDownloadId: string | null;
  etsyDownloadState: string | null;
  detailsChanged: boolean;
  tagsChanged: boolean;
  imagesChanged: boolean;
  downloadsChanged: boolean;
  productsChanged: boolean;
  lastLocalChangeAt: Date;
  lastSyncedAt: Date | null;
  etsyCustomisedLastSyncedAt: Date | null;
  etsyDownloadLastSyncedAt: Date | null;
  productConfig: { listOnEtsy: boolean; printsFramesOverride: boolean | null; digitalDownloadOverride: boolean | null;
    customisePrints: boolean; customTop: boolean; customBottom: boolean } | null;
  ourCategory: { printsFrames: boolean; customisePrints: boolean; customTop: boolean; customBottom: boolean;
    digitalDownload: boolean; updatedAt: Date; printFrameSection: TemplateSection; customisedSection: TemplateSection;
    downloadSection: TemplateSection } | null;
};
export type SectionMetricSection = { id: number; etsyShopSectionId: string | null; subSections: Array<{ id: number }> };

const live = (state: string | null) => state === 'active' || state === 'published';

function variants(listing: SectionMetricListing) {
  const template = listing.ourCategory;
  const settings = effectiveListingTemplateSettings(template, listing.productConfig);
  const enabled: EtsySyncVariant[] = [];
  if (settings.printsFrames) enabled.push('print');
  const sharesPrintSection = settings.printsFrames && template?.printFrameSection && template.customisedSection
    && template.printFrameSection.id === template.customisedSection.id;
  if (settings.customisePrints && !sharesPrintSection) enabled.push('customised');
  if (settings.digitalDownload) enabled.push('download');
  return { enabled, byVariant: {
    print: { id: listing.etsyId, state: listing.state, syncedAt: listing.lastSyncedAt,
      section: template?.printFrameSection?.etsyShopSectionId, currentSection: listing.shopSectionId },
    customised: { id: listing.etsyCustomisedId, state: listing.etsyCustomisedState, syncedAt: listing.etsyCustomisedLastSyncedAt,
      section: template?.customisedSection?.etsyShopSectionId, currentSection: listing.etsyCustomisedShopSectionId },
    download: { id: listing.etsyDownloadId, state: listing.etsyDownloadState, syncedAt: listing.etsyDownloadLastSyncedAt,
      section: template?.downloadSection?.etsyShopSectionId, currentSection: listing.etsyDownloadShopSectionId },
  } };
}

function fallbackPending(listing: SectionMetricListing, requested?: EtsySyncVariant[]) {
  const { enabled, byVariant } = variants(listing);
  const candidates = requested ?? (listing.ourCategory ? enabled : (Object.keys(byVariant) as EtsySyncVariant[]).filter((variant) => byVariant[variant].id !== null));
  return candidates.some((variant) => {
    const status = byVariant[variant];
    if (status.id === null) return true;
    const flags = listing.detailsChanged || listing.tagsChanged || listing.imagesChanged || listing.productsChanged
      || (variant === 'download' && listing.downloadsChanged);
    // A remote-only import without a template or any recorded local edit has
    // no application sync history. Existing sync timestamps remain decisive.
    const changed = status.syncedAt === null ? listing.ourCategory !== null || flags : status.syncedAt < listing.lastLocalChangeAt;
    return changed
      || Boolean(status.syncedAt && listing.ourCategory && listing.ourCategory.updatedAt > status.syncedAt)
      || Boolean(listing.ourCategory && (status.section === undefined || status.section !== status.currentSection));
  });
}

/** Canonical local membership wins over a listing's separate remote Etsy category. */
export function calculateShopSectionMetrics(shopId: string, sections: SectionMetricSection[], listings: SectionMetricListing[], syncRows: SyncToEtsyListing[],
  pendingGenerationIds: ReadonlySet<number> = new Set()) {
  const result = new Map<number, ShopSectionMetrics>();
  const bySubSection = new Map<number, number>(), byRemoteSection = new Map<number, number>();
  for (const section of sections) {
    result.set(section.id, { noOfListings: 0, noToGenerate: 0, awaitingEtsySync: 0, etsyLive: 0, noOfActive: 0, noOfDraft: 0 });
    for (const subSection of section.subSections) bySubSection.set(subSection.id, section.id);
    if (section.etsyShopSectionId !== null) {
      const remoteId = Number(section.etsyShopSectionId);
      if (Number.isSafeInteger(remoteId) && !byRemoteSection.has(remoteId)) byRemoteSection.set(remoteId, section.id);
    }
  }
  const statusesById = new Map<string, SyncToEtsyListing[]>();
  for (const row of syncRows) {
    const statuses = statusesById.get(row.id);
    if (statuses) statuses.push(row); else statusesById.set(row.id, [row]);
  }
  const seen = new Set<number>();
  for (const listing of listings) {
    if (listing.shopId !== shopId || seen.has(listing.id)) continue;
    const sectionId = listing.subSectionId !== null ? bySubSection.get(listing.subSectionId)
      : listing.shopSectionId !== null ? byRemoteSection.get(listing.shopSectionId) : undefined;
    if (sectionId === undefined) continue;
    seen.add(listing.id);
    const metric = result.get(sectionId)!;
    const rows = statusesById.get(String(listing.id)) ?? [];
    const { enabled, byVariant } = variants(listing);
    const covered = new Set(rows.flatMap((row) => row.syncVariants));
    const uncovered = enabled.filter((variant) => !covered.has(variant));
    metric.noOfListings++;
    if (!rows.length || uncovered.length > 0 || rows.some((row) => !row.isComplete)
      || pendingGenerationIds.has(listing.id)) metric.noToGenerate++;
    if (live(listing.state)) metric.noOfActive++;
    if (listing.state === 'draft') metric.noOfDraft++;
    const actual = Object.values(byVariant).filter((status) => status.id !== null);
    const listOnEtsy = listing.productConfig?.listOnEtsy ?? true;
    const awaiting = !listOnEtsy ? actual.length > 0 && (listing.productsChanged || rows.some((row) => row.canSync))
      : rows.length ? rows.some((row) => !row.hasEtsyListing || row.canSync || row.pendingChanges.length > 0) || fallbackPending(listing, uncovered)
      : fallbackPending(listing);
    if (awaiting) metric.awaitingEtsySync++;
    const allLive = rows.length ? rows.every((row) => row.isPublished)
      && uncovered.every((variant) => byVariant[variant].id !== null && live(byVariant[variant].state))
      : enabled.length ? enabled.every((variant) => byVariant[variant].id !== null && live(byVariant[variant].state))
      : actual.length > 0 && actual.every((status) => live(status.state));
    if (allLive) metric.etsyLive++;
  }
  return result;
}
