import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  shop: vi.fn(), section: vi.fn(), subSection: vi.fn(), listing: vi.fn(), reload: vi.fn(), update: vi.fn(),
  prices: vi.fn(), query: vi.fn(), defaults: vi.fn(), ensureSection: vi.fn(), transaction: vi.fn(),
  write: vi.fn().mockResolvedValue({}),
}));
vi.mock('@/lib/prisma', () => ({ prisma: {
  etsyShop: { findUnique: mocks.shop }, etsyShopSection: { findFirst: mocks.section },
  etsyShopSubSection: { findFirst: mocks.subSection },
  etsyListing: { findFirst: mocks.listing, findUnique: mocks.reload, update: mocks.update },
  adminProductPrice: { findMany: mocks.prices }, $queryRaw: mocks.query, $transaction: mocks.transaction,
  etsyListingFile: { updateMany: mocks.write, update: mocks.write }, etsyListingZip: { updateMany: mocks.write },
} }));
vi.mock('@/lib/etsy-oauth', () => ({
  getEtsyKeystring: () => 'test-key', getValidEtsyAccessToken: async () => 'test-token',
}));
vi.mock('@/lib/local-shop-sections', () => ({ ensureRegisteredEtsySectionExists: mocks.ensureSection }));
vi.mock('@/lib/listing-products', async (original) => ({
  ...await original<typeof import('@/lib/listing-products')>(), ensureListingProductDefaults: mocks.defaults,
}));
vi.mock('@/lib/etsy-physical-attributes', () => ({
  derivePhysicalAttributeLabels: () => ({}), syncEtsyPhysicalListingAttributes: vi.fn(),
}));

import { syncListingToEtsy } from '@/lib/local-listings';

function listing(variant: 'print' | 'download') {
  const digital = variant === 'download';
  return {
    id: 52, localDirectoryName: 'Styracosaurus', shopId: '66615491', subSectionId: 3,
    title: 'Styracosaurus Print', description: 'Print description', quantity: 999,
    digitalTitle: 'Styracosaurus Download', digitalDescription: 'Download description', digitalQuantity: 50,
    numberOfItems: 1, includeAllItems: false, etsyProductType: digital ? 'digital' : 'physical',
    etsyId: digital ? null : '4601679090', etsyCustomisedId: null, etsyDownloadId: digital ? '4542046447' : null,
    state: 'inactive', primaryColour: null, secondaryColour: null,
    rawJson: { listing_type: 'physical', shipping_profile_id: 5555, readiness_state_id: 67890, return_policy_id: 7777 },
    lastSyncedAt: null, etsyCustomisedLastSyncedAt: null, etsyDownloadLastSyncedAt: null,
    lastLocalChangeAt: new Date('2026-11-01'), tags: [], priceMappings: [],
    productConfig: { listOnEtsy: true, sku: 'SKU_000042', customisePrints: false },
    ourCategory: {
      printsFrames: !digital, customisePrints: false, digitalDownload: digital,
      printFrameSection: { id: 8, etsyShopSectionId: 123, title: 'Prints' },
      downloadSection: { id: 9, etsyShopSectionId: 456, title: 'Downloads' },
      sizes: { a4: true }, frames: { no_frame: true },
    },
    products: [{
      id: 20, productType: digital ? 'digital' : 'physical', productKey: digital ? 'digital' : 'unframed_a4',
      sizeKey: digital ? null : 'a4', frameKey: digital ? null : 'no_frame',
      sku: 'SKU_000042', priceKey: digital ? 'digital_1' : 'unframed_a4',
    }],
    images: [{
      id: 1, localFileName: 'image.jpg', originalFileName: 'image.jpg', rank: 1,
      etsyImageId: '88', etsyDownloadImageId: '88', etsyCustomisedImageId: null,
    }],
    files: digital ? [{
      id: 10, localFileName: 'DownloadInstructions.pdf', originalFileName: 'DownloadInstructions.pdf',
      sizeBytes: 1000, rank: 1, etsyListingFileId: '99', rawJson: { kind: 'dropbox_instruction_pdf' },
    }] : [],
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubEnv('ETSY_SHARED_SECRET', 'test-secret');
  mocks.shop.mockResolvedValue({ id: 1, etsyShopId: 66615491n, shopName: 'Test Shop' });
  mocks.section.mockResolvedValue({ id: 2, title: 'Dinosaur Wall Art', etsyShopSectionId: '123' });
  mocks.subSection.mockResolvedValue({ id: 3, name: 'SingleListings' });
  mocks.prices.mockResolvedValue([{ productKey: 'unframed_a4', amountPence: 1099 }, { productKey: 'digital_1', amountPence: 599 }]);
  mocks.query.mockResolvedValue([{ artworkOrientation: 'portrait' }]);
  mocks.ensureSection.mockImplementation(async (_shopId, sectionId) => sectionId === 8 ? 123 : 456);
  mocks.transaction.mockImplementation(async (operation) => Array.isArray(operation) ? Promise.all(operation) : operation({
    etsyListingProduct: { updateMany: mocks.write, update: mocks.write },
    etsyListingPriceMapping: { deleteMany: mocks.write, createMany: mocks.write, create: mocks.write },
  }));
});
afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs(); });

