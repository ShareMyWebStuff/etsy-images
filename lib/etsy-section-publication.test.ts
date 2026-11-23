import { describe, expect, it } from 'vitest';
import type { SyncToEtsyListing } from '@/lib/sync-to-etsy';
import { summarizeSectionPublication } from '@/lib/etsy-section-publication';

function row(extra: Partial<SyncToEtsyListing> = {}): SyncToEtsyListing {
  return {
    id: '10', listingName: 'Artwork', subjectName: 'Art', localDirectoryName: 'Artwork',
    subSectionId: '3', subSectionName: 'Single Listings', hasEtsyListing: true,
    hasActiveEtsyListing: false, isComplete: true, isSynced: true, isPublished: false,
    isInactive: false, canSync: false, pendingChanges: [], syncDisabledReason: null,
    etsyProductType: 'physical', etsyListingMode: 'physical', etsyCategory: 'Wall Art',
    categoryUses: ['Print / Frames'], syncVariants: ['print'], listOnEtsy: true, ...extra,
  };
}

describe('section publication summary', () => {
  it('returns an empty summary without any publication targets', () => {
    expect(summarizeSectionPublication([])).toEqual({ published: 0, synced: 0, notSynced: 0, targets: [] });
  });

  it('counts each local listing in one disjoint bucket across represented Etsy products', () => {
    const listings = [
      row({ id: '1', isPublished: true, isSynced: false }),
      row({ id: '1', isPublished: true, isSynced: false, syncVariants: ['download'] }),
      row({ id: '2', isPublished: true, isSynced: false }),
      row({ id: '2', syncVariants: ['download'], etsyCategory: 'Downloads' }),
      row({ id: '3', isPublished: true, isSynced: false }),
      row({ id: '3', hasEtsyListing: false, isSynced: false, syncVariants: ['download'] }),
      row({ id: '4', isInactive: true, isSynced: false }),
      row({ id: '5', isComplete: false, isSynced: false }),
    ];
    const result = summarizeSectionPublication(listings);
    expect(result).toMatchObject({ published: 1, synced: 1, notSynced: 3 });
    expect(result.published + result.synced + result.notSynced).toBe(new Set(listings.map((listing) => listing.id)).size);
    expect(result.targets).toEqual([{ id: '2', listingName: 'Artwork', variants: ['download'], etsyCategory: 'Downloads' }]);
  });

  it('merges eligible variants in deterministic order and deduplicates repeated rows and category names', () => {
    expect(summarizeSectionPublication([
      row({ syncVariants: ['download', 'print', 'download'], etsyCategory: 'Shared section' }),
      row({ syncVariants: ['customised'], etsyCategory: 'Personalised gifts' }),
      row({ syncVariants: ['print'], etsyCategory: 'Shared section' }),
      row({ syncVariants: ['customised'], etsyCategory: 'Personalised gifts' }),
    ])).toEqual({ published: 0, synced: 1, notSynced: 0, targets: [
      { id: '10', listingName: 'Artwork', variants: ['print', 'customised', 'download'], etsyCategory: 'Shared section, Personalised gifts' },
    ] });
  });

  it('never adds ineligible variants or category names when another product for the same listing is eligible', () => {
    const result = summarizeSectionPublication([
      row(),
      row({ syncVariants: ['customised'], etsyCategory: 'Needs resync', isSynced: false, pendingChanges: ['Details'] }),
      row({ syncVariants: ['download'], etsyCategory: 'Inactive downloads', isInactive: true, isSynced: false }),
    ]);
    expect(result).toEqual({ published: 0, synced: 0, notSynced: 1, targets: [
      { id: '10', listingName: 'Artwork', variants: ['print'], etsyCategory: 'Wall Art' },
    ] });
  });

  it.each([
    { listOnEtsy: false }, { isComplete: false }, { hasEtsyListing: false },
    { isSynced: false }, { isPublished: true }, { isInactive: true }, { pendingChanges: ['Products'] },
  ])('excludes a draft from bulk publication when eligibility fails: %j', (extra) => {
    expect(summarizeSectionPublication([row(extra)]).targets).toEqual([]);
  });

  it('uses status definitions for counts independently of publication eligibility', () => {
    expect(summarizeSectionPublication([
      row({ id: '1', isPublished: true, isSynced: false, isComplete: false }),
      row({ id: '2', listOnEtsy: false }),
    ])).toEqual({ published: 1, synced: 1, notSynced: 0, targets: [] });
  });

  it('does not interpret a blocked sync action as a synced draft', () => {
    expect(summarizeSectionPublication([row({ isSynced: false, canSync: false, syncDisabledReason: 'Delivery profile needs attention.' })]))
      .toEqual({ published: 0, synced: 0, notSynced: 1, targets: [] });
  });

  it('keeps target order stable and does not merge different local listings sharing one Etsy category', () => {
    const input = [row({ id: '20', listingName: 'First' }), row({ id: '10', listingName: 'Second' }), row({ id: '20', listingName: 'First' })];
    const before = structuredClone(input);
    expect(summarizeSectionPublication(input)).toEqual({ published: 0, synced: 2, notSynced: 0, targets: [
      { id: '20', listingName: 'First', variants: ['print'], etsyCategory: 'Wall Art' },
      { id: '10', listingName: 'Second', variants: ['print'], etsyCategory: 'Wall Art' },
    ] });
    expect(input).toEqual(before);
  });

  it('does not produce an unusable publication request for a row with no variants', () => {
    expect(summarizeSectionPublication([row({ syncVariants: [] })])).toEqual({ published: 0, synced: 1, notSynced: 0, targets: [] });
  });

  it('counts a shared category with active and clean draft products as synced and publishes only its draft', () => {
    expect(summarizeSectionPublication([row({
      syncVariants: ['print', 'download'], isSynced: false, hasActiveEtsyListing: true,
      publication: { allProductsSynced: true, readyVariants: ['download'] },
    })])).toEqual({ published: 0, synced: 1, notSynced: 0, targets: [
      { id: '10', listingName: 'Artwork', variants: ['download'], etsyCategory: 'Wall Art' },
    ] });
  });

  it('retains a clean variant when another product in the same category needs syncing', () => {
    expect(summarizeSectionPublication([row({
      syncVariants: ['print', 'download'], isSynced: false, pendingChanges: ['Downloads'],
      publication: { allProductsSynced: false, readyVariants: ['print'] },
    })])).toEqual({ published: 0, synced: 0, notSynced: 1, targets: [
      { id: '10', listingName: 'Artwork', variants: ['print'], etsyCategory: 'Wall Art' },
    ] });
  });

  it('intersects publication metadata with represented variants and preserves legacy row fallback', () => {
    expect(summarizeSectionPublication([
      row({ publication: { allProductsSynced: true, readyVariants: ['print', 'customised', 'download'] } }),
      row({ syncVariants: ['download'], etsyCategory: 'Downloads' }),
    ])).toEqual({ published: 0, synced: 1, notSynced: 0, targets: [
      { id: '10', listingName: 'Artwork', variants: ['print', 'download'], etsyCategory: 'Wall Art, Downloads' },
    ] });
  });

  it('keeps counters and retry targets correct after one product publishes successfully', () => {
    const current = row({ syncVariants: ['print', 'download'], publication: { allProductsSynced: true, readyVariants: ['print', 'download'] } });
    expect(summarizeSectionPublication([current]).targets[0].variants).toEqual(['print', 'download']);
    Object.assign(current, { isSynced: false, hasActiveEtsyListing: true,
      publication: { allProductsSynced: true, readyVariants: ['download'] } });
    expect(summarizeSectionPublication([current])).toEqual({ published: 0, synced: 1, notSynced: 0, targets: [
      { id: '10', listingName: 'Artwork', variants: ['download'], etsyCategory: 'Wall Art' },
    ] });
    Object.assign(current, { isPublished: true, publication: { allProductsSynced: true, readyVariants: [] } });
    expect(summarizeSectionPublication([current])).toEqual({ published: 1, synced: 0, notSynced: 0, targets: [] });
  });
});
