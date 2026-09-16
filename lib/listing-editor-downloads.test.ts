import { beforeEach, describe, expect, it, vi } from 'vitest';

const storage = vi.hoisted(() => ({
  objects: new Map<string, Buffer>(),
}));

const sharpState = vi.hoisted(() => ({
  replacement: Buffer.from('edited download bytes'),
}));

const dropboxMocks = vi.hoisted(() => ({
  inspectListingZipStorage: vi.fn(),
}));

const prismaMocks = vi.hoisted(() => ({
  shopFindUnique: vi.fn(),
  sectionFindFirst: vi.fn(),
  subSectionFindFirst: vi.fn(),
  listingFindFirst: vi.fn(),
  listingFindUnique: vi.fn(),
  listingUpdate: vi.fn(),
  listingUpdateMany: vi.fn(),
  fileUpdate: vi.fn(),
  zipDeleteMany: vi.fn(),
  zipCreate: vi.fn(),
  zipUpdate: vi.fn(),
  pricesFindMany: vi.fn(),
  transaction: vi.fn(),
}));

function normalized(value: string) {
  return value.replace(/\\/g, '/').replace(/\/$/, '');
}

function missingObject(storagePath: string) {
  return Object.assign(new Error(`Missing ${storagePath}`), { code: 'ENOENT' });
}

vi.mock('@/lib/local-shop-directory', () => ({
  getListingDirectoryPath: () => 'D:\\Listings\\Current',
}));

vi.mock('@/lib/dropbox-bundle', () => ({
  inspectListingZipStorage: dropboxMocks.inspectListingZipStorage,
  isDropboxInstructionPdfFile: () => false,
}));

vi.mock('@/lib/prisma', () => ({
  prisma: {
    etsyShop: { findUnique: prismaMocks.shopFindUnique },
    etsyShopSection: { findFirst: prismaMocks.sectionFindFirst },
    etsyShopSubSection: { findFirst: prismaMocks.subSectionFindFirst },
    etsyListing: {
      findFirst: prismaMocks.listingFindFirst,
      findUnique: prismaMocks.listingFindUnique,
      update: prismaMocks.listingUpdate,
      updateMany: prismaMocks.listingUpdateMany,
    },
    etsyListingFile: { update: prismaMocks.fileUpdate },
    etsyListingZip: {
      create: prismaMocks.zipCreate,
      deleteMany: prismaMocks.zipDeleteMany,
      update: prismaMocks.zipUpdate,
    },
    adminProductPrice: { findMany: prismaMocks.pricesFindMany },
    $transaction: prismaMocks.transaction,
  },
}));

vi.mock('@/lib/s3-listing-storage', () => ({
  mkdir: vi.fn(async () => undefined),
  readFile: vi.fn(async (storagePath: string) => {
    const contents = storage.objects.get(normalized(storagePath));
    if (!contents) throw missingObject(storagePath);
    return Buffer.from(contents);
  }),
  writeFile: vi.fn(async (storagePath: string, contents: Buffer | Uint8Array | string) => {
    storage.objects.set(
      normalized(storagePath),
      typeof contents === 'string' ? Buffer.from(contents) : Buffer.from(contents),
    );
  }),
  stat: vi.fn(async (storagePath: string) => {
    const contents = storage.objects.get(normalized(storagePath));
    if (!contents) throw missingObject(storagePath);
    return { isFile: () => true, isDirectory: () => false, size: contents.length };
  }),
  readdir: vi.fn(async (directoryPath: string) => {
    const prefix = `${normalized(directoryPath)}/`;
    return [...storage.objects.keys()]
      .filter((key) => key.startsWith(prefix) && !key.slice(prefix.length).includes('/'))
      .map((key) => key.slice(prefix.length));
  }),
  unlink: vi.fn(async (storagePath: string) => {
    if (!storage.objects.delete(normalized(storagePath))) throw missingObject(storagePath);
  }),
  copyFile: vi.fn(async (sourcePath: string, destinationPath: string) => {
    const contents = storage.objects.get(normalized(sourcePath));
    if (!contents) throw missingObject(sourcePath);
    storage.objects.set(normalized(destinationPath), Buffer.from(contents));
  }),
  rename: vi.fn(async (sourcePath: string, destinationPath: string) => {
    const sourceKey = normalized(sourcePath);
    const contents = storage.objects.get(sourceKey);
    if (!contents) throw missingObject(sourcePath);
    storage.objects.set(normalized(destinationPath), Buffer.from(contents));
    storage.objects.delete(sourceKey);
  }),
  rm: vi.fn(async () => undefined),
}));

