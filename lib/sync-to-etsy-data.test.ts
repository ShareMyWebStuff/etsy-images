import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ sections: vi.fn(), prices: vi.fn(), remoteSections: vi.fn() }));
vi.mock('@/lib/prisma', () => ({ prisma: {
  etsyShopSection: { findMany: mocks.sections },
  adminProductPrice: { findMany: mocks.prices },
} }));
vi.mock('@/lib/local-shop-sections', () => ({ getRemoteEtsySectionIds: mocks.remoteSections }));

import { getSyncToEtsyData } from '@/lib/sync-to-etsy';
import { createListingPrintCropSettings, defaultNativeListingPrintCropDraft } from '@/lib/listing-print-crops';
import { PRINTABLE_DOWNLOAD_SPECS } from '@/lib/printable-download-specs';

const originalDate = new Date('2026-11-01T12:00:00Z');
const syncedDate = new Date('2026-11-02T12:00:00Z');
const changedDate = new Date('2026-11-03T12:00:00Z');
const resyncedDate = new Date('2026-11-04T12:00:00Z');

type DeliveryAssignmentFixture = {
  variant: string;
  status: string;
  profileRevision: number | null;
  profile: {
    name: string;
    revision: number;
    syncedRevision: number | null;
    syncStatus: string;
    etsyShippingProfileId: string | null;
    archivedAt: Date | null;
  } | null;
};

function deliveryAssignment(overrides: Partial<DeliveryAssignmentFixture> = {}): DeliveryAssignmentFixture {
  return {
    variant: 'print', status: 'PENDING', profileRevision: 1,
    profile: { name: 'UK delivery', revision: 2, syncedRevision: 2, syncStatus: 'SYNCED', etsyShippingProfileId: '12345', archivedAt: null },
    ...overrides,
  };
}

function syncedListing(id = 518) {
  const source = { fileName: 'thumbnail.jpg', updatedAt: originalDate.toISOString(), width: 600, height: 900 };
  return {
    id, title: 'Scarecrow print', localDirectoryName: `Scarecrow ${id}`, sourceSection: null,
    description: 'Print description', quantity: 999,
    digitalTitle: 'Scarecrow download', digitalDescription: 'Download description', digitalQuantity: 999,
    listingDescription: 'A scarecrow', primaryColour: 'Brown', secondaryColour: 'Green',
    etsyId: `print-${id}`, etsyDownloadId: `digital-${id}`, etsyCustomisedId: null as string | null,
    state: 'draft', etsyDownloadState: 'draft', etsyCustomisedState: 'draft',
    shopSectionId: 123, etsyDownloadShopSectionId: 456, etsyCustomisedShopSectionId: 789,
    etsyDownloadRawJson: null, etsyProductType: 'physical',
    numberOfItems: 1, includeAllItems: false,
    lastSyncedAt: syncedDate, etsyDownloadLastSyncedAt: syncedDate, etsyCustomisedLastSyncedAt: syncedDate,
    lastLocalChangeAt: originalDate,
    detailsChanged: false, tagsChanged: false, imagesChanged: false, downloadsChanged: false, productsChanged: false,
    thumbnailFileName: source.fileName, thumbnailUpdatedAt: originalDate,
    printCropSettings: createListingPrintCropSettings(defaultNativeListingPrintCropDraft(source.width, source.height), source),
    personalisationTextAreas: {},
    productConfig: { listOnEtsy: true, customisePrints: false, customTop: true, customBottom: true, sku: 'SKU_000518' },
    tags: [{ id: 1 }], products: [{ id: 1, productType: 'physical', priceKey: 'unframed_a4' }],
    images: [{ localFileName: 'template.jpg', ourCategoryImageTemplateId: 10 }],
    files: [
      ...PRINTABLE_DOWNLOAD_SPECS.map((spec) => ({
        localFileName: `Scarecrow_${spec.fileToken}.jpg`, originalFileName: `Scarecrow_${spec.fileToken}.jpg`,
        filename: `Scarecrow_${spec.fileToken}.jpg`, sizeBytes: 1000,
        widthPixels: spec.portraitWidth, heightPixels: spec.portraitHeight, rawJson: {},
      })),
      { localFileName: 'How_To_Print_Guide.pdf', rawJson: {}, sizeBytes: 1000 },
      { localFileName: 'DownloadInstructions.pdf', rawJson: { kind: 'dropbox_instruction_pdf' }, sizeBytes: 1000 },
    ],
    dropboxBundle: { sharedUrl: 'https://example.com/download' }, dropboxFiles: [],
    dropboxSyncedAt: syncedDate, dropboxRevision: 1, downloadsRevision: 1,
    groupItems: [] as Array<{ id: number }>,
    deliveryAssignmentSyncs: [] as DeliveryAssignmentFixture[],
    ourCategory: {
      updatedAt: originalDate, templateType: 'single', itemCount: 1,
      printsFrames: true, customisePrints: false, customTop: true, customBottom: true, digitalDownload: true,
      printFrameSection: { id: 1, etsyShopSectionId: 123, title: 'Prints' },
      customisedSection: { id: 3, etsyShopSectionId: 789, title: 'Customised' },
      downloadSection: { id: 2, etsyShopSectionId: 456, title: 'Downloads' },
      imageTemplates: [{ id: 10, updatedAt: originalDate, linkedSourceImageTemplate: null as { updatedAt: Date } | null }],
      followedTemplate: null as { updatedAt: Date; imageTemplates: Array<{ updatedAt: Date }> } | null,
    },
  };
}

