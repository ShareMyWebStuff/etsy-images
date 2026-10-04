import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  findMany: vi.fn(),
  findUnique: vi.fn(),
  getDropboxFileUrl: vi.fn(),
  createDropbox: vi.fn(),
  isDropboxPathNotFound: vi.fn((error: unknown) => error instanceof Error && error.message === 'path/not_found'),
}));

vi.mock('@/lib/prisma', () => ({
  prisma: {
    etsyListing: {
      findMany: mocks.findMany,
      findUnique: mocks.findUnique,
    },
  },
}));

vi.mock('@/lib/dropbox-bundle', () => ({
  getOrCreateDropboxFileUrl: mocks.getDropboxFileUrl,
  createOrUpdateDropbox: mocks.createDropbox,
  isDropboxPathNotFoundError: mocks.isDropboxPathNotFound,
}));

import {
  createPrintShrimpOrderPreview,
  generatePrintShrimpCustomArtworkPreview,
  getPrintShrimpOrderArtworkUrl,
  getPrintShrimpOrdersPageData,
  retrievePrintShrimpOrders,
  submitPrintShrimpOrder,
  type PrintShrimpOrderPreviewInput,
} from '@/lib/printshrimp/orders';

function a1File() {
  return {
    id: 1,
    localFileName: 'file_1.png',
    originalFileName: 'Green_Turtle_ISO_A1.png',
    widthPixels: 7016,
    heightPixels: 9933,
    rawJson: { printableDownloadRole: 'iso-a1' },
  };
}

function previewInput(overrides: Partial<PrintShrimpOrderPreviewInput> = {}): PrintShrimpOrderPreviewInput {
  return {
    listingId: '339',
    size: 'A4',
    productType: 'Print',
    paperType: 'Matte',
    frameColour: 'Black',
    fontId: 'nunito-semibold',
    topText: '',
    bottomText: '',
    externalOrderNumber: 'ORD-123',
    giftMessage: 'Happy birthday',
    name: 'Dave F',
    email: 'dave@harmonydata.co.uk',
    address1: 'The Farmhouse',
    address2: '',
    city: 'London',
    state: 'London',
    zip: 'SW1A 1AA',
    country: 'GB',
    phone: '+447973631381',
    shipping: 'standard',
    ...overrides,
  };
}

function previewListing() {
  return {
    title: 'Green Sea Turtle',
    localDirectoryName: 'Green-Sea-Turtle',
    productConfig: { sku: 'SEA_CREATURES_GREEN_SEA_TURTLE' },
    subSection: {
      name: 'Turtles',
      shopSection: {
        title: 'Sea Creatures Wall Art Listings',
        shop: { etsyShopId: BigInt(66615491), shopName: 'Cosy House', title: null },
      },
    },
    files: [a1File()],
  };
}