vi.mock('sharp', () => ({
  default: vi.fn((input: Buffer) => {
    const chain = {
      resize: vi.fn(() => chain),
      withMetadata: vi.fn(() => chain),
      jpeg: vi.fn(() => chain),
      toBuffer: vi.fn(async () => Buffer.from(sharpState.replacement)),
      metadata: vi.fn(async () => input.equals(sharpState.replacement)
        ? { width: 4961, height: 7016 }
        : { width: 7016, height: 9933 }),
    };
    return chain;
  }),
}));

import {
  createListingZipFiles,
  reduceListingDownload,
  reduceListingDownloadQuality,
} from '@/lib/listing-editor';

const context = { shopId: '66615491', sectionId: '2', subSectionId: '3', listingId: '79' };
const targetPath = 'D:/Listings/Current/downloads/artwork.jpg';

function listingFile() {
  return {
    id: 5,
    localFileName: 'artwork.jpg',
    originalFileName: 'Artwork.jpg',
    filename: 'artwork.jpg',
    widthPixels: 7016,
    heightPixels: 9933,
    jpegQuality: 100,
    rank: 1,
    sizeBytes: Buffer.byteLength('original download bytes'),
    zipNumber: 1,
  };
}

function makeListingRecord() {
  return {
    id: 79,
    etsyId: 'etsy-listing-79',
    title: 'Artwork',
    localDirectoryName: 'Artwork',
    description: 'Description',
    state: 'active',
    quantity: 10,
    priceAmount: 3499,
    priceDivisor: 100,
    priceCurrencyCode: 'GBP',
    taxonomyId: 121,
    shopSectionId: null,
    whoMade: 'i_did',
    whenMade: '2020_2026',
    isSupply: false,
    shouldAutoRenew: true,
    isPersonalizable: true,
    language: 'en-US',
    primaryColour: 'black',
    secondaryColour: 'white',
    etsyProductType: 'Physical',
    numberOfItems: 1,
    includeAllItems: false,
    thumbnailFileName: 'thumbnail.jpg',
    thumbnailOriginalFileName: 'Thumbnail.jpg',
    detailsChanged: false,
    tagsChanged: false,
    imagesChanged: false,
    downloadsChanged: false,
    productsChanged: false,
    downloadsRevision: 4,
    zippedRevision: 4,
    hasEverZipped: true,
    dropboxRevision: 4,
    dropboxSyncedAt: null,
    tags: [],
    materials: [],
    styles: [],
    images: [],
    files: [listingFile()],
    zippedFiles: [] as Array<{
      id: number;
      zipNumber: number;
      fileName: string;
      sizeBytes: number;
      etsyListingFileId: string | null;
    }>,
    videos: [],
    translations: [],
    inventoryItems: [],
    personalizations: [],
    buyerPrices: [],
    productConfig: null,
    sizeOptions: [],
    frameOptions: [],
    products: [],
    dropboxFiles: [],
    dropboxBundle: null,
  };
}

let currentListing = makeListingRecord();

beforeEach(() => {
  storage.objects.clear();
  sharpState.replacement = Buffer.from('edited download bytes');
  storage.objects.set(targetPath, Buffer.from('original download bytes'));

  prismaMocks.shopFindUnique.mockResolvedValue({
    id: 1,
    etsyShopId: BigInt(66615491),
    shopName: 'Test shop',
    title: null,
  });
  prismaMocks.sectionFindFirst.mockResolvedValue({ id: 2, title: 'Prints' });
  prismaMocks.subSectionFindFirst.mockResolvedValue({
    id: 3,
    name: 'Animals',
    numberOfDownloads: 1,
    includeAllDownloads: false,
  });
  currentListing = makeListingRecord();
  prismaMocks.listingFindFirst.mockImplementation(async () => currentListing);
  prismaMocks.listingFindUnique.mockImplementation(async () => ({
    downloadsRevision: currentListing.downloadsRevision,
    zippedRevision: currentListing.zippedRevision,
  }));
  prismaMocks.pricesFindMany.mockResolvedValue([]);
  dropboxMocks.inspectListingZipStorage.mockResolvedValue({
    valid: true,
    grouped: false,
    groupCount: 1,
    expectedGroupCount: null,
    message: null,
  });
  prismaMocks.fileUpdate.mockReturnValue({ operation: 'update-file' });
  prismaMocks.zipDeleteMany.mockReturnValue({ operation: 'delete-zips' });
  prismaMocks.zipCreate.mockResolvedValue({});
  prismaMocks.zipUpdate.mockResolvedValue({});
  prismaMocks.listingUpdate.mockReturnValue({ operation: 'update-listing' });
  prismaMocks.listingUpdateMany.mockResolvedValue({ count: 1 });
  prismaMocks.transaction.mockRejectedValue(new Error('Simulated database failure'));
});

