import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  shop: vi.fn(), section: vi.fn(), subSection: vi.fn(), listing: vi.fn(), update: vi.fn(),
}));
vi.mock('@/lib/prisma', () => ({ prisma: {
  etsyShop: { findUnique: mocks.shop }, etsyShopSection: { findFirst: mocks.section },
  etsyShopSubSection: { findFirst: mocks.subSection },
  etsyListing: { findFirst: mocks.listing, update: mocks.update },
} }));
vi.mock('@/lib/etsy-oauth', () => ({
  getEtsyKeystring: () => 'test-key', getValidEtsyAccessToken: async () => 'test-token',
}));

import { makeListingInactive, publishListing } from '@/lib/local-listings';

const listing = {
  id: 80, etsyId: '111', state: 'active', etsyCustomisedId: '222', etsyCustomisedState: 'active',
  etsyDownloadId: '333', etsyDownloadState: 'active',
};
beforeEach(() => {
  vi.resetAllMocks();
  vi.stubEnv('ETSY_SHARED_SECRET', 'test-secret');
  mocks.shop.mockResolvedValue({ id: 1, etsyShopId: 66615491n, shopName: 'Test Shop' });
  mocks.section.mockResolvedValue({ id: 2, title: 'Bugs Wall Art', etsyShopSectionId: '123' });
  mocks.subSection.mockResolvedValue({ id: 3, name: 'SingleListings' });
  mocks.listing.mockResolvedValue(listing);
});
afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs(); });

describe.each([
  { action: 'publishing', run: publishListing, state: 'active' },
  { action: 'deactivating', run: makeListingInactive, state: 'inactive' },
])('$action a selected Etsy product', ({ run, state }) => {
  it.each([
    { variant: 'print' as const, remoteId: '111', field: 'state' },
    { variant: 'customised' as const, remoteId: '222', field: 'etsyCustomisedState' },
    { variant: 'download' as const, remoteId: '333', field: 'etsyDownloadState' },
  ])('updates only the $variant listing remotely and locally', async ({ variant, remoteId, field }) => {
    const fetchMock = vi.fn().mockResolvedValue(Response.json({ state }));
    vi.stubGlobal('fetch', fetchMock);
    await run('66615491', '2', '3', '80', [variant]);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock).toHaveBeenCalledWith(`https://openapi.etsy.com/v3/application/shops/66615491/listings/${remoteId}`, expect.objectContaining({
      method: 'PATCH', body: new URLSearchParams({ state }),
    }));
    expect(mocks.update).toHaveBeenCalledTimes(1);
    const update = mocks.update.mock.calls[0][0].data;
    expect(update[field]).toBe(state);
    for (const other of ['state', 'etsyCustomisedState', 'etsyDownloadState'].filter((key) => key !== field)) {
      expect(update).not.toHaveProperty(other);
    }
  });

  it('rejects a selected product that has not been synced instead of updating another product', async () => {
    mocks.listing.mockResolvedValue({ ...listing, etsyDownloadId: null });
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    await expect(run('66615491', '2', '3', '80', ['download'])).rejects.toThrow('Sync the selected Etsy product');
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('rejects an empty selection', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    await expect(run('66615491', '2', '3', '80', [])).rejects.toThrow('Choose the Etsy product type');
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
