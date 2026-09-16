import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const storage = vi.hoisted(() => ({
  objects: new Map<string, Buffer>(),
  operations: [] as string[],
  installCount: 0,
  failOnInstall: null as number | null,
}));

const listingRecord = vi.hoisted(() => ({
  value: {} as Record<string, unknown>,
}));

const prismaMocks = vi.hoisted(() => ({
  findFirst: vi.fn(),
  findUnique: vi.fn(),
  updateMany: vi.fn(),
  transaction: vi.fn(),
  bundleUpsert: vi.fn(),
  fileDeleteMany: vi.fn(),
  fileCreate: vi.fn(),
  fileUpdate: vi.fn(),
  transactionListingUpdate: vi.fn(),
  transactionListingUpdateMany: vi.fn(),
}));

vi.mock('@/lib/local-shop-directory', () => ({
  getListingDirectoryPath: () => 'D:\\Listings\\Current',
}));

vi.mock('@/lib/prisma', () => ({
  prisma: {
    etsyListing: {
      findFirst: prismaMocks.findFirst,
      findUnique: prismaMocks.findUnique,
      updateMany: prismaMocks.updateMany,
    },
    $transaction: prismaMocks.transaction,
  },
}));

function missingObject(storagePath: string) {
  return Object.assign(new Error(`Missing ${storagePath}`), { code: 'ENOENT' });
}

function normalized(value: string) {
  return value.replace(/\\/g, '/').replace(/\/$/, '');
}

vi.mock('@/lib/s3-listing-storage', () => ({
  mkdir: vi.fn(async () => undefined),
  readFile: vi.fn(async (storagePath: string) => {
    const value = storage.objects.get(normalized(storagePath));
    if (!value) throw missingObject(storagePath);
    return Buffer.from(value);
  }),
  writeFile: vi.fn(async (storagePath: string, contents: Buffer | Uint8Array | string) => {
    const value = typeof contents === 'string' ? Buffer.from(contents) : Buffer.from(contents);
    storage.objects.set(normalized(storagePath), value);
    storage.operations.push(`write:${normalized(storagePath)}`);
  }),
  stat: vi.fn(async (storagePath: string) => {
    const value = storage.objects.get(normalized(storagePath));
    if (!value) throw missingObject(storagePath);
    return { isFile: () => true, isDirectory: () => false, size: value.length };
  }),
  readdir: vi.fn(async (directoryPath: string) => {
    const prefix = `${normalized(directoryPath)}/`;
    return [...storage.objects.keys()]
      .filter((key) => key.startsWith(prefix) && !key.slice(prefix.length).includes('/'))
      .map((key) => key.slice(prefix.length));
  }),
  unlink: vi.fn(async (storagePath: string) => {
    const key = normalized(storagePath);
    if (!storage.objects.delete(key)) throw missingObject(storagePath);
    storage.operations.push(`unlink:${key}`);
  }),
  copyFile: vi.fn(async (sourcePath: string, destinationPath: string) => {
    const source = storage.objects.get(normalized(sourcePath));
    if (!source) throw missingObject(sourcePath);
    storage.objects.set(normalized(destinationPath), Buffer.from(source));
    storage.operations.push(`copy:${normalized(sourcePath)}->${normalized(destinationPath)}`);
  }),
  rename: vi.fn(async (sourcePath: string, destinationPath: string) => {
    const sourceKey = normalized(sourcePath);
    const destinationKey = normalized(destinationPath);
    if (sourceKey.endsWith('.staged')) {
      storage.installCount += 1;
      if (storage.failOnInstall === storage.installCount) throw new Error('Simulated install failure');
    }
    const source = storage.objects.get(sourceKey);
    if (!source) throw missingObject(sourcePath);
    storage.objects.set(destinationKey, Buffer.from(source));
    storage.objects.delete(sourceKey);
    storage.operations.push(`rename:${sourceKey}->${destinationKey}`);
  }),
}));

import {
  createDropboxInstructionPdf,
  createDropboxZips,
  createOrUpdateDropbox,
  inspectListingZipStorage,
} from '@/lib/dropbox-bundle';

