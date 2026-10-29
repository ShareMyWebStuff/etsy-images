import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  listingFindUnique: vi.fn(),
  syncListingToEtsy: vi.fn(),
  publishListing: vi.fn(),
  makeListingInactive: vi.fn(),
}));

vi.mock('@/lib/prisma', () => ({
  prisma: {
    etsyListing: {
      findUnique: mocks.listingFindUnique,
    },
  },
}));

vi.mock('@/lib/local-listings', () => ({
  deleteListingFromEtsy: vi.fn(),
  makeListingInactive: mocks.makeListingInactive,
  publishListing: mocks.publishListing,
  syncListingToEtsy: mocks.syncListingToEtsy,
}));

import { makeOneListingInactive, publishOneListing, syncOneListing } from '@/lib/sync-to-etsy';

function listing(files: Array<{ localFileName: string; sizeBytes: number; rawJson: unknown }>) {
  return {
    id: 16,
    etsyId: null,
    etsyCustomisedId: null,
    etsyDownloadId: '4541724479',
    state: 'local',
    etsyDownloadState: 'inactive',
    productConfig: { listOnEtsy: true, digitalDownload: false, printsFrames: true },
    ourCategory: { printsFrames: true, customisePrints: true, digitalDownload: true },
    files,
    dropboxFiles: [],
    subSection: {
      id: 1,
      name: 'SingleListings',
      shopSection: {
        id: 1,
        title: 'Dinosaurs',
        shop: { etsyShopId: 66615491n, shopName: 'Test shop', title: null },
      },
    },
  };
}

describe('category-specific Etsy sync', () => {
  beforeEach(() => vi.clearAllMocks());

  it('passes only the selected digital variant to reactivation', async () => {
    mocks.listingFindUnique.mockResolvedValue(listing([]));
    await publishOneListing('16', ['download']);
    expect(mocks.publishListing).toHaveBeenCalledWith('66615491', '1', '1', '16', ['download']);
  });

  it('passes only the selected digital variant to deactivation', async () => {
    mocks.listingFindUnique.mockResolvedValue({ ...listing([]), etsyDownloadState: 'active' });
    await makeOneListingInactive('16', ['download']);
    expect(mocks.makeListingInactive).toHaveBeenCalledWith('66615491', '1', '1', '16', ['download']);
  });

  it('can deactivate a standalone customised listing without an active print or download', async () => {
    mocks.listingFindUnique.mockResolvedValue({ ...listing([]), etsyCustomisedId: '999', etsyCustomisedState: 'active' });
    await makeOneListingInactive('16', ['customised']);
    expect(mocks.makeListingInactive).toHaveBeenCalledWith('66615491', '1', '1', '16', ['customised']);
  });

  it('syncs only the digital variant from a Digital Downloads category row', async () => {
    mocks.listingFindUnique.mockResolvedValue(listing([{
      localFileName: 'Brachiosaurus_DownloadInstructions.pdf',
      sizeBytes: 1024,
      rawJson: { kind: 'dropbox_instruction_pdf' },
    }]));

    await syncOneListing('16', ['download']);

    expect(mocks.syncListingToEtsy).toHaveBeenCalledWith(
      '66615491', '1', '1', '16', ['download'],
    );
  });

  it('syncs only the print variant without requiring a Digital Download PDF', async () => {
    mocks.listingFindUnique.mockResolvedValue(listing([]));

    await syncOneListing('16', ['print']);

    expect(mocks.syncListingToEtsy).toHaveBeenCalledWith(
      '66615491', '1', '1', '16', ['print'],
    );
  });

  it('syncs only the customised variant without requiring a Digital Download PDF', async () => {
    mocks.listingFindUnique.mockResolvedValue(listing([]));

    await syncOneListing('16', ['customised']);

    expect(mocks.syncListingToEtsy).toHaveBeenCalledWith(
      '66615491', '1', '1', '16', ['customised'],
    );
  });
});
