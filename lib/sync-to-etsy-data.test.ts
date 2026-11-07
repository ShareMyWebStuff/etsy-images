import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ sections: vi.fn(), prices: vi.fn(), remoteSections: vi.fn() }));
vi.mock('@/lib/prisma', () => ({ prisma: {
  etsyShopSection: { findMany: mocks.sections },
  adminProductPrice: { findMany: mocks.prices },
} }));
vi.mock('@/lib/local-shop-sections', () => ({ getRemoteEtsySectionIds: mocks.remoteSections }));

import { getSyncToEtsyData } from '@/lib/sync-to-etsy';

beforeEach(() => {
  vi.resetAllMocks();
  mocks.sections.mockResolvedValue([{
    id: 14, title: 'Scarecrows',
    shop: { etsyShopId: 66615491n, shopName: 'Test Shop', title: 'Test Shop' },
    subSections: [],
  }]);
  mocks.prices.mockResolvedValue([]);
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