function loadListings(...listings: ReturnType<typeof syncedListing>[]) {
  mocks.remoteSections.mockResolvedValue([123, 456, 789]);
  mocks.sections.mockResolvedValue([{
    id: 14, title: 'Scarecrows', shop: { etsyShopId: 66615491n, shopName: 'Test Shop' },
    subSections: [{ id: 26, name: 'SingleListings', listings }],
  }]);
}

beforeEach(() => {
  vi.resetAllMocks();
  mocks.sections.mockResolvedValue([{
    id: 14, title: 'Scarecrows',
    shop: { etsyShopId: 66615491n, shopName: 'Test Shop', title: 'Test Shop' },
    subSections: [],
  }]);
  mocks.prices.mockResolvedValue([]);
});

describe('template changes on Sync to Etsy', () => {
  it.each([originalDate, syncedDate])('keeps an unchanged template synced: %s', async (updatedAt) => {
    const listing = syncedListing();
    listing.ourCategory.updatedAt = updatedAt;
    loadListings(listing);
    const data = await getSyncToEtsyData();
    for (const section of [...data.sections, ...data.localSections]) {
      for (const row of section.listings) {
        expect(row).toMatchObject({ isComplete: true, canSync: false, isSynced: true });
        expect(row.pendingChanges).not.toContain('Template');
      }
    }
    expect(data.sections).toHaveLength(2);
  });

  it('allows every listing using an updated template to resync in both views', async () => {
    const listings = [syncedListing(518), syncedListing(519)];
    for (const listing of listings) listing.ourCategory.updatedAt = changedDate;
    loadListings(...listings);
    const data = await getSyncToEtsyData();
    for (const section of [...data.sections, ...data.localSections]) {
      expect(section.listings.length).toBeGreaterThan(0);
      for (const row of section.listings) {
        expect(row).toMatchObject({ isComplete: true, canSync: true, isSynced: false });
        expect(row.pendingChanges).toEqual(['Template']);
      }
    }
  });

  it.each(['image', 'linked image', 'followed template', 'followed image'])(
    'detects changes to an inherited %s', async (change) => {
      const listing = syncedListing();
      if (change === 'image') listing.ourCategory.imageTemplates[0].updatedAt = changedDate;
      if (change === 'linked image') listing.ourCategory.imageTemplates[0].linkedSourceImageTemplate = { updatedAt: changedDate };
      if (change.startsWith('followed')) {
        listing.ourCategory.templateType = 'multiple';
        listing.ourCategory.itemCount = 3;
        listing.groupItems = [{ id: 1 }, { id: 2 }, { id: 3 }];
        listing.ourCategory.followedTemplate = {
          updatedAt: change === 'followed template' ? changedDate : originalDate,
          imageTemplates: [{ updatedAt: change === 'followed image' ? changedDate : originalDate }],
        };
      }
      loadListings(listing);
      const data = await getSyncToEtsyData();
      expect(data.localSections[0].listings.every((row) => row.canSync && row.pendingChanges.includes('Template'))).toBe(true);
    },
  );

  it('tracks print, customised and download sync completion independently', async () => {
    const listing = syncedListing();
    listing.ourCategory.updatedAt = changedDate;
    listing.ourCategory.customisePrints = true;
    listing.productConfig.customisePrints = true;
    listing.etsyCustomisedId = 'customised-518';
    listing.lastSyncedAt = resyncedDate;
    loadListings(listing);
    let data = await getSyncToEtsyData();
    const rows = () => data.localSections[0].listings;
    expect(rows().find((row) => row.syncVariants.includes('print'))?.canSync).toBe(false);
    expect(rows().find((row) => row.syncVariants.includes('customised'))?.canSync).toBe(true);
    expect(rows().find((row) => row.syncVariants.includes('download'))?.canSync).toBe(true);
    listing.etsyCustomisedLastSyncedAt = resyncedDate;
    listing.etsyDownloadLastSyncedAt = resyncedDate;
    data = await getSyncToEtsyData();
    expect(rows().every((row) => !row.canSync && !row.pendingChanges.includes('Template'))).toBe(true);
  });

  it('does not mark listings using an unchanged template for resync', async () => {
    const changed = syncedListing(518);
    changed.ourCategory.updatedAt = changedDate;
    loadListings(changed, syncedListing(519));
    const data = await getSyncToEtsyData();
    expect(data.localSections[0].listings.filter((row) => row.id === '518').every((row) => row.canSync)).toBe(true);
    expect(data.localSections[0].listings.filter((row) => row.id === '519').every((row) => !row.canSync)).toBe(true);
  });

  it('continues to require a complete listing after its template changes', async () => {
    const listing = syncedListing();
    listing.ourCategory.updatedAt = changedDate;
    listing.tags = [];
    loadListings(listing);
    const data = await getSyncToEtsyData();
    expect(data.localSections[0].listings.every((row) => !row.canSync && !row.isComplete)).toBe(true);
  });
});

