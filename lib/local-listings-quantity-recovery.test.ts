import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  shop: vi.fn(), section: vi.fn(), subSection: vi.fn(), listing: vi.fn(), reload: vi.fn(), update: vi.fn(),
  prices: vi.fn(), query: vi.fn(), defaults: vi.fn(), ensureSection: vi.fn(), transaction: vi.fn(),
  write: vi.fn().mockResolvedValue({}),
  delivery: vi.fn(), deliverySynced: vi.fn(), deliveryMetadata: vi.fn(),
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
vi.mock('@/lib/markets-delivery', () => ({
  getEffectiveListingDelivery: mocks.delivery, markDeliveryAssignmentSynced: mocks.deliverySynced,
  recordDeliveryAssignmentMetadata: mocks.deliveryMetadata,
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
  mocks.delivery.mockResolvedValue({
    profileId: null, shippingProfileId: null, readinessStateId: null, includeDeliveryInformation: false,
    deliveryInformation: '', usesManagedProfile: false, inherited: true, pending: false,
    profileRevision: null, profileSyncStatus: null,
  });
  mocks.deliverySynced.mockResolvedValue(undefined);
  mocks.deliveryMetadata.mockResolvedValue(undefined);
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
  skipQuantityError?: boolean;
} = {}) {
  let metadataCalls = 0;
  const fetchMock = vi.fn(async (url: string, init: RequestInit) => {
    if (init.method === 'PATCH' || init.method === 'POST') {
      metadataCalls += 1;
      if (options.unrelatedError) return Response.json({ error: 'Invalid taxonomy' }, { status: 400 });
      if ((metadataCalls === 1 && !options.skipQuantityError) || options.repeatQuantityError) {
        const responseBody = JSON.stringify({ error: options.quantityError ?? 'There was a problem with Vquantity : All quantities are zero' });
        return new Response(options.escapeSlashes ? responseBody.replaceAll('/', '\\/') : responseBody, {
          status: options.quantityErrorStatus ?? 400, statusText: 'Bad Request', headers: { 'Content-Type': 'application/json' },
        });
      }
      const requestedId = /\/listings\/(\d+)/.exec(url)?.[1];
      return Response.json({ listing_id: Number(requestedId ?? (variant === 'print' ? '4601679090' : '4542046447')), state: 'inactive' });
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
  it('resolves a new listing’s shop fallback profile and wording before its first Etsy upload', async () => {
    vi.stubEnv('ETSY_SHIPPING_PROFILE_ID', '8888');
    const saved = listing('print');
    const current = { ...saved, etsyId: null, rawJson: { listing_type: 'physical', readiness_state_id: 67890, return_policy_id: 7777 } };
    mocks.listing.mockResolvedValue(current); mocks.reload.mockResolvedValue(current);
    const unmanaged = { profileId: null, shippingProfileId: null, readinessStateId: null, includeDeliveryInformation: false,
      deliveryInformation: '', usesManagedProfile: false, inherited: true, pending: false, profileRevision: null, profileSyncStatus: null };
    const managed = { ...unmanaged, profileId: '1', shippingProfileId: '8888', readinessStateId: '67891', includeDeliveryInformation: true,
      deliveryInformation: 'Shared delivery wording', usesManagedProfile: true, pending: true, profileRevision: 2, profileSyncStatus: 'SYNCED' };
    mocks.delivery.mockImplementation(async (_context, _variant, resolved) => resolved?.shippingProfileId === '8888' ? managed : unmanaged);
    const fetchMock = mockEtsy('print', { skipQuantityError: true });
    await syncListingToEtsy('66615491', '2', '3', '52', ['print']);
    const metadata = fetchMock.mock.calls.filter(([, init]) => init.method === 'POST' || init.method === 'PATCH');
    expect(metadata).toHaveLength(1);
    expect(metadata[0][1].method).toBe('POST');
    const body = metadata[0][1].body as URLSearchParams;
    expect(body.get('shipping_profile_id')).toBe('8888');
    expect(body.get('readiness_state_id')).toBe('67891');
    expect(body.get('description')).toBe('Print description\n\nDelivery\nShared delivery wording');
    expect(mocks.deliveryMetadata).toHaveBeenCalledWith(expect.anything(), 'print', '4601679090', expect.objectContaining({ expected: managed }));
    expect(mocks.deliverySynced).toHaveBeenCalledWith(expect.anything(), 'print', '4601679090', expect.objectContaining({ expected: managed }));
    const persistedIdIndex = mocks.update.mock.calls.findIndex(([call]) => call.data.etsyId === '4601679090');
    expect(persistedIdIndex).toBeGreaterThanOrEqual(0);
    expect(mocks.update.mock.invocationCallOrder[persistedIdIndex]).toBeLessThan(mocks.deliveryMetadata.mock.invocationCallOrder[0]);
  });

  it.each(['metadata', 'verification'] as const)('does not mark delivery synced if Etsy returns another profile during %s', async (stage) => {
    const current = listing('print');
    mocks.listing.mockResolvedValue(current); mocks.reload.mockResolvedValue(current);
    const fetchMock = mockEtsy('print', { skipQuantityError: true });
    const original = fetchMock.getMockImplementation()!;
    fetchMock.mockImplementation(async (url, init) => {
      const response = await original(url, init);
      if ((stage === 'metadata' && init.method === 'PATCH')
        || (stage === 'verification' && init.method === 'GET' && /\/listings\/\d+\?legacy=false$/.test(url))) {
        return Response.json({ ...await response.json(), shipping_profile_id: 9999 });
      }
      return response;
    });
    await expect(syncListingToEtsy('66615491', '2', '3', '52', ['print'])).rejects.toThrow('different delivery profile than requested');
    expect(mocks.deliverySynced).not.toHaveBeenCalled();
    expect(mocks.update).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ etsyId: '4601679090' }) }));
  });

  it('assigns different profiles and wording to the actual print and customised Etsy listing IDs', async () => {
    const saved = listing('print');
    const current = {
      ...saved, etsyCustomisedId: '4601679091', etsyCustomisedRawJson: saved.rawJson,
      productConfig: { ...saved.productConfig, customisePrints: true, customTop: true, customBottom: false },
      ourCategory: { ...saved.ourCategory, customisePrints: true, customTop: true, customBottom: false,
        customisedSection: { id: 10, etsyShopSectionId: 456, title: 'Customised prints' } },
      images: saved.images.map((image) => ({ ...image, etsyCustomisedImageId: '88' })),
    };
    mocks.listing.mockResolvedValue(current); mocks.reload.mockResolvedValue(current);
    mocks.delivery.mockImplementation(async (_context, variant) => ({
      profileId: variant === 'print' ? 'local-print' : 'local-custom',
      shippingProfileId: variant === 'print' ? '8888' : '9999', readinessStateId: '67890',
      includeDeliveryInformation: true, deliveryInformation: variant === 'print' ? 'Print delivery wording' : 'Custom delivery wording',
      usesManagedProfile: true, inherited: false, pending: true, profileRevision: 1, profileSyncStatus: 'SYNCED',
    }));
    const fetchMock = mockEtsy('print');
    await syncListingToEtsy('66615491', '2', '3', '52', ['print', 'customised']);
    const metadata = fetchMock.mock.calls.filter(([url, init]) => init.method === 'PATCH' && url.includes('/listings/'));
    expect(metadata.map(([url, init]) => [url.match(/\/listings\/(\d+)/)?.[1], (init.body as URLSearchParams).get('shipping_profile_id')]))
      .toEqual([['4601679090', '8888'], ['4601679090', '8888'], ['4601679091', '9999']]);
    expect((metadata[0][1].body as URLSearchParams).get('description')).toBe('Print description\n\nDelivery\nPrint delivery wording');
    expect((metadata[2][1].body as URLSearchParams).get('description')).toBe('Print description\n\nDelivery\nCustom delivery wording');
    expect(current.description).toBe('Print description');
    expect(mocks.deliverySynced).toHaveBeenCalledWith(expect.anything(), 'print', '4601679090', {
      baseDescription: 'Print description', managedDescription: 'Print description\n\nDelivery\nPrint delivery wording',
      expected: expect.objectContaining({ profileId: 'local-print', shippingProfileId: '8888' }),
    });
    expect(mocks.deliverySynced).toHaveBeenCalledWith(expect.anything(), 'customised', '4601679091', expect.anything());
  });

  it('does not resolve or assign physical profiles or wording for digital Etsy products', async () => {
    const current = listing('download');
    mocks.listing.mockResolvedValueOnce(current).mockResolvedValue(null); mocks.reload.mockResolvedValue(current);
    const fetchMock = mockEtsy('download');
    await syncListingToEtsy('66615491', '2', '3', '52', ['download']);
    expect(mocks.delivery).not.toHaveBeenCalled();
    expect(mocks.deliverySynced).not.toHaveBeenCalled();
    for (const [, init] of fetchMock.mock.calls.filter(([, init]) => init.method === 'PATCH')) {
      const body = init.body as URLSearchParams;
      expect(body.has('shipping_profile_id')).toBe(false);
      expect(body.has('readiness_state_id')).toBe(false);
      expect(body.get('description')).toBe('Download description');
    }
  });

  it('requires a selected local delivery profile to be synced before any Etsy mutation', async () => {
    const current = { ...listing('print'), etsyId: null };
    mocks.listing.mockResolvedValue(current); mocks.reload.mockResolvedValue(current);
    mocks.delivery.mockResolvedValue({ profileId: 'new', usesManagedProfile: true, shippingProfileId: null, profileSyncStatus: 'LOCAL_ONLY' });
    const fetchMock = mockEtsy('print');
    await expect(syncListingToEtsy('66615491', '2', '3', '52', ['print'])).rejects.toThrow('delivery profile to Etsy');
    expect(fetchMock).not.toHaveBeenCalled();
    expect(mocks.deliverySynced).not.toHaveBeenCalled();
  });

  it('blocks a description conflict until the user explicitly reviews replacing the Etsy text', async () => {
    const current = { ...listing('print'), etsyId: null };
    mocks.listing.mockResolvedValue(current); mocks.reload.mockResolvedValue(current);
    mocks.delivery.mockResolvedValue({ descriptionConflict: 'Review the changed Etsy description before syncing.' });
    const fetchMock = mockEtsy('print');
    await expect(syncListingToEtsy('66615491', '2', '3', '52', ['print'])).rejects.toThrow('Review the changed Etsy description');
    expect(fetchMock).not.toHaveBeenCalled();
    expect(mocks.deliveryMetadata).not.toHaveBeenCalled();
  });

  it('records successful metadata while keeping delivery pending when a later inventory update fails', async () => {
    const current = listing('print');
    mocks.listing.mockResolvedValue(current); mocks.reload.mockResolvedValue(current);
    mockEtsy('print', { skipQuantityError: true, inventoryError: true });
    await expect(syncListingToEtsy('66615491', '2', '3', '52', ['print'])).rejects.toThrow('Inventory rejected');
    expect(mocks.deliveryMetadata).toHaveBeenCalledWith(expect.anything(), 'print', '4601679090', {
      baseDescription: 'Print description', managedDescription: 'Print description',
      expected: expect.objectContaining({ usesManagedProfile: false }),
    });
    expect(mocks.deliverySynced).not.toHaveBeenCalled();
  });

  it('does not overwrite a profile changed locally while preparing the listing update', async () => {
    const current = { ...listing('print'), etsyId: null };
    mocks.listing.mockResolvedValue(current); mocks.reload.mockResolvedValue(current);
    const delivery = { profileId: 'local', usesManagedProfile: true, shippingProfileId: '8888', readinessStateId: '67890',
      profileSyncStatus: 'SYNCED', profileRevision: 1, includeDeliveryInformation: false, deliveryInformation: '' };
    mocks.delivery.mockResolvedValueOnce(delivery).mockResolvedValueOnce(delivery)
      .mockResolvedValue({ ...delivery, profileSyncStatus: 'PENDING', profileRevision: 2 });
    const fetchMock = mockEtsy('print');
    await expect(syncListingToEtsy('66615491', '2', '3', '52', ['print'])).rejects.toThrow('Delivery settings changed');
    expect(fetchMock).not.toHaveBeenCalled();
    expect(mocks.deliveryMetadata).not.toHaveBeenCalled();
  });

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