const context = { shopId: '66615491', sectionId: '2', subSectionId: '3', listingId: '79' };

function makeListing() {
  return {
    id: 79,
    title: 'Grouped listing',
    localDirectoryName: 'Grouped-listing',
    downloadsRevision: 4,
    zippedRevision: 3,
    hasEverZipped: true,
    numberOfItems: 2,
    includeAllItems: false,
    dropboxFiles: [
      {
        id: 1,
        groupNumber: 1,
        sourceListingId: 101,
        sourceDirectoryName: 'Albert',
        localFileName: 'albert.jpg',
        originalFileName: 'Albert.jpg',
      },
      {
        id: 2,
        groupNumber: 2,
        sourceListingId: 102,
        sourceDirectoryName: 'Betty',
        localFileName: 'betty.jpg',
        originalFileName: 'Betty.jpg',
      },
    ],
    dropboxBundle: null,
    files: [] as Array<Record<string, unknown>>,
    zippedFiles: [] as Array<{ fileName: string; sizeBytes: number }>,
    subSection: {
      id: 3,
      name: 'Animals',
      shopSection: {
        id: 2,
        title: 'Prints',
        shop: { etsyShopId: BigInt(66615491), shopName: 'Test shop', title: null },
      },
    },
  };
}

beforeEach(() => {
  storage.objects.clear();
  storage.operations.length = 0;
  storage.installCount = 0;
  storage.failOnInstall = null;
  listingRecord.value = makeListing();
  prismaMocks.findFirst.mockImplementation(async () => listingRecord.value);
  prismaMocks.findUnique.mockResolvedValue({ downloadsRevision: 4 });
  prismaMocks.updateMany.mockResolvedValue({ count: 1 });
  prismaMocks.bundleUpsert.mockImplementation(async ({ update }: { update: Record<string, unknown> }) => ({
    folderPath: update.folderPath,
    sharedUrl: update.sharedUrl,
  }));
  prismaMocks.fileDeleteMany.mockResolvedValue({ count: 0 });
  prismaMocks.fileCreate.mockImplementation(async ({ data }: { data: Record<string, unknown> }) => data);
  prismaMocks.fileUpdate.mockImplementation(async ({ data }: { data: Record<string, unknown> }) => data);
  prismaMocks.transactionListingUpdate.mockResolvedValue({});
  prismaMocks.transactionListingUpdateMany.mockResolvedValue({ count: 1 });
  prismaMocks.transaction.mockImplementation(async (action: (tx: unknown) => unknown) => action({
    etsyListingDropboxBundle: { upsert: prismaMocks.bundleUpsert },
    etsyListingFile: {
      deleteMany: prismaMocks.fileDeleteMany,
      create: prismaMocks.fileCreate,
      update: prismaMocks.fileUpdate,
    },
    etsyListing: {
      update: prismaMocks.transactionListingUpdate,
      updateMany: prismaMocks.transactionListingUpdateMany,
    },
  }));
  storage.objects.set('D:/Listings/Current/dropboxDownloads/albert.jpg', Buffer.from('albert source'));
  storage.objects.set('D:/Listings/Current/dropboxDownloads/betty.jpg', Buffer.from('betty source'));
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

describe('grouped Dropbox ZIP installation', () => {
  it('stages every archive before replacing the live ZIP set', async () => {
    storage.objects.set('D:/Listings/Current/dropboxZipped/obsolete.zip', Buffer.from('old'));

    const result = await createDropboxZips(context);

    expect(result.zips).toHaveLength(2);
    expect(storage.objects.has('D:/Listings/Current/dropboxZipped/01-Albert.zip')).toBe(true);
    expect(storage.objects.has('D:/Listings/Current/dropboxZipped/02-Betty.zip')).toBe(true);
    expect(storage.objects.has('D:/Listings/Current/dropboxZipped/obsolete.zip')).toBe(false);
    const stageWrites = storage.operations
      .map((operation, index) => ({ operation, index }))
      .filter(({ operation }) => operation.startsWith('write:') && operation.endsWith('.staged'));
    const firstInstall = storage.operations.findIndex((operation) => operation.startsWith('rename:'));
    expect(stageWrites).toHaveLength(2);
    expect(stageWrites.every(({ index }) => index < firstInstall)).toBe(true);
    expect(prismaMocks.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      data: { hasEverZipped: true, zippedRevision: 4 },
    }));
  });

  it('restores every previous live ZIP if installation fails part-way through', async () => {
    const firstPath = 'D:/Listings/Current/dropboxZipped/01-Albert.zip';
    const secondPath = 'D:/Listings/Current/dropboxZipped/02-Betty.zip';
    storage.objects.set(firstPath, Buffer.from('previous Albert ZIP'));
    storage.objects.set(secondPath, Buffer.from('previous Betty ZIP'));
    storage.failOnInstall = 2;

    await expect(createDropboxZips(context)).rejects.toThrow('Simulated install failure');

    expect(storage.objects.get(firstPath)?.toString()).toBe('previous Albert ZIP');
    expect(storage.objects.get(secondPath)?.toString()).toBe('previous Betty ZIP');
    expect([...storage.objects.keys()].some((key) => /\.(staged|backup)$/.test(key))).toBe(false);
    expect(prismaMocks.updateMany).toHaveBeenLastCalledWith(expect.objectContaining({
      data: { hasEverZipped: true, zippedRevision: 3 },
    }));
  });

  it('rolls the live ZIPs back when the download revision changes before commit', async () => {
    const firstPath = 'D:/Listings/Current/dropboxZipped/01-Albert.zip';
    const secondPath = 'D:/Listings/Current/dropboxZipped/02-Betty.zip';
    storage.objects.set(firstPath, Buffer.from('previous Albert ZIP'));
    storage.objects.set(secondPath, Buffer.from('previous Betty ZIP'));
    prismaMocks.updateMany
      .mockResolvedValueOnce({ count: 1 })
      .mockResolvedValueOnce({ count: 0 });

    await expect(createDropboxZips(context)).rejects.toThrow('downloads changed');

    expect(storage.objects.get(firstPath)?.toString()).toBe('previous Albert ZIP');
    expect(storage.objects.get(secondPath)?.toString()).toBe('previous Betty ZIP');
    expect([...storage.objects.keys()].some((key) => /\.(staged|backup)$/.test(key))).toBe(false);
  });

  it('rejects grouped downloads that do not have one distinct source per selected animal', async () => {
    const listing = makeListing();
    listing.zippedRevision = listing.downloadsRevision;
    listing.dropboxFiles = listing.dropboxFiles.slice(0, 1);

    const status = await inspectListingZipStorage(listing, 'D:\\Listings\\Current');

    expect(status.valid).toBe(false);
    expect(status.expectedGroupCount).toBe(2);
    expect(status.message).toContain('Expected 2 Dropbox source groups');
  });

  it('rejects two grouped archives that point at the same selected animal', async () => {
    const listing = makeListing();
    listing.zippedRevision = listing.downloadsRevision;
    listing.dropboxFiles[1].sourceListingId = listing.dropboxFiles[0].sourceListingId;

    const status = await inspectListingZipStorage(listing, 'D:\\Listings\\Current');

    expect(status.valid).toBe(false);
    expect(status.message).toContain('one distinct Dropbox source group');
  });

  it('does not report a database ZIP as current when its S3 object is missing or has the wrong size', async () => {
    const listing = makeListing();
    listing.dropboxFiles = [];
    listing.zippedRevision = listing.downloadsRevision;
    listing.zippedFiles = [{ fileName: 'Current_1.zip', sizeBytes: 12 }];

    const missing = await inspectListingZipStorage(listing, 'D:\\Listings\\Current');
    storage.objects.set('D:/Listings/Current/zipped/Current_1.zip', Buffer.from('short'));
    const wrongSize = await inspectListingZipStorage(listing, 'D:\\Listings\\Current');
    storage.objects.set('D:/Listings/Current/zipped/Current_1.zip', Buffer.alloc(12, 1));
    const current = await inspectListingZipStorage(listing, 'D:\\Listings\\Current');

    expect(missing.valid).toBe(false);
    expect(wrongSize.valid).toBe(false);
    expect(current.valid).toBe(true);
  });
});