describe('remote Etsy section checks', () => {
  it('keeps checking Etsy by default for Etsy sync', async () => {
    mocks.remoteSections.mockResolvedValue([123]);
    await getSyncToEtsyData();
    expect(mocks.remoteSections).toHaveBeenCalledWith('66615491');
  });

  it('can load local listing data for PrintShrimp while Etsy is unavailable', async () => {
    mocks.remoteSections.mockRejectedValue(new Error('Etsy unavailable'));
    await expect(getSyncToEtsyData({ checkRemoteSections: false })).resolves.toEqual({ localSections: [], sections: [] });
    expect(mocks.remoteSections).not.toHaveBeenCalled();
  });
});

describe('physical Markets & Delivery sync eligibility', () => {
  it.each(['PENDING', 'FAILED'])('allows retry of a %s physical assignment without making digital downloads pending', async (status) => {
    const listing = syncedListing();
    listing.deliveryAssignmentSyncs = [deliveryAssignment({ status })];
    loadListings(listing);
    const data = await getSyncToEtsyData();
    for (const section of [...data.sections, ...data.localSections]) {
      for (const row of section.listings) {
        if (row.syncVariants.includes('print')) expect(row).toMatchObject({ canSync: true, isSynced: false, pendingChanges: ['Markets & Delivery'], syncDisabledReason: null });
        else expect(row).toMatchObject({ canSync: false, isSynced: true, pendingChanges: [] });
      }
    }
  });

  it('detects a newer synced profile revision even when the assignment status is already synced', async () => {
    const listing = syncedListing();
    listing.deliveryAssignmentSyncs = [deliveryAssignment({ status: 'SYNCED', profileRevision: 1 })];
    loadListings(listing);
    const data = await getSyncToEtsyData();
    const print = data.sections.flatMap(section => section.listings).find(row => row.syncVariants.includes('print'));
    expect(print).toMatchObject({ canSync: true, isSynced: false, pendingChanges: ['Markets & Delivery'] });
  });

  it.each(['LOCAL_ONLY', 'PENDING', 'CONFLICT', 'FAILED'])('requires the %s physical profile to sync first while keeping digital eligibility independent', async (syncStatus) => {
    const listing = syncedListing();
    const assignment = deliveryAssignment({ status: 'SYNCED', profileRevision: 2 });
    assignment.profile!.syncStatus = syncStatus;
    listing.deliveryAssignmentSyncs = [assignment];
    listing.etsyDownloadLastSyncedAt = originalDate;
    listing.lastLocalChangeAt = changedDate;
    listing.lastSyncedAt = resyncedDate;
    listing.detailsChanged = true;
    loadListings(listing);
    const data = await getSyncToEtsyData();
    const rows = data.sections.flatMap(section => section.listings);
    const print = rows.find(row => row.syncVariants.includes('print'));
    const download = rows.find(row => row.syncVariants.includes('download'));
    expect(print).toMatchObject({ canSync: false, isSynced: false, pendingChanges: ['Markets & Delivery'] });
    expect(print?.syncDisabledReason).toContain('Sync delivery profile "UK delivery"');
    expect(download?.canSync).toBe(true);
    expect(download?.pendingChanges).toEqual(['Details']);
  });

  it('blocks profile sync states whose confirmed remote revision does not match the current revision', async () => {
    const listing = syncedListing();
    const assignment = deliveryAssignment({ status: 'SYNCED', profileRevision: 2 });
    assignment.profile!.syncedRevision = 1;
    listing.deliveryAssignmentSyncs = [assignment];
    loadListings(listing);
    const data = await getSyncToEtsyData();
    const print = data.localSections[0].listings.find(row => row.syncVariants.includes('print'));
    expect(print?.canSync).toBe(false);
    expect(print?.syncDisabledReason).toContain('Markets & Delivery first');
  });

  it('requires explicit review of a physical description conflict', async () => {
    const listing = syncedListing();
    listing.deliveryAssignmentSyncs = [deliveryAssignment({ status: 'CONFLICT', profileRevision: 2 })];
    loadListings(listing);
    const data = await getSyncToEtsyData();
    const print = data.localSections[0].listings.find(row => row.syncVariants.includes('print'));
    expect(print).toMatchObject({ canSync: false, pendingChanges: ['Markets & Delivery'] });
    expect(print?.syncDisabledReason).toContain('Review the customer description conflict');
    expect(data.localSections[0].listings.find(row => row.syncVariants.includes('download'))?.pendingChanges).toEqual([]);
  });

  it('tracks customised physical assignments independently from print and digital IDs', async () => {
    const listing = syncedListing();
    listing.ourCategory.customisePrints = true;
    listing.productConfig.customisePrints = true;
    listing.etsyCustomisedId = 'customised-518';
    listing.deliveryAssignmentSyncs = [
      deliveryAssignment({ variant: 'print', status: 'SYNCED', profileRevision: 2 }),
      deliveryAssignment({ variant: 'customised', status: 'PENDING', profileRevision: null }),
    ];
    loadListings(listing);
    const data = await getSyncToEtsyData();
    const rows = data.localSections[0].listings;
    expect(rows.find(row => row.syncVariants.includes('print'))).toMatchObject({ canSync: false, isSynced: true, pendingChanges: [] });
    expect(rows.find(row => row.syncVariants.includes('customised'))).toMatchObject({ canSync: true, isSynced: false, pendingChanges: ['Markets & Delivery'] });
    expect(rows.find(row => row.syncVariants.includes('download'))).toMatchObject({ canSync: false, isSynced: true, pendingChanges: [] });
  });

  it('allows wording-only pending work without requiring a physical profile', async () => {
    const listing = syncedListing();
    listing.deliveryAssignmentSyncs = [deliveryAssignment({ profile: null, profileRevision: null })];
    loadListings(listing);
    const data = await getSyncToEtsyData();
    expect(data.localSections[0].listings.find(row => row.syncVariants.includes('print'))).toMatchObject({ canSync: true, pendingChanges: ['Markets & Delivery'] });
  });

  it('blocks a combined category row from sending a blocked physical product alongside a digital product', async () => {
    const listing = syncedListing();
    listing.ourCategory.downloadSection = { ...listing.ourCategory.printFrameSection };
    listing.etsyDownloadShopSectionId = 123;
    const assignment = deliveryAssignment();
    assignment.profile!.syncStatus = 'PENDING';
    listing.deliveryAssignmentSyncs = [assignment];
    listing.etsyDownloadLastSyncedAt = originalDate;
    listing.lastLocalChangeAt = changedDate;
    listing.lastSyncedAt = resyncedDate;
    listing.detailsChanged = true;
    loadListings(listing);
    const data = await getSyncToEtsyData();
    expect(data.sections).toHaveLength(1);
    expect(data.sections[0].listings[0]).toMatchObject({ canSync: false, syncVariants: ['print', 'download'] });
    expect(data.sections[0].listings[0].syncDisabledReason).toContain('Sync delivery profile');
  });
});