describe('download image edits', () => {
  it.each([
    ['resize', () => reduceListingDownload(context, '5')],
    ['JPEG recompress', () => reduceListingDownloadQuality(context, '5')],
  ])('restores the original S3 bytes when the %s database transaction fails', async (_label, action) => {
    const originalContents = Buffer.from(storage.objects.get(targetPath)!);

    await expect(action()).rejects.toThrow('Simulated database failure');

    expect(storage.objects.get(targetPath)).toEqual(originalContents);
    expect([...storage.objects.keys()].some((key) => key.includes('.download-edit.'))).toBe(false);
    expect(prismaMocks.listingUpdate).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        downloadsChanged: true,
        downloadsRevision: { increment: 1 },
      }),
    }));
  });
});

describe('ordinary listing ZIP reconciliation', () => {
  async function generateThenRecordRemoteZip() {
    prismaMocks.transaction.mockImplementation(async (action: (tx: unknown) => unknown) => action({
      etsyListing: { updateMany: prismaMocks.listingUpdateMany },
      etsyListingFile: { update: prismaMocks.fileUpdate },
      etsyListingZip: {
        create: prismaMocks.zipCreate,
        deleteMany: prismaMocks.zipDeleteMany,
        update: prismaMocks.zipUpdate,
      },
    }));

    await createListingZipFiles(context, [{ fileId: '5', zipNumber: 1 }]);
    const liveZip = Buffer.from(storage.objects.get('D:/Listings/Current/zipped/Artwork_1.zip')!);
    currentListing.zippedFiles = [{
      id: 31,
      zipNumber: 1,
      fileName: 'Artwork_1.zip',
      sizeBytes: liveZip.length,
      etsyListingFileId: 'etsy-file-31',
    }];
    prismaMocks.zipCreate.mockClear();
    prismaMocks.zipDeleteMany.mockClear();
    prismaMocks.zipUpdate.mockClear();
    prismaMocks.listingUpdateMany.mockClear();
    return liveZip;
  }

  it('preserves the ZIP row and Etsy file ID when regenerated bytes are identical', async () => {
    const previousZip = await generateThenRecordRemoteZip();

    await createListingZipFiles(context, [{ fileId: '5', zipNumber: 1 }]);

    expect(storage.objects.get('D:/Listings/Current/zipped/Artwork_1.zip')).toEqual(previousZip);
    expect(prismaMocks.zipCreate).not.toHaveBeenCalled();
    expect(prismaMocks.zipDeleteMany).not.toHaveBeenCalled();
    expect(prismaMocks.zipUpdate).toHaveBeenCalledWith({
      where: { id: 31 },
      data: {
        fileName: 'Artwork_1.zip',
        sizeBytes: previousZip.length,
      },
    });
    expect(prismaMocks.listingUpdateMany).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.not.objectContaining({ downloadsChanged: true }),
    }));
    expect([...storage.objects.keys()].some((key) => /\.(staged|backup)$/.test(key))).toBe(false);
  });

  it('clears only the matching row Etsy ID when regenerated bytes change', async () => {
    const previousZip = await generateThenRecordRemoteZip();
    storage.objects.set(targetPath, Buffer.from('changed source download bytes'));

    await createListingZipFiles(context, [{ fileId: '5', zipNumber: 1 }]);

    expect(storage.objects.get('D:/Listings/Current/zipped/Artwork_1.zip')).not.toEqual(previousZip);
    expect(prismaMocks.zipCreate).not.toHaveBeenCalled();
    expect(prismaMocks.zipDeleteMany).not.toHaveBeenCalled();
    expect(prismaMocks.zipUpdate).toHaveBeenCalledWith({
      where: { id: 31 },
      data: expect.objectContaining({ etsyListingFileId: null }),
    });
    expect(prismaMocks.listingUpdateMany).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ downloadsChanged: true }),
    }));
  });
});
