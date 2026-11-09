import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => {
  const tx = {
    listing: { upsert: vi.fn() },
    etsyListing: { findFirst: vi.fn(), upsert: vi.fn(), update: vi.fn() },
    deliveryAssignmentSync: { findUnique: vi.fn(), update: vi.fn() },
    etsyListingMaterial: { deleteMany: vi.fn(), createMany: vi.fn() },
  };
  return { tx, transaction: vi.fn(), defaults: vi.fn() };
});
vi.mock('@/lib/prisma', () => ({ prisma: { $transaction: mocks.transaction } }));
vi.mock('@/lib/listing-products', () => ({ ensureListingProductDefaultsInTransaction: mocks.defaults }));
vi.mock('@/lib/etsy-oauth', () => ({ getEtsyKeystring: vi.fn(), getValidEtsyAccessToken: vi.fn(), readSavedTokens: vi.fn() }));

import { syncEtsyListingDownload } from './etsy-sync';

const base = 'Artwork details\n\nDelivery\nA manually written paragraph.';
const rendered = `${base}\n\nDelivery\nManaged customer information.`;
function local(overrides: Record<string, unknown> = {}) {
  return { id: 51, shopId: '100', etsyId: '500', etsyCustomisedId: '501', etsyDownloadId: '502', description: base,
    productConfig: { id: 1 }, detailsChanged: false, tagsChanged: true, imagesChanged: true, downloadsChanged: true,
    productsChanged: true, ...overrides };
}
function assignment(overrides: Record<string, unknown> = {}) {
  return { id: 1, listingId: 51, variant: 'print', etsyListingId: '500', baseDescription: base,
    managedDescription: rendered, status: 'SYNCED', error: null, ...overrides };
}
const remote = (description = rendered, listingId = '500', type = 'physical') => ({
  listing_id: listingId, shop_id: '100', title: 'Artwork', description, state: 'inactive', listing_type: type, shop_section_id: 9,
});

beforeEach(() => {
  vi.resetAllMocks();
  mocks.transaction.mockImplementation(async (callback) => callback(mocks.tx));
  mocks.tx.etsyListing.findFirst.mockResolvedValue(local());
  mocks.tx.etsyListing.upsert.mockResolvedValue({ id: 51, etsyId: '500' });
  mocks.tx.deliveryAssignmentSync.findUnique.mockResolvedValue(assignment());
});

describe('importing Etsy descriptions owned by Markets & Delivery', () => {
  it('retains the separate base when Etsy returns the last rendered description', async () => {
    await syncEtsyListingDownload('100', '1', remote(), [], []);
    expect(mocks.tx.etsyListing.upsert).toHaveBeenCalledWith(expect.objectContaining({
      update: expect.objectContaining({ description: base, rawJson: expect.objectContaining({ description: rendered }) }),
    }));
    expect(mocks.tx.deliveryAssignmentSync.update).not.toHaveBeenCalled();
  });

  it('preserves the base and marks a conflict when someone edits the description on Etsy', async () => {
    await syncEtsyListingDownload('100', '1', remote('Changed directly on Etsy'), [], []);
    expect(mocks.tx.etsyListing.upsert).toHaveBeenCalledWith(expect.objectContaining({
      update: expect.objectContaining({ description: base, rawJson: expect.objectContaining({ description: 'Changed directly on Etsy' }) }),
    }));
    expect(mocks.tx.deliveryAssignmentSync.update).toHaveBeenCalledWith({
      where: { listingId_variant: { listingId: 51, variant: 'print' } },
      data: { status: 'CONFLICT', error: expect.stringContaining('changed outside this application') },
    });
  });

  it('preserves unsynced local text while still flagging remote changes', async () => {
    mocks.tx.etsyListing.findFirst.mockResolvedValue(local({ detailsChanged: true, description: 'New local base' }));
    await syncEtsyListingDownload('100', '1', remote('Changed on Etsy'), [], []);
    expect(mocks.tx.etsyListing.upsert.mock.calls[0][0].update).not.toHaveProperty('description');
    expect(mocks.tx.deliveryAssignmentSync.update).toHaveBeenCalled();
  });

  it('protects the base for a pending assignment with no successful description snapshot', async () => {
    mocks.tx.deliveryAssignmentSync.findUnique.mockResolvedValue(assignment({ status: 'PENDING', managedDescription: null, etsyListingId: null }));
    await syncEtsyListingDownload('100', '1', remote(), [], []);
    expect(mocks.tx.etsyListing.upsert.mock.calls[0][0].update.description).toBe(base);
    expect(mocks.tx.deliveryAssignmentSync.update).not.toHaveBeenCalled();
  });

  it('recovers a known base if an older import already copied the rendered text into it', async () => {
    mocks.tx.etsyListing.findFirst.mockResolvedValue(local({ description: rendered }));
    await syncEtsyListingDownload('100', '1', remote(), [], []);
    expect(mocks.tx.etsyListing.upsert.mock.calls[0][0].update.description).toBe(base);
  });

  it('leaves unmanaged, manually written Delivery text untouched', async () => {
    mocks.tx.deliveryAssignmentSync.findUnique.mockResolvedValue(null);
    const authored = 'Description\nDelivery\nWritten by the seller.\n  Preserved formatting.';
    await syncEtsyListingDownload('100', '1', remote(authored), [], []);
    expect(mocks.tx.etsyListing.upsert.mock.calls[0][0].update.description).toBe(authored);
  });

  it('imports a customised product into its existing artwork without overwriting the shared base or creating a duplicate', async () => {
    mocks.tx.deliveryAssignmentSync.findUnique.mockResolvedValue(assignment({ variant: 'customised', etsyListingId: '501' }));
    const saved = await syncEtsyListingDownload('100', '1', remote('Custom text changed in Etsy', '501'), [], []);
    expect(saved).toEqual({ id: 51, etsyId: '500' });
    expect(mocks.tx.etsyListing.upsert).not.toHaveBeenCalled();
    expect(mocks.tx.etsyListing.update).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: 51 }, data: expect.objectContaining({ etsyCustomisedRawJson: expect.objectContaining({ description: 'Custom text changed in Etsy' }) }),
    }));
    expect(mocks.tx.etsyListing.update.mock.calls[0][0].data).not.toHaveProperty('description');
    expect(mocks.tx.deliveryAssignmentSync.update.mock.calls[0][0].where.listingId_variant.variant).toBe('customised');
  });

  it('keeps a mapped digital description separate and never applies physical ownership rules to it', async () => {
    await syncEtsyListingDownload('100', '1', remote('Digital description', '502', 'download'), [], []);
    expect(mocks.tx.etsyListing.upsert).not.toHaveBeenCalled();
    expect(mocks.tx.deliveryAssignmentSync.findUnique).not.toHaveBeenCalled();
    expect(mocks.tx.etsyListing.update.mock.calls[0][0].data).toMatchObject({ digitalDescription: 'Digital description' });
    expect(mocks.tx.etsyListing.update.mock.calls[0][0].data).not.toHaveProperty('description');
  });

  it('rejects a listing from another shop before importing it', async () => {
    await expect(syncEtsyListingDownload('999', '1', remote(), [], [])).rejects.toThrow('does not belong to this shop');
    expect(mocks.transaction).not.toHaveBeenCalled();
  });
});