describe('Dropbox shared-link changes', () => {
  it('creates the required Etsy instruction PDF when a grouped Dropbox listing does not have one', async () => {
    const newUrl = 'https://www.dropbox.com/scl/fo/new-grouped-link';
    const listing = makeListing();
    listing.zippedRevision = listing.downloadsRevision;
    listing.files = [
      { id: 20, localFileName: 'file_2.jpg', originalFileName: 'Ant_2x3.jpeg', filename: 'file_2.jpg', rawJson: {} },
      { id: 21, localFileName: 'file_3.jpg', originalFileName: 'Ant_3x4.jpeg', filename: 'file_3.jpg', rawJson: {} },
      { id: 22, localFileName: 'file_7.txt', originalFileName: 'HowToPrintGuide.txt', filename: 'file_7.txt', rawJson: {} },
    ];
    listing.zippedFiles = [{ fileName: 'zip_1.zip', sizeBytes: 14 }];
    listingRecord.value = listing;
    storage.objects.set('D:/Listings/Current/downloads/file_2.jpg', Buffer.from('2x3 artwork'));
    storage.objects.set('D:/Listings/Current/downloads/file_3.jpg', Buffer.from('3x4 artwork'));
    storage.objects.set('D:/Listings/Current/downloads/file_7.txt', Buffer.from('print guide'));

    vi.stubEnv('DROPBOX_ACCESS_TOKEN', 'test-dropbox-token');
    vi.stubGlobal('fetch', vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      const url = String(input);
      const response = (body: Record<string, unknown>, ok = true, status = 200) => ({
        ok,
        status,
        statusText: ok ? 'OK' : 'Conflict',
        json: async () => body,
        text: async () => JSON.stringify(body),
      });
      if (url.includes('content.dropboxapi.com/2/files/upload')) return response({});
      if (url.endsWith('/files/get_metadata')) return response({ error_summary: 'path/not_found/..' }, false, 409);
      if (url.endsWith('/files/create_folder_v2')) return response({ metadata: { '.tag': 'folder' } });
      if (url.endsWith('/sharing/create_shared_link_with_settings')) return response({ url: newUrl });
      if (url.endsWith('/files/list_folder')) {
        const requestedPath = JSON.parse(String(init?.body)).path as string;
        return response({
          entries: [{ '.tag': 'file', name: 'download-instructions.txt', path_display: `${requestedPath}/download-instructions.txt` }],
          has_more: false,
        });
      }
      if (url.endsWith('/files/delete_v2')) return response({});
      throw new Error(`Unexpected Dropbox request: ${url}`);
    }));

    const result = await createOrUpdateDropbox(context);

    expect(result.sharedUrl).toBe(newUrl);
    const uploadCalls = vi.mocked(fetch).mock.calls.filter(([input]) => String(input).includes('content.dropboxapi.com/2/files/upload'));
    const uploadedPaths = uploadCalls.map(([, init]) => String((init?.headers as Record<string, string>)?.['Dropbox-API-Arg']));
    expect(uploadedPaths.some((value) => value.includes('download-instructions.txt'))).toBe(false);
    expect(vi.mocked(fetch).mock.calls.some(([input, init]) => (
      String(input).endsWith('/files/delete_v2')
      && String(init?.body).includes('download-instructions.txt')
    ))).toBe(true);
    const zipUpload = uploadCalls.find(([, init]) => String((init?.headers as Record<string, string>)?.['Dropbox-API-Arg']).includes('Grouped-listing.zip'));
    const uploadedZipNames = uploadCalls.flatMap(([, init]) => {
      const apiArg = JSON.parse(String((init?.headers as Record<string, string>)?.['Dropbox-API-Arg'])) as { path: string };
      return apiArg.path.toLocaleLowerCase().endsWith('.zip') ? [apiArg.path] : [];
    });
    expect(uploadedZipNames).toEqual([expect.stringMatching(/\/Grouped-listing\.zip$/)]);
    expect(uploadedZipNames.some((name) => name.includes('zip_1.zip'))).toBe(false);
    expect(zipUpload).toBeTruthy();
    const zipBytes = Buffer.from(zipUpload?.[1]?.body as Uint8Array);
    expect(zipBytes.includes(Buffer.from('Ant_2x3.jpeg'))).toBe(true);
    expect(zipBytes.includes(Buffer.from('Ant_3x4.jpeg'))).toBe(true);
    expect(zipBytes.includes(Buffer.from('HowToPrintGuide.txt'))).toBe(true);
    expect(zipBytes.includes(Buffer.from('file_2.jpg'))).toBe(false);
    expect(prismaMocks.fileCreate).toHaveBeenCalledWith({
      data: expect.objectContaining({
        listingId: 79,
        localFileName: 'CosyHousePrints_Download_Instructions.pdf',
        etsyListingFileId: null,
        rawJson: { kind: 'dropbox_instruction_pdf', dropboxSharedUrl: newUrl },
      }),
    });
    expect(storage.objects.get('D:/Listings/Current/downloads/CosyHousePrints_Download_Instructions.pdf')?.length).toBeGreaterThan(0);
    expect(prismaMocks.transactionListingUpdateMany).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ downloadsChanged: true, dropboxRevision: 4 }),
    }));
  });

  it('regenerates only the existing instruction PDF and flags it for Etsy resend without advancing downloads revision', async () => {
    const oldUrl = 'https://www.dropbox.com/scl/fo/old-link';
    const newUrl = 'https://www.dropbox.com/scl/fo/new-link';
    const instructionFileName = 'CosyHousePrints_Download_Instructions.pdf';
    const unrelatedFileName = 'Original-Artwork.jpg';
    const listing: Omit<ReturnType<typeof makeListing>, 'dropboxBundle' | 'files'> & {
      dropboxBundle: { folderPath: string; sharedUrl: string; instructions: string } | null;
      files: Array<Record<string, unknown>>;
    } = makeListing();
    listing.zippedRevision = listing.downloadsRevision;
    listing.dropboxBundle = {
      folderPath: '/grouped-listing-existing',
      sharedUrl: oldUrl,
      instructions: `Old instructions: ${oldUrl}`,
    };
    listing.files = [
      {
        id: 10,
        localFileName: instructionFileName,
        originalFileName: instructionFileName,
        filename: instructionFileName,
        etsyListingFileId: 'etsy-file-10',
        rawJson: { dropboxSharedUrl: oldUrl },
      },
      {
        id: 11,
        localFileName: unrelatedFileName,
        originalFileName: unrelatedFileName,
        filename: unrelatedFileName,
        etsyListingFileId: 'etsy-file-11',
        rawJson: { source: 'user-upload' },
      },
    ];
    listingRecord.value = listing;
    storage.objects.set('D:/Listings/Current/dropboxZipped/01-Albert.zip', Buffer.from('current Albert ZIP'));
    storage.objects.set('D:/Listings/Current/dropboxZipped/02-Betty.zip', Buffer.from('current Betty ZIP'));
    const oldPdf = Buffer.from('old linked PDF');
    const unrelatedFile = Buffer.from('must remain unchanged');
    storage.objects.set(`D:/Listings/Current/downloads/${instructionFileName}`, oldPdf);
    storage.objects.set(`D:/Listings/Current/downloads/${unrelatedFileName}`, unrelatedFile);

    vi.stubEnv('DROPBOX_ACCESS_TOKEN', 'test-dropbox-token');
    vi.stubGlobal('fetch', vi.fn(async (input: string | URL | Request) => {
      const url = String(input);
      const response = (body: Record<string, unknown>, ok = true, status = 200) => ({
        ok,
        status,
        statusText: ok ? 'OK' : 'Conflict',
        json: async () => body,
        text: async () => JSON.stringify(body),
      });
      if (url.includes('content.dropboxapi.com/2/files/upload')) return response({});
      if (url.endsWith('/files/get_metadata')) {
        return response({ error_summary: 'path/not_found/..' }, false, 409);
      }
      if (url.endsWith('/files/create_folder_v2')) return response({ metadata: { '.tag': 'folder' } });
      if (url.endsWith('/sharing/create_shared_link_with_settings')) return response({ url: newUrl });
      if (url.endsWith('/files/list_folder')) return response({ entries: [], has_more: false });
      throw new Error(`Unexpected Dropbox request: ${url}`);
    }));

    const result = await createOrUpdateDropbox(context);

    expect(result.sharedUrl).toBe(newUrl);
    expect(storage.objects.get(`D:/Listings/Current/downloads/${instructionFileName}`)).not.toEqual(oldPdf);
    expect(storage.objects.get(`D:/Listings/Current/downloads/${instructionFileName}`)?.length).toBeGreaterThan(0);
    expect(storage.objects.get(`D:/Listings/Current/downloads/${unrelatedFileName}`)).toEqual(unrelatedFile);
    expect(prismaMocks.fileUpdate).toHaveBeenCalledOnce();
    expect(prismaMocks.fileUpdate).toHaveBeenCalledWith({
      where: { id: 10 },
      data: expect.objectContaining({
        localFileName: instructionFileName,
        etsyListingFileId: null,
        rawJson: { kind: 'dropbox_instruction_pdf', dropboxSharedUrl: newUrl },
      }),
    });
    expect(prismaMocks.fileDeleteMany).not.toHaveBeenCalled();
    expect(prismaMocks.transactionListingUpdateMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({ downloadsRevision: 4 }),
      data: expect.objectContaining({
        dropboxRevision: 4,
        downloadsChanged: true,
      }),
    }));
    const listingUpdate = prismaMocks.transactionListingUpdateMany.mock.calls[0]?.[0];
    expect(listingUpdate.data).not.toHaveProperty('downloadsRevision');
    expect(listing.downloadsRevision).toBe(4);
    expect([...storage.objects.keys()].some((key) => key.endsWith('.instruction.backup'))).toBe(false);
  });
});

