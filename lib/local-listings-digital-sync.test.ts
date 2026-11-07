import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  shop: vi.fn(), section: vi.fn(), subSection: vi.fn(), listing: vi.fn(), reload: vi.fn(),
  query: vi.fn(), prices: vi.fn(), defaults: vi.fn(), ensureSection: vi.fn(),
}));
vi.mock('@/lib/prisma', () => ({ prisma: {
  etsyShop: { findUnique: mocks.shop }, etsyShopSection: { findFirst: mocks.section },
  etsyShopSubSection: { findFirst: mocks.subSection },
  etsyListing: { findFirst: mocks.listing, findUnique: mocks.reload },
  adminProductPrice: { findMany: mocks.prices }, $queryRaw: mocks.query,
} }));
vi.mock('@/lib/etsy-oauth', () => ({
  getEtsyKeystring: () => 'test-key', getValidEtsyAccessToken: async () => 'test-token',
}));
vi.mock('@/lib/local-shop-sections', () => ({ ensureRegisteredEtsySectionExists: mocks.ensureSection }));
vi.mock('@/lib/listing-products', async (importOriginal) => ({
  ...await importOriginal<typeof import('@/lib/listing-products')>(),
  ensureListingProductDefaults: mocks.defaults,
}));

import { syncListingToEtsy } from '@/lib/local-listings';

function digitalListing(downloadId: string | null = '555') {
  return {
    id: 79, localDirectoryName: 'Ant', shopId: '66615491', subSectionId: 3,
    title: 'Ant Print', description: 'Physical description', quantity: 999,
    digitalTitle: 'Ant Download', digitalDescription: 'Digital description', digitalQuantity: 25,
    etsyId: null, etsyCustomisedId: null, etsyDownloadId: downloadId,
    rawJson: null, tags: [], images: [],
    files: [{ id: 10, localFileName: 'Ant_DownloadInstructions.pdf', sizeBytes: 1000, rawJson: { kind: 'dropbox_instruction_pdf' } }],
    productConfig: { listOnEtsy: true, sku: 'DG-ANT', customisePrints: false },
    ourCategory: {
      printsFrames: false, customisePrints: false, digitalDownload: true,
      downloadSection: { id: 8, etsyShopSectionId: 60449656, title: 'Digital Downloads' },
      sizes: {}, frames: {},
    },
    products: [{ id: 20, productType: 'digital', productKey: 'digital', sku: 'DG-ANT', priceKey: 'digital_1' }],
  };
}

beforeEach(() => {
  vi.resetAllMocks();
  vi.stubEnv('ETSY_SHARED_SECRET', 'test-secret');
  mocks.shop.mockResolvedValue({ id: 1, etsyShopId: 66615491n, shopName: 'Test Shop' });
  mocks.section.mockResolvedValue({ id: 2, title: 'Bugs Wall Art', etsyShopSectionId: '123' });
  mocks.subSection.mockResolvedValue({ id: 3, name: 'SingleListings' });
  mocks.listing.mockResolvedValueOnce(digitalListing()).mockResolvedValue(null);
  mocks.reload.mockResolvedValue(digitalListing());
  mocks.query.mockResolvedValue([{ artworkOrientation: 'portrait' }]);
  mocks.prices.mockResolvedValue([{ productKey: 'digital_1', amountPence: 599 }]);
  mocks.ensureSection.mockResolvedValue(60449656);
});
afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs(); });

function mockEtsy(remoteType = 'physical', failReset = false) {
  const fetchMock = vi.fn(async (url: string, init: RequestInit) => {
    if (init.method === 'GET' && url.endsWith('/listings/555?legacy=false')) {
      return Response.json({ listing_type: remoteType });
    }
    if (init.method === 'GET' && url.includes('/inventory')) {
      return Response.json({ products: [{ offerings: [{ readiness_state_id: 67890 }] }, { offerings: [] }] });
    }
    if (init.method === 'PUT' && url.includes('/inventory')) {
      return failReset ? Response.json({ error: 'Inventory reset failed' }, { status: 400 }) : Response.json({
        products: [{ sku: 'DG-ANT', product_id: 10, offerings: [{ offering_id: 11 }] }],
      });
    }
    // End the test at the listing mutation. No images, files or live data are touched.
    return Response.json({ error: 'Stopped at listing mutation' }, { status: 400 });
  });
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

describe('digital Etsy conversion ordering', () => {
  it('refuses a digital sync when the listing has disabled downloads', async () => {
    const current = digitalListing();
    mocks.reload.mockResolvedValue({
      ...current,
      productConfig: { ...current.productConfig, digitalDownloadOverride: false },
    });
    const fetchMock = mockEtsy();
    await expect(syncListingToEtsy('66615491', '2', '3', '79', ['download'])).rejects.toThrow('before syncing');
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('resets physical variations before requesting the download type, retaining the processing profile', async () => {
    const fetchMock = mockEtsy();
    await expect(syncListingToEtsy('66615491', '2', '3', '79', ['download'])).rejects.toThrow('Stopped at listing mutation');
    expect(fetchMock.mock.calls.map(([, init]) => init.method)).toEqual(['GET', 'GET', 'PUT', 'PATCH']);
    const inventory = JSON.parse(fetchMock.mock.calls[2][1].body as string);
    expect(inventory.products).toEqual([{
      sku: 'DG-ANT', property_values: [],
      offerings: [{ price: 4.99, quantity: 25, is_enabled: true, readiness_state_id: 67890 }],
    }]);
    expect(inventory.price_on_property).toEqual([]);
    expect(inventory.quantity_on_property).toEqual([]);
    expect(inventory.sku_on_property).toEqual([]);
    expect(inventory.readiness_state_on_property).toEqual([]);
    expect((fetchMock.mock.calls[3][1].body as URLSearchParams).get('type')).toBe('download');
  });

  it('does not reset inventory before updating an existing digital listing', async () => {
    const fetchMock = mockEtsy('download');
    await expect(syncListingToEtsy('66615491', '2', '3', '79', ['download'])).rejects.toThrow('Stopped at listing mutation');
    expect(fetchMock.mock.calls.map(([, init]) => init.method)).toEqual(['GET', 'PATCH']);
  });

  it('does not request conversion when resetting inventory fails', async () => {
    const fetchMock = mockEtsy('physical', true);
    await expect(syncListingToEtsy('66615491', '2', '3', '79', ['download'])).rejects.toThrow('Inventory reset failed');
    expect(fetchMock.mock.calls.map(([, init]) => init.method)).toEqual(['GET', 'GET', 'PUT']);
  });

  it('protects a remote ID linked to a physical print listing', async () => {
    mocks.listing.mockReset().mockResolvedValueOnce(digitalListing()).mockResolvedValue({ id: 101 });
    const fetchMock = mockEtsy();
    await expect(syncListingToEtsy('66615491', '2', '3', '79', ['download'])).rejects.toThrow('also linked to a physical print listing');
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('creates a new digital draft without trying to reset nonexistent inventory', async () => {
    mocks.listing.mockReset().mockResolvedValueOnce(digitalListing(null));
    mocks.reload.mockResolvedValue(digitalListing(null));
    const fetchMock = mockEtsy();
    await expect(syncListingToEtsy('66615491', '2', '3', '79', ['download'])).rejects.toThrow('Stopped at listing mutation');
    expect(fetchMock.mock.calls.map(([, init]) => init.method)).toEqual(['POST']);
  });
});