beforeEach(() => {
  mocks.findMany.mockReset();
  mocks.findUnique.mockReset();
  mocks.getDropboxFileUrl.mockReset();
  mocks.createDropbox.mockReset();
  mocks.isDropboxPathNotFound.mockClear();
  vi.stubEnv('PRINTSHRIMP_API_KEY', 'test-api-key');
  vi.stubEnv('PRINTSHRIMP_API_TIMEOUT_MS', '5000');
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

describe('PrintShrimp orders', () => {
  it('retrieves every page of paid orders using the API key header', async () => {
    const firstPageOrders = Array.from({ length: 25 }, (_, index) => ({
      order_id: `order-${index + 1}`,
      external_order_number: `ORD-${index + 1}`,
      status: 'Paid',
      paid: true,
    }));
    const fetchMock = vi.fn(async (input: string | URL | Request, _init?: RequestInit) => {
      const page = new URL(String(input)).searchParams.get('page');
      return new Response(JSON.stringify({
        success: true,
        orders: page === '1' ? firstPageOrders : [{ order_id: 'order-26', external_order_number: 'ORD-26', paid: true }],
        page: Number(page),
        total_orders: 26,
      }), { status: 200, headers: { 'Content-Type': 'application/json' } });
    });
    vi.stubGlobal('fetch', fetchMock);

    const result = await retrievePrintShrimpOrders();

    expect(result.orders).toHaveLength(26);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(String(fetchMock.mock.calls[0][0])).toBe('https://api.printshrimp.com/functions/v1/api-get-order?page=1');
    expect(fetchMock.mock.calls[0][1]?.headers).toMatchObject({ 'x-api-key': 'test-api-key' });
  });

  it('submits the prepared order payload to the PrintShrimp create-order endpoint', async () => {
    mocks.findUnique.mockResolvedValue(previewListing());
    const fetchMock = vi.fn(async (_input: string | URL | Request, _init?: RequestInit) => new Response(JSON.stringify({
      success: true,
      order: {
        order_id: 'printshrimp-order-1',
        external_order_number: 'ORD-123',
        status: 'Pending',
        paid: false,
      },
    }), { status: 201, headers: { 'Content-Type': 'application/json' } }));

    const result = await submitPrintShrimpOrder(previewInput(), { fetch: fetchMock });

    expect(fetchMock).toHaveBeenCalledOnce();
    expect(String(fetchMock.mock.calls[0][0])).toBe('https://api.printshrimp.com/functions/v1/api-create-order');
    expect(fetchMock.mock.calls[0][1]).toMatchObject({
      method: 'POST',
      headers: expect.objectContaining({
        'Content-Type': 'application/json',
        'x-api-key': 'test-api-key',
      }),
      cache: 'no-store',
    });
    expect(JSON.parse(String(fetchMock.mock.calls[0][1]?.body))).toMatchObject({
      external_order_number: 'ORD-123',
      customerInfo: { city: 'London', state: 'London', zip: 'SW1A 1AA' },
      products: [{
        sku: 'SEA_CREATURES_GREEN_SEA_TURTLE',
        size: 'A4',
        type: 'Print',
        paper_type: 'Matte',
      }],
    });
    expect(result.order).toMatchObject({ order_id: 'printshrimp-order-1', status: 'Pending' });
    expect(result.response).toMatchObject({
      success: true,
      order: { order_id: 'printshrimp-order-1', status: 'Pending' },
    });
  });

  it('retains the prepared payload when PrintShrimp rejects the order', async () => {
    mocks.findUnique.mockResolvedValue(previewListing());
    const fetchMock = vi.fn(async (_input: string | URL | Request, _init?: RequestInit) => new Response(JSON.stringify({
      success: false,
      error: 'Product 1: unsupported artwork response.',
    }), { status: 400, headers: { 'Content-Type': 'application/json' } }));

    await expect(submitPrintShrimpOrder(previewInput(), { fetch: fetchMock })).rejects.toMatchObject({
      httpStatus: 400,
      response: {
        success: false,
        error: 'Product 1: unsupported artwork response.',
      },
      prepared: {
        custom: false,
        payload: {
          products: [{
            sku: 'SEA_CREATURES_GREEN_SEA_TURTLE',
            size: 'A4',
            type: 'Print',
            paper_type: 'Matte',
          }],
        },
      },
    });
  });

  it('provides order products only with their recognised Dropbox artwork sizes', async () => {
    mocks.findMany.mockResolvedValue([{
      id: 339,
      title: 'Green Sea Turtle',
      localDirectoryName: 'Green-Sea-Turtle',
      downloadsRevision: 8,
      dropboxRevision: 8,
      dropboxSyncedAt: new Date(),
      productConfig: { sku: 'SEA_CREATURES_GREEN_SEA_TURTLE' },
      dropboxBundle: { sharedUrl: 'https://www.dropbox.com/folder' },
      subSection: { shopSection: { id: 10, title: 'Sea Creatures Wall Art Listings' } },
      files: [a1File()],
    }]);

    const result = await getPrintShrimpOrdersPageData();

    expect(result.products).toEqual([expect.objectContaining({
      listingId: '339',
      sectionId: '10',
      sectionName: 'Sea Creatures Wall Art Listings',
      ready: true,
      availableSizes: ['A5', 'A4', 'A3', 'A2', 'A1'],
      artworkFileNames: {
        A1: 'Green_Turtle_ISO_A1.png',
        A2: 'Green_Turtle_ISO_A1.png',
        A3: 'Green_Turtle_ISO_A1.png',
        A4: 'Green_Turtle_ISO_A1.png',
        A5: 'Green_Turtle_ISO_A1.png',
      },
    })]);
  });

  it('builds a standard SKU-mode product without reading or uploading artwork', async () => {
    mocks.findUnique.mockResolvedValue(previewListing());
    const readStorage = vi.fn();

    const result = await createPrintShrimpOrderPreview(previewInput(), { readStorageFile: readStorage });

    expect(result.custom).toBe(false);
    expect(result.folderUrl).toBeNull();
    expect(result.payload.products).toEqual([{
      sku: 'SEA_CREATURES_GREEN_SEA_TURTLE',
      size: 'A4',
      type: 'Print',
      paper_type: 'Matte',
    }]);
    expect(readStorage).not.toHaveBeenCalled();
  });

  it('personalises the matching ratio file without uploading it to Dropbox', async () => {
    mocks.findUnique.mockResolvedValue(previewListing());
    const readStorage = vi.fn().mockResolvedValue(Buffer.from('source'));
    const readFont = vi.fn().mockResolvedValue(Buffer.from('font'));
    const personalise = vi.fn().mockResolvedValue({
      buffer: Buffer.from('personalised'),
      width: 7016,
      height: 9933,
      density: 300,
      fontSize: 200,
      textColour: '#334433',
      headerText: "Cameron's room",
      footerText: '',
    });
    const convert = vi.fn().mockResolvedValue({
      jpeg: Buffer.from('jpeg'),
      width: 7016,
      height: 9933,
      density: 300,
    });
    const result = await createPrintShrimpOrderPreview(
      previewInput({ topText: "Cameron's room" }),
      { readStorageFile: readStorage, readFont, personalise, convert },
    );

    expect(readStorage).toHaveBeenCalledWith(expect.stringMatching(/[\\/]downloads[\\/]file_1\.png$/));
    expect(personalise).toHaveBeenCalledWith(
      Buffer.from('source'),
      Buffer.from('font'),
      { headerText: "Cameron's room", footerText: '', textTransform: 'NONE' },
      {
        width: 7016,
        height: 9933,
        density: 300,
        requireSourceAlpha: false,
        fontFamily: 'Nunito',
        fontWeight: 600,
      },
    );
    expect(convert).toHaveBeenCalledWith(Buffer.from('personalised'));
    expect(result).toMatchObject({
      custom: true,
      folderUrl: null,
      artworkUrl: null,
      fileName: 'ORD-123-SEA_CREATURES_GREEN_SEA_TURTLE-A4-custom.jpg',
      payload: {
        products: [{
          size: 'A4',
          type: 'Print',
          paper_type: 'Matte',
        }],
      },
    });
    expect(result.payload.products[0]).not.toHaveProperty('sku');
  });

  it('stores custom artwork in the public PrintShrimp S3 bucket without Dropbox', async () => {
    mocks.findUnique.mockResolvedValue(previewListing());
    const stage = vi.fn().mockResolvedValue('https://etsy-listings-printshrimp-upload-eu-west-2.s3.eu-west-2.amazonaws.com/printshrimp-staging/custom-orders/ORD-123/custom.jpg');
    const fetchMock = vi.fn(async (_input: string | URL | Request, _init?: RequestInit) => new Response(JSON.stringify({
      success: true,
      order: { order_id: 'custom-order-1', status: 'Pending' },
    }), { status: 201, headers: { 'Content-Type': 'application/json' } }));
    const result = await submitPrintShrimpOrder(previewInput({ topText: 'Welcome' }), {
      readStorageFile: vi.fn().mockResolvedValue(Buffer.from('source')),
      readFont: vi.fn().mockResolvedValue(Buffer.from('font')),
      personalise: vi.fn().mockResolvedValue({
        buffer: Buffer.from('personalised'),
        width: 7016,
        height: 9933,
        density: 300,
        fontSize: 200,
        textColour: '#334433',
        headerText: 'Welcome',
        footerText: '',
      }),
      convert: vi.fn().mockResolvedValue({ jpeg: Buffer.from('jpeg'), width: 7016, height: 9933, density: 300 }),
      stage,
      createStagingPath: () => 'printshrimp-staging/custom-orders/ORD-123/custom.jpg',
      fetch: fetchMock,
    });

    expect(stage).toHaveBeenCalledWith('printshrimp-staging/custom-orders/ORD-123/custom.jpg', Buffer.from('jpeg'));
    const submitted = JSON.parse(String(fetchMock.mock.calls[0][1]?.body));
    expect(submitted.products[0]).toEqual({
      size: 'A4',
      type: 'Print',
      paper_type: 'Matte',
      image: {
        artwork_url: 'https://etsy-listings-printshrimp-upload-eu-west-2.s3.eu-west-2.amazonaws.com/printshrimp-staging/custom-orders/ORD-123/custom.jpg',
      },
    });
    expect(result.folderUrl).toBeNull();
    expect(result.artworkUrl).toBe('https://etsy-listings-printshrimp-upload-eu-west-2.s3.eu-west-2.amazonaws.com/printshrimp-staging/custom-orders/ORD-123/custom.jpg');
    expect(result.payload).toEqual(submitted);
  });

  it('generates a Fredoka Bold preview without uploading it to Dropbox', async () => {
    mocks.findUnique.mockResolvedValue(previewListing());
    const readFont = vi.fn().mockResolvedValue(Buffer.from('fredoka font'));
    const personalise = vi.fn().mockResolvedValue({
      buffer: Buffer.from('personalised'),
      width: 7016,
      height: 9933,
      density: 300,
      fontSize: 200,
      textColour: '#334433',
      headerText: 'Welcome',
      footerText: '',
    });
    const convert = vi.fn().mockResolvedValue({
      jpeg: Buffer.from('preview jpeg'),
      width: 7016,
      height: 9933,
      density: 300,
    });
    const result = await generatePrintShrimpCustomArtworkPreview({
      listingId: '339',
      size: 'A4',
      topText: 'Welcome',
      bottomText: '',
      fontId: 'fredoka-bold',
      externalOrderNumber: 'ORD-123',
    }, {
      readStorageFile: vi.fn().mockResolvedValue(Buffer.from('source')),
      readFont,
      personalise,
      convert,
    });

    expect(readFont).toHaveBeenCalledWith(expect.stringMatching(/[\\/]fonts[\\/]fredoka[\\/]Fredoka-Bold\.ttf$/));
    expect(personalise).toHaveBeenCalledWith(
      Buffer.from('source'),
      Buffer.from('fredoka font'),
      { headerText: 'Welcome', footerText: '', textTransform: 'NONE' },
      expect.objectContaining({ fontFamily: 'Fredoka', fontWeight: 700 }),
    );
    expect(result.buffer).toEqual(Buffer.from('preview jpeg'));
  });

  it('resolves the selected size to the matching direct Dropbox file URL', async () => {
    mocks.findUnique.mockResolvedValue({
      downloadsRevision: 8,
      dropboxRevision: 8,
      dropboxSyncedAt: new Date(),
      dropboxBundle: {
        folderPath: '/Green-Sea-Turtle',
        sharedUrl: 'https://www.dropbox.com/folder',
      },
      subSection: {
        id: 15,
        shopSection: { id: 10, shop: { etsyShopId: BigInt(66615491) } },
      },
      files: [a1File()],
    });
    mocks.getDropboxFileUrl.mockResolvedValue('https://www.dropbox.com/file?raw=1');

    const result = await getPrintShrimpOrderArtworkUrl('339', 'A4');

    expect(mocks.getDropboxFileUrl).toHaveBeenCalledWith('/Green-Sea-Turtle', 'Green_Turtle_ISO_A1.png');
    expect(result.artworkUrl).toBe('https://www.dropbox.com/file?raw=1');
  });

  it('refreshes a legacy zipped Dropbox folder once when the individual artwork is missing', async () => {
    mocks.findUnique.mockResolvedValue({
      downloadsRevision: 8,
      dropboxRevision: 8,
      dropboxSyncedAt: new Date(),
      dropboxBundle: {
        folderPath: '/Green-Sea-Turtle',
        sharedUrl: 'https://www.dropbox.com/folder',
      },
      subSection: {
        id: 15,
        shopSection: { id: 10, shop: { etsyShopId: BigInt(66615491) } },
      },
      files: [a1File()],
    });
    mocks.getDropboxFileUrl
      .mockRejectedValueOnce(new Error('path/not_found'))
      .mockResolvedValueOnce('https://www.dropbox.com/file?raw=1');
    mocks.createDropbox.mockResolvedValue({});

    const result = await getPrintShrimpOrderArtworkUrl('339', 'A4');

    expect(mocks.createDropbox).toHaveBeenCalledWith({
      shopId: '66615491',
      sectionId: '10',
      subSectionId: '15',
      listingId: '339',
    });
    expect(mocks.getDropboxFileUrl).toHaveBeenCalledTimes(2);
    expect(result.artworkUrl).toBe('https://www.dropbox.com/file?raw=1');
  });
});
