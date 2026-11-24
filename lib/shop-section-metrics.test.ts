import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { SyncToEtsyListing } from '@/lib/sync-to-etsy';
import { calculateShopSectionMetrics, type SectionMetricListing } from '@/lib/shop-section-metrics';

const mocks = vi.hoisted(() => ({ shop: vi.fn(), sections: vi.fn(), listings: vi.fn(), sync: vi.fn(), pending: vi.fn() }));
vi.mock('@/lib/prisma', () => ({ prisma: { etsyShop: { findUnique: mocks.shop }, etsyShopSection: { findMany: mocks.sections },
  etsyListing: { findMany: mocks.listings } } }));
vi.mock('@/lib/sync-to-etsy', () => ({ getSyncToEtsyData: mocks.sync }));
vi.mock('@/lib/listing-image-generation-state', () => ({ listingsNeedingImageGeneration: mocks.pending }));
import { getShopSectionsPageData } from '@/lib/etsy-sync';

const shopId = '66615491';
const old = new Date('2026-11-01T00:00:00Z'), synced = new Date('2026-11-02T00:00:00Z');
const sections = [
  { id: 10, title: 'Local artworks', etsyShopSectionId: '100', activeListingCount: 999, subSections: [{ id: 1 }, { id: 2 }] },
  { id: 20, title: 'Remote category', etsyShopSectionId: '200', activeListingCount: 888, subSections: [{ id: 3 }] },
];
function listing(id = 1, extra: Partial<SectionMetricListing> = {}): SectionMetricListing {
  return {
    id, shopId, subSectionId: 1, shopSectionId: 100, etsyCustomisedShopSectionId: null, etsyDownloadShopSectionId: null,
    state: 'draft', etsyId: `print-${id}`, etsyCustomisedId: null, etsyCustomisedState: null, etsyDownloadId: null, etsyDownloadState: null,
    detailsChanged: false, tagsChanged: false, imagesChanged: false, downloadsChanged: false, productsChanged: false,
    lastLocalChangeAt: old, lastSyncedAt: synced, etsyCustomisedLastSyncedAt: null, etsyDownloadLastSyncedAt: null,
    productConfig: { listOnEtsy: true, printsFramesOverride: null, digitalDownloadOverride: null,
      customisePrints: false, customTop: false, customBottom: false },
    ourCategory: { printsFrames: true, customisePrints: false, customTop: false, customBottom: false, digitalDownload: false,
      updatedAt: old, printFrameSection: { id: 1, etsyShopSectionId: 100 }, customisedSection: null, downloadSection: null }, ...extra,
  };
}
function status(id = 1, extra: Partial<SyncToEtsyListing> = {}): SyncToEtsyListing {
  return { id: String(id), listingName: 'Artwork', subjectName: 'Artwork', localDirectoryName: 'Artwork',
    subSectionId: '1', subSectionName: 'Single Listings', hasEtsyListing: true, hasActiveEtsyListing: false,
    isComplete: true, isSynced: true, isPublished: false, isInactive: false, canSync: false, pendingChanges: [],
    syncDisabledReason: null, etsyProductType: 'physical', etsyListingMode: 'physical', etsyCategory: 'Prints',
    categoryUses: ['Print / Frames'], syncVariants: ['print'], listOnEtsy: true, ...extra };
}
const metrics = (raw: SectionMetricListing[], rows: SyncToEtsyListing[], pending: number[] = []) =>
  calculateShopSectionMetrics(shopId, sections, raw, rows, new Set(pending));