function mockEtsy(variant: 'print' | 'download', options: {
  repeatQuantityError?: boolean;
  inventoryError?: boolean;
  unrelatedError?: boolean;
  quantityError?: string;
  escapeSlashes?: boolean;
  quantityErrorStatus?: number;
} = {}) {
  let metadataCalls = 0;
  const fetchMock = vi.fn(async (url: string, init: RequestInit) => {
    if (init.method === 'PATCH' || init.method === 'POST') {
      metadataCalls += 1;
      if (options.unrelatedError) return Response.json({ error: 'Invalid taxonomy' }, { status: 400 });
      if (metadataCalls === 1 || options.repeatQuantityError) {
        const responseBody = JSON.stringify({ error: options.quantityError ?? 'There was a problem with Vquantity : All quantities are zero' });
        return new Response(options.escapeSlashes ? responseBody.replaceAll('/', '\\/') : responseBody, {
          status: options.quantityErrorStatus ?? 400, statusText: 'Bad Request', headers: { 'Content-Type': 'application/json' },
        });
      }
      return Response.json({ listing_id: variant === 'print' ? 4601679090 : 4542046447, state: 'inactive' });
    }
    if (init.method === 'PUT' && url.includes('/inventory')) {
      if (options.inventoryError) return Response.json({ error: 'Inventory rejected' }, { status: 400 });
      const body = JSON.parse(String(init.body));
      return Response.json({ products: body.products.map((product: Record<string, unknown> & { offerings: Record<string, unknown>[] }, index: number) => ({
        ...product, product_id: 100 + index,
        offerings: product.offerings.map((offering) => ({ ...offering, offering_id: 200 + index })),
      })) });
    }
    if (url.endsWith('/images')) return Response.json({ results: [{ listing_image_id: 88, rank: 1 }] });
    if (url.endsWith('/personalization')) return Response.json({ personalization_questions: [] });
    if (url.endsWith('/files')) return Response.json({ results: variant === 'download'
      ? [{ listing_file_id: 99, rank: 1, filename: 'DownloadInstructions.pdf' }] : [] });
    if (init.method === 'GET' && /\/listings\/\d+\?legacy=false$/.test(url)) {
      return Response.json({ listing_type: variant === 'print' ? 'physical' : 'download', state: 'inactive' });
    }
    throw new Error(`Unexpected request: ${init.method} ${url}`);
  });
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

describe('recovering zero variation quantities during Etsy sync', () => {
  it.each(['print', 'download'] as const)('sends a valid %s title for existing listings with repeated ampersands', async (variant) => {
    const current = listing(variant);
    current.title = 'Mr & Mrs Scarecrow Print | Unframed & Framed Options';
    current.digitalTitle = 'Mr & Mrs Scarecrow Printable | Nursery & Playroom';
    mocks.listing.mockResolvedValueOnce(current).mockResolvedValue(null);
    mocks.reload.mockResolvedValue(current);
    const fetchMock = mockEtsy(variant);
    await syncListingToEtsy('66615491', '2', '3', '52', [variant]);
    const metadata = fetchMock.mock.calls.filter(([, init]) => init.method === 'PATCH');
    expect(metadata).toHaveLength(2);
    for (const [, init] of metadata) {
      const body = init.body as URLSearchParams;
      expect(body.get('title')).toBe(variant === 'print'
        ? 'Mr & Mrs Scarecrow Print | Unframed and Framed Options'
        : 'Mr & Mrs Scarecrow Printable | Nursery and Playroom');
      expect(body.get('description')).toBe(variant === 'print' ? current.description : current.digitalDescription);
    }
  });

  it.each((['print', 'download'] as const).flatMap((variant) => [
    { variant, quantityError: 'There was a problem with Vquantity : All quantities are zero', escapeSlashes: false },
    { variant, quantityError: 'There was a problem with /quantity : All quantities are zero', escapeSlashes: false },
    { variant, quantityError: 'There was a problem with /quantity : All quantities are zero', escapeSlashes: true },
    { variant, quantityError: 'All quantities are zero', escapeSlashes: false },
  ]))('restores $variant inventory for "$quantityError" (escaped slashes: $escapeSlashes) without repeating inventory updates', async ({ variant, ...options }) => {
    const current = listing(variant);
    mocks.listing.mockResolvedValueOnce(current).mockResolvedValue(null);
    mocks.reload.mockResolvedValue(current);
    const fetchMock = mockEtsy(variant, options);
    await syncListingToEtsy('66615491', '2', '3', '52', [variant]);
    const writes = fetchMock.mock.calls.filter(([, init]) => init.method !== 'GET');
    expect(writes.map(([, init]) => init.method)).toEqual(['PATCH', 'PUT', 'PATCH']);
    expect(writes[0][0]).toBe(writes[2][0]);
    expect(writes[0][1].body).toBe(writes[2][1].body);
    const inventory = JSON.parse(String(writes[1][1].body));
    expect(inventory.products.every((product: { offerings: Array<{ quantity: number; is_enabled: boolean }> }) =>
      product.offerings.every((offering) => offering.quantity === (variant === 'print' ? 999 : 50) && offering.is_enabled))).toBe(true);
    expect((writes[2][1].body as URLSearchParams).has('state')).toBe(false);
    expect(mocks.update).toHaveBeenLastCalledWith(expect.objectContaining({ data: expect.objectContaining({ productsChanged: false }) }));
  });

  it.each([
    { repeatQuantityError: true, expected: 'All quantities are zero', writes: ['PATCH', 'PUT', 'PATCH'] },
    { inventoryError: true, expected: 'Inventory rejected', writes: ['PATCH', 'PUT'] },
    { unrelatedError: true, expected: 'Invalid taxonomy', writes: ['PATCH'] },
    { quantityError: 'The quantity must be positive', expected: 'quantity must be positive', writes: ['PATCH'] },
    { quantityErrorStatus: 500, expected: 'All quantities are zero', writes: ['PATCH'] },
  ])('leaves sync pending if recovery fails: $expected', async (options) => {
    const current = listing('print');
    mocks.listing.mockResolvedValue(current);
    mocks.reload.mockResolvedValue(current);
    const fetchMock = mockEtsy('print', options);
    await expect(syncListingToEtsy('66615491', '2', '3', '52', ['print'])).rejects.toThrow(options.expected);
    expect(fetchMock.mock.calls.filter(([, init]) => init.method !== 'GET').map(([, init]) => init.method)).toEqual(options.writes);
    expect(mocks.update).not.toHaveBeenCalled();
  });

  it('does not retry creating a new listing when Etsy rejects its initial quantity', async () => {
    const current = { ...listing('print'), etsyId: null };
    mocks.listing.mockResolvedValue(current);
    mocks.reload.mockResolvedValue(current);
    const fetchMock = mockEtsy('print');
    await expect(syncListingToEtsy('66615491', '2', '3', '52', ['print'])).rejects.toThrow('All quantities are zero');
    expect(fetchMock.mock.calls.map(([, init]) => init.method)).toEqual(['POST']);
  });
});
