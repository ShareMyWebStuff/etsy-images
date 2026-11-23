import type { EtsySyncVariant } from '@/lib/etsy-sync-images';
import type { SyncToEtsyListing } from '@/lib/sync-to-etsy';

export type SectionPublicationTarget = {
  id: string;
  listingName: string;
  variants: EtsySyncVariant[];
  etsyCategory: string;
};

export type SectionPublicationSummary = {
  published: number;
  synced: number;
  notSynced: number;
  targets: SectionPublicationTarget[];
};

const VARIANT_ORDER: EtsySyncVariant[] = ['print', 'customised', 'download'];

/** Count local listings once while publishing only their eligible draft variants. */
export function summarizeSectionPublication(listings: SyncToEtsyListing[]): SectionPublicationSummary {
  const byListing = new Map<string, SyncToEtsyListing[]>();
  for (const listing of listings) {
    const rows = byListing.get(listing.id);
    if (rows) rows.push(listing);
    else byListing.set(listing.id, [listing]);
  }

  const summary: SectionPublicationSummary = { published: 0, synced: 0, notSynced: 0, targets: [] };
  for (const [id, rows] of byListing) {
    if (rows.every((row) => row.isPublished)) summary.published++;
    else if (rows.every((row) => row.publication?.allProductsSynced ?? (row.isPublished || row.isSynced))) summary.synced++;
    else summary.notSynced++;

    const eligibleRows = rows.map((row) => ({
      row,
      variants: row.publication
        ? row.publication.readyVariants.filter((variant) => row.syncVariants.includes(variant))
        : row.listOnEtsy && row.isComplete && row.hasEtsyListing && row.isSynced
          && !row.isPublished && !row.isInactive && row.pendingChanges.length === 0 ? row.syncVariants : [],
    })).filter((eligible) => eligible.variants.length > 0);
    const variants = VARIANT_ORDER.filter((variant) => eligibleRows.some((eligible) => eligible.variants.includes(variant)));
    if (variants.length === 0) continue;
    const categories = [...new Set(eligibleRows.map(({ row }) => row.etsyCategory))];
    summary.targets.push({ id, listingName: eligibleRows[0].row.listingName, variants, etsyCategory: categories.join(', ') });
  }
  return summary;
}