describe('canonical local section metrics', () => {
  it('includes every subsection, keeps assigned listings in their local section, and scopes remote-only rows without double counts', () => {
    const raw = [listing(1, { shopSectionId: 200 }), listing(2, { subSectionId: 2 }),
      listing(3, { subSectionId: null, ourCategory: null, state: 'active', lastSyncedAt: null }),
      listing(4, { subSectionId: 3, shopSectionId: 100 }), listing(5, { subSectionId: 999 }),
      listing(6, { shopId: '999' }), listing(7, { subSectionId: null, shopSectionId: 999 }), listing(1)];
    const before = structuredClone(raw);
    const result = metrics(raw, [status(1), status(1), status(2), status(4)]);
    expect(result.get(10)).toEqual({ noOfListings: 3, noToGenerate: 1, awaitingEtsySync: 0, etsyLive: 1, noOfActive: 1, noOfDraft: 2 });
    expect(result.get(20)).toEqual({ noOfListings: 1, noToGenerate: 0, awaitingEtsySync: 0, etsyLive: 0, noOfActive: 0, noOfDraft: 1 });
    expect(raw).toEqual(before);
  });

  it('keeps incomplete/missing-image work and pending local revisions separate from the Etsy imagesChanged flag', () => {
    const result = metrics([listing(1, { imagesChanged: true }), listing(2), listing(3)], [
      status(1, { isSynced: false, pendingChanges: ['Images'] }), status(2), status(3, { isComplete: false }),
    ], [2]);
    expect(result.get(10)).toMatchObject({ noOfListings: 3, noToGenerate: 2, awaitingEtsySync: 1 });
  });

  it('counts a changed template or pending published product as awaiting sync without inventing local regeneration', () => {
    expect(metrics([listing(1)], [status(1, { isPublished: true, isSynced: false, pendingChanges: ['Template'] })]).get(10))
      .toMatchObject({ noToGenerate: 0, awaitingEtsySync: 1, etsyLive: 1 });
  });

  it('does not count clean active, draft or inactive products as awaiting sync', () => {
    expect(metrics([listing(1, { state: 'active' }), listing(2), listing(3, { state: 'inactive' })], [
      status(1, { isPublished: true, isSynced: false }), status(2), status(3, { isInactive: true, isSynced: false }),
    ]).get(10)).toMatchObject({ noOfListings: 3, awaitingEtsySync: 0, etsyLive: 1 });
  });

  it('requires every configured product to be live and counts mixed/duplicate category rows only once', () => {
    const raw = listing(); raw.ourCategory!.digitalDownload = true; raw.ourCategory!.downloadSection = { id: 2, etsyShopSectionId: 200 };
    raw.etsyDownloadId = 'digital'; raw.etsyDownloadState = 'draft'; raw.etsyDownloadShopSectionId = 200;
    expect(metrics([raw], [status(1, { isPublished: true }), status(1, { syncVariants: ['download'] }), status(1, { syncVariants: ['download'] })]).get(10))
      .toMatchObject({ noOfListings: 1, noToGenerate: 0, awaitingEtsySync: 0, etsyLive: 0 });
    expect(metrics([raw], [status(1, { isPublished: true, syncVariants: ['print', 'download'] })]).get(10)?.etsyLive).toBe(1);
  });

  it('does not hide a configured product absent from the available sync DTO rows', () => {
    const raw = listing(); raw.ourCategory!.digitalDownload = true;
    expect(metrics([raw], [status(1, { isPublished: true })]).get(10))
      .toMatchObject({ noOfListings: 1, noToGenerate: 1, awaitingEtsySync: 1, etsyLive: 0 });
  });

  it('does not require a separate customised ID when customised prints share the print product', () => {
    const raw = listing(); raw.ourCategory!.customisePrints = true; raw.ourCategory!.customTop = true;
    raw.ourCategory!.customisedSection = raw.ourCategory!.printFrameSection;
    raw.productConfig!.customisePrints = true; raw.productConfig!.customTop = true;
    expect(metrics([raw], [status(1, { isPublished: true })]).get(10))
      .toMatchObject({ noToGenerate: 0, awaitingEtsySync: 0, etsyLive: 1 });
  });

  it('counts new incomplete enabled listings and missing-category rows but excludes new disabled listings from the sync queue', () => {
    const first = listing(1, { etsyId: null });
    const second = listing(2, { etsyId: null }); second.ourCategory!.printFrameSection = null;
    const disabled = listing(3, { etsyId: null, productsChanged: true }); disabled.productConfig!.listOnEtsy = false;
    expect(metrics([first, second, disabled], [status(1, { isComplete: false, hasEtsyListing: false, isSynced: false, pendingChanges: ['New print listing'] })]).get(10))
      .toMatchObject({ noOfListings: 3, noToGenerate: 3, awaitingEtsySync: 2, etsyLive: 0 });
  });

  it('includes an existing disabled listing only when its product stock still needs updating', () => {
    const changed = listing(1, { productsChanged: true }); changed.productConfig!.listOnEtsy = false;
    const clean = listing(2); clean.productConfig!.listOnEtsy = false;
    expect(metrics([changed, clean], [status(1, { listOnEtsy: false, canSync: true, pendingChanges: ['Products'] }),
      status(2, { listOnEtsy: false })]).get(10)).toMatchObject({ awaitingEtsySync: 1 });
  });

  it('uses cached actual remote IDs for legacy live counts and treats missing status metadata as incomplete', () => {
    const raw = listing(1, { ourCategory: null, state: 'active', lastSyncedAt: null });
    expect(metrics([raw], []).get(10)).toMatchObject({ noToGenerate: 1, awaitingEtsySync: 0, etsyLive: 1 });
    raw.etsyDownloadId = 'digital'; raw.etsyDownloadState = 'draft';
    expect(metrics([raw], []).get(10)?.etsyLive).toBe(0);
  });

  it('recognises fallback Local changes from sync timestamps even when all change flags are cleared', () => {
    const raw = listing(1, { subSectionId: null, ourCategory: null, lastSyncedAt: old, lastLocalChangeAt: synced });
    expect(metrics([raw], []).get(10)?.awaitingEtsySync).toBe(1);
  });
});

