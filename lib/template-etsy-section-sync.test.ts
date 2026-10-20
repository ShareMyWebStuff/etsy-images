import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  shopFindUnique: vi.fn(),
  queryRaw: vi.fn(),
  sectionFindUnique: vi.fn(),
  sectionUpdate: vi.fn(),
}));

vi.mock('@/lib/prisma', () => ({
  prisma: {
    etsyShop: { findUnique: mocks.shopFindUnique },
    etsyDownloadSection: {
      findUnique: mocks.sectionFindUnique,
      update: mocks.sectionUpdate,
    },
    $queryRaw: mocks.queryRaw,
  },
}));

vi.mock('@/lib/etsy-oauth', () => ({
  getEtsyKeystring: () => 'keystring',
  getValidEtsyAccessToken: async () => 'access-token',
}));

import { ensureRegisteredEtsySectionExists } from '@/lib/local-shop-sections';

describe('template Etsy category syncing', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.ETSY_SHARED_SECRET = 'shared-secret';
    mocks.shopFindUnique.mockResolvedValue({
      id: 1,
      etsyShopId: BigInt(66615491),
      shopName: 'Test Shop',
      title: 'Test Shop',
    });
    mocks.queryRaw.mockResolvedValue([{
      id: 12,
      etsyShopSectionId: 123,
      title: 'Kids & Nursery Prints',
      useForPrintFrames: true,
      useForCustomisedPrints: false,
      useForDigitalDownloads: false,
    }]);
    mocks.sectionFindUnique.mockResolvedValue(null);
    mocks.sectionUpdate.mockResolvedValue({});
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    delete process.env.ETSY_SHARED_SECRET;
  });

  it('creates a template category when it is missing from Etsy', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ results: [] }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({
        shop_section_id: 456,
        title: 'Kids & Nursery Prints',
      }), { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);

    await expect(ensureRegisteredEtsySectionExists('66615491', 12)).resolves.toBe(456);
    expect(fetchMock).toHaveBeenNthCalledWith(
      2,
      'https://openapi.etsy.com/v3/application/shops/66615491/sections',
      expect.objectContaining({ method: 'POST' }),
    );
    expect(mocks.sectionUpdate).toHaveBeenCalledWith({
      where: { id: 12 },
      data: { etsyShopSectionId: 456, title: 'Kids & Nursery Prints' },
    });
  });

  it('relinks the template category when Etsy already has the same name', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify({
      results: [{ shop_section_id: 789, title: 'Kids & Nursery Prints' }],
    }), { status: 200 })));

    await expect(ensureRegisteredEtsySectionExists('66615491', 12)).resolves.toBe(789);
    expect(mocks.sectionUpdate).toHaveBeenCalledWith({
      where: { id: 12 },
      data: { etsyShopSectionId: 789, title: 'Kids & Nursery Prints' },
    });
  });
});