describe('manual Dropbox instruction PDF storage', () => {
  function makeCurrentDropboxListing(files: Array<Record<string, unknown>>) {
    const listing = makeListing();
    return {
      ...listing,
      dropboxRevision: listing.downloadsRevision,
      dropboxSyncedAt: new Date(),
      dropboxBundle: {
        folderPath: '/grouped-listing-existing',
        sharedUrl: 'https://www.dropbox.com/scl/fo/current-link',
        instructions: 'Current instructions',
      },
      files,
    };
  }

  it('removes a newly-created PDF object when the database transaction fails', async () => {
    listingRecord.value = makeCurrentDropboxListing([]);
    prismaMocks.transactionListingUpdate.mockRejectedValueOnce(new Error('Simulated database failure'));

    await expect(createDropboxInstructionPdf(context)).rejects.toThrow('Simulated database failure');

    expect(prismaMocks.fileCreate).toHaveBeenCalledOnce();
    expect(storage.objects.has('D:/Listings/Current/downloads/CosyHousePrints_Download_Instructions.pdf')).toBe(false);
    expect([...storage.objects.keys()].some((key) => key.includes('.instruction.'))).toBe(false);
  });

  it('restores the previous PDF bytes when an update transaction fails', async () => {
    const fileName = 'CosyHousePrints_Download_Instructions.pdf';
    const previousPdf = Buffer.from('previous instruction PDF bytes');
    listingRecord.value = makeCurrentDropboxListing([{
      id: 12,
      localFileName: fileName,
      originalFileName: fileName,
      filename: fileName,
      rawJson: {
        kind: 'dropbox_instruction_pdf',
        dropboxSharedUrl: 'https://www.dropbox.com/scl/fo/previous-link',
      },
    }]);
    storage.objects.set(`D:/Listings/Current/downloads/${fileName}`, previousPdf);
    prismaMocks.transactionListingUpdate.mockRejectedValueOnce(new Error('Simulated database failure'));

    await expect(createDropboxInstructionPdf(context)).rejects.toThrow('Simulated database failure');

    expect(prismaMocks.fileUpdate).toHaveBeenCalledOnce();
    expect(storage.objects.get(`D:/Listings/Current/downloads/${fileName}`)).toEqual(previousPdf);
    expect([...storage.objects.keys()].some((key) => key.includes('.instruction.'))).toBe(false);
  });
});