describe('shop section page metrics query', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    vi.stubGlobal('fetch', vi.fn(() => { throw new Error('Section metrics must not contact Etsy.'); }));
    mocks.shop.mockResolvedValue({ id: 1, etsyShopId: BigInt(shopId), shopName: 'Shop', title: null });
    mocks.sections.mockResolvedValue(sections);
    mocks.listings.mockResolvedValue([listing(1, { shopSectionId: 200 }), listing(2, { subSectionId: 2 })]);
    mocks.sync.mockResolvedValue({ localSections: [{ listings: [status(1), status(2)] }], sections: [] });
    mocks.pending.mockResolvedValue(new Set([2]));
  });
  afterEach(() => vi.unstubAllGlobals());

  it('returns canonical counts from cached metadata without remote grouping, cached active-count inflation or network calls', async () => {
    const data = await getShopSectionsPageData(`000${shopId}`);
    expect(data?.sections).toEqual([
      { id: '10', subSectionId: '1', sectionName: 'Local artworks', noOfListings: 2, noToGenerate: 1, awaitingEtsySync: 0,
        etsyLive: 0, noOfActive: 0, noOfDraft: 2, hasEtsyShopSection: true },
      { id: '20', subSectionId: '3', sectionName: 'Remote category', noOfListings: 0, noToGenerate: 0, awaitingEtsySync: 0,
        etsyLive: 0, noOfActive: 0, noOfDraft: 0, hasEtsyShopSection: true },
    ]);
    expect(mocks.listings).toHaveBeenCalledWith(expect.objectContaining({ where: { shopId, OR: [
      { subSectionId: { in: [1, 2, 3] } }, { subSectionId: null, shopSectionId: { in: [100, 200] } },
    ] } }));
    expect(mocks.listings.mock.calls[0][0].select).not.toHaveProperty('listingImagesRevision');
    expect(mocks.pending).toHaveBeenCalledWith([1, 2]);
    expect(mocks.sync).toHaveBeenCalledWith({ checkRemoteSections: false, shopId });
    expect(fetch).not.toHaveBeenCalled();
  });

  it('returns null for malformed or unknown shops before querying section/listing data', async () => {
    expect(await getShopSectionsPageData('invalid')).toBeNull(); expect(mocks.shop).not.toHaveBeenCalled();
    mocks.shop.mockResolvedValueOnce(null);
    expect(await getShopSectionsPageData('999')).toBeNull(); expect(mocks.sections).not.toHaveBeenCalled();
    expect(mocks.listings).not.toHaveBeenCalled(); expect(mocks.sync).not.toHaveBeenCalled();
  });
});
