import { describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ refresh: vi.fn() }));
vi.mock('@/lib/prisma', () => ({ prisma: { etsyShop: { findMany: async () => [] } } }));
vi.mock('@/lib/etsy-oauth', () => ({ getEtsyOrderAccessToken: async () => 'token' }));
vi.mock('@/lib/etsy-order-fulfilment', () => ({ refreshPrintShrimpFulfilment: mocks.refresh, printShrimpFulfilmentDetails: vi.fn() }));
import { syncEtsyOrders } from './etsy-orders';

describe('Etsy orders download workflow', () => {
  it('runs PrintShrimp fulfilment refresh and returns its results to the download button', async () => {
    mocks.refresh.mockResolvedValue({ printShrimpRefreshed: 1, etsyDispatchesUpdated: 1, fulfilmentWarnings: [] });
    expect(await syncEtsyOrders()).toMatchObject({ printShrimpRefreshed: 1, etsyDispatchesUpdated: 1 });
    expect(mocks.refresh).toHaveBeenCalledWith(expect.any(Function));
  });
});
