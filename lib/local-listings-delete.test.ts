import { createHash } from 'node:crypto';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ send: vi.fn(), shop: vi.fn(), section: vi.fn(), subsection: vi.fn(), listing: vi.fn(),
  otherListings: vi.fn(), current: vi.fn(), templates: vi.fn(), scenes: vi.fn(), pins: vi.fn(), orders: vi.fn(),
  transaction: vi.fn(), deleteMany: vi.fn(), dropbox: vi.fn() }));
vi.mock('@aws-sdk/client-s3', () => ({ S3Client: class { send = mocks.send; },
  CopyObjectCommand: class { constructor(readonly input: any) {} }, DeleteObjectCommand: class { constructor(readonly input: any) {} },
  DeleteObjectsCommand: class { constructor(readonly input: any) {} }, GetObjectCommand: class { constructor(readonly input: any) {} },
  HeadObjectCommand: class { constructor(readonly input: any) {} }, ListObjectsV2Command: class { constructor(readonly input: any) {} },
  PutObjectCommand: class { constructor(readonly input: any) {} },
}));
vi.mock('@/lib/prisma', () => ({ prisma: {
  etsyShop: { findUnique: mocks.shop }, etsyShopSection: { findFirst: mocks.section }, etsyShopSubSection: { findFirst: mocks.subsection },
  etsyListing: { findFirst: mocks.listing, findMany: mocks.otherListings, findUnique: mocks.current },
  ourCategoryImageTemplate: { findMany: mocks.templates }, pinterestPin: { findMany: mocks.pins }, etsyOrderItem: { findMany: mocks.orders },
  $queryRaw: mocks.scenes, $transaction: mocks.transaction,
} }));
vi.mock('@/lib/dropbox-bundle', () => ({ deleteDropboxBundleFolder: mocks.dropbox, isDropboxInstructionPdfFile: vi.fn() }));
import { deleteListing } from '@/lib/local-listings';

const root = 'Shop/Prints/Fox';
const source = `D:/Etsy/EtsyListings/${root}`;
const context = ['66615491', '2', '3', '79'] as const;
type Listing = ReturnType<typeof fixture>;
let listing: Listing | null;
let objects: Map<string, Buffer>;
let deletionFailure: string | null;
let databaseFailure: boolean;
let lostAcknowledgement: boolean;
let staleListing: boolean;

function fixture() {
  return { id: 79, shopId: '66615491', localDirectoryName: 'Fox', updatedAt: new Date('2026-11-21T13:00:00.000Z'),
    title: 'Generated Etsy title', etsyId: null as string | null, etsyCustomisedId: null as string | null,
    etsyDownloadId: null as string | null, state: 'local' as string | null, dropboxBundle: null as { folderPath: string } | null };
}
const etag = (contents: Buffer) => `"${createHash('md5').update(contents).digest('hex')}"`;
const missing = () => Object.assign(new Error('Missing'), { $metadata: { httpStatusCode: 404 } });
const precondition = () => Object.assign(new Error('Changed'), { $metadata: { httpStatusCode: 412 } });

beforeEach(() => {
  vi.resetAllMocks(); listing = fixture(); deletionFailure = null; databaseFailure = false; lostAcknowledgement = false; staleListing = false;
  objects = new Map([
    [root, Buffer.alloc(0)], [`${root}/`, Buffer.alloc(0)], [`${root}/thumbnail/`, Buffer.alloc(0)],
    [`${root}/thumbnail/art.png`, Buffer.from('source artwork')], [`${root}/manual.jpg`, Buffer.from('manual photo')],
    [`${root}/downloads/master.jpg`, Buffer.from('print master')], [`${root}/zipped/master.zip`, Buffer.from('ZIP')],
    [`${root}/video.mp4`, Buffer.from('video')], [`${root}/template-123.png`, Buffer.from('untracked generated photo')],
    [`.app-previews/${root}/thumbnail/art.png.webp`, Buffer.from('exact source preview')],
    [`.app-previews/${root}/manual.jpg.webp`, Buffer.from('exact manual preview')],
    [`.app-previews/${root}/downloads/master.jpg.webp`, Buffer.from('exact master preview')],
    [`.app-previews/${root}/template-123.png.webp`, Buffer.from('exact generated preview')],
    [`.app-previews/${root}/preview-only.png.webp`, Buffer.from('orphan preview')],
    ['Shop/Prints/Foxglove/thumbnail/art.png', Buffer.from('neighbour artwork')],
    ['.app-previews/Shop/Prints/Foxglove/thumbnail/art.png.webp', Buffer.from('neighbour preview')],
    ['OurTemplateImages/scene/source.png', Buffer.from('shared scene outside listing')],
  ]);
  mocks.shop.mockResolvedValue({ id: 1, etsyShopId: 66615491n, shopName: 'Shop', title: 'Shop title' });
  mocks.section.mockResolvedValue({ id: 2, title: 'Prints', etsyShopSectionId: '1234' });
  mocks.subsection.mockResolvedValue({ id: 3, name: 'Animals', shopSection: { title: 'Prints' } });
  mocks.listing.mockImplementation(async () => structuredClone(listing)); mocks.current.mockImplementation(async () => listing ? { id: listing.id } : null);
  mocks.otherListings.mockResolvedValue([]); mocks.templates.mockResolvedValue([]); mocks.scenes.mockResolvedValue([]); mocks.pins.mockResolvedValue([]); mocks.orders.mockResolvedValue([]);
  mocks.dropbox.mockResolvedValue(undefined);
  mocks.deleteMany.mockImplementation(async () => { if (staleListing) return { count: 0 }; listing = null; return { count: 1 }; });
  mocks.transaction.mockImplementation(async (operation) => {
    const previous = structuredClone(listing);
    try {
      await operation({ etsyShop: { findUnique: mocks.shop }, etsyShopSubSection: { findFirst: mocks.subsection }, etsyListing: { deleteMany: mocks.deleteMany } });
      if (databaseFailure) throw new Error('Database deletion failed');
    } catch (error) { listing = previous; throw error; }
    if (lostAcknowledgement) throw new Error('Commit acknowledgement lost');
  });
  mocks.send.mockImplementation(async (command) => {
    const input = command.input, name = command.constructor.name;
    if (name === 'ListObjectsV2Command') return { Contents: [...objects].filter(([key]) => key.startsWith(input.Prefix)).map(([Key, contents]) => ({ Key, Size: contents.length, ETag: etag(contents) })) };
    if (name === 'HeadObjectCommand') { const contents = objects.get(input.Key); if (!contents) throw missing(); return { ContentLength: contents.length, ETag: etag(contents) }; }
    if (name === 'GetObjectCommand') {
      const contents = objects.get(input.Key); if (!contents) throw missing(); if (input.IfMatch && input.IfMatch !== etag(contents)) throw precondition();
      return { ETag: etag(contents), Body: { transformToByteArray: async () => Buffer.from(contents) } };
    }
    if (name === 'DeleteObjectCommand') {
      if (input.Key === deletionFailure) throw new Error('S3 deletion failed');
      const contents = objects.get(input.Key); if (contents && input.IfMatch !== etag(contents)) throw precondition(); objects.delete(input.Key); return {};
    }
    if (name === 'PutObjectCommand') { if (input.IfNoneMatch === '*' && objects.has(input.Key)) throw precondition(); objects.set(input.Key, Buffer.from(input.Body)); return {}; }
    throw new Error(`Unexpected ${name}`);
  });
});

describe('local listing deletion with real storage rollback', () => {
  it('removes originals, exact previews, nested assets, markers and unregistered outputs before deleting DB rows', async () => {
    await deleteListing(...context);
    expect(listing).toBeNull();
    expect([...objects.keys()]).toEqual(['Shop/Prints/Foxglove/thumbnail/art.png', '.app-previews/Shop/Prints/Foxglove/thumbnail/art.png.webp', 'OurTemplateImages/scene/source.png']);
    expect(mocks.deleteMany).toHaveBeenCalledWith(expect.objectContaining({ where: expect.objectContaining({
      id: 79, shopId: '66615491', subSectionId: 3, localDirectoryName: 'Fox', updatedAt: fixture().updatedAt,
      etsyId: null, etsyDownloadId: null, etsyCustomisedId: null,
    }) }));
    const deletes = mocks.send.mock.calls.flatMap(([command], index) => command.constructor.name === 'DeleteObjectCommand' ? [mocks.send.mock.invocationCallOrder[index]] : []);
    expect(Math.max(...deletes)).toBeLessThan(mocks.deleteMany.mock.invocationCallOrder[0]);
  });

  it.each(['etsyId', 'etsyDownloadId', 'etsyCustomisedId', 'active', 'published'])('retains existing Etsy/publication guard: %s', async (guard) => {
    if (guard === 'active' || guard === 'published') listing!.state = guard; else listing![guard as 'etsyId'] = 'etsy-id';
    await expect(deleteListing(...context)).rejects.toThrow('Cannot delete'); expect(mocks.send).not.toHaveBeenCalled(); expect(mocks.transaction).not.toHaveBeenCalled();
  });

  it('allows a listing with no published state while enforcing canonical shop identity', async () => {
    listing!.shopId = 'wrong-shop'; await expect(deleteListing(...context)).rejects.toThrow('this shop'); expect(mocks.send).not.toHaveBeenCalled();
    listing = fixture(); listing.state = null; await deleteListing(...context); expect(listing).toBeNull();
    expect(mocks.deleteMany.mock.calls[0][0].where.OR).toEqual([{ state: null }, { state: { notIn: ['active', 'published'] } }]);
  });

  it('refuses a storage directory shared with another listing in any subsection', async () => {
    mocks.otherListings.mockResolvedValue([{ id: 80, localDirectoryName: 'fox' }]);
    await expect(deleteListing(...context)).rejects.toThrow('shares its storage folder'); expect(mocks.send).not.toHaveBeenCalled(); expect(listing).not.toBeNull();
  });

  it('preserves scene/template/Pinterest/order source files and their exact previews reused elsewhere', async () => {
    mocks.templates.mockResolvedValue([{ imagePath: `${source}/manual.jpg` }]);
    mocks.scenes.mockResolvedValue([{ imagePath: `${source}/downloads/master.jpg`, whiteImagePath: null, blackImagePath: null }]);
    mocks.pins.mockResolvedValue([{ creativeStorageKey: `${root}/template-123.png` }]);
    mocks.orders.mockResolvedValue([{ artworkUrl: `https://etsy-listings-216211142709-eu-west-2.s3.eu-west-2.amazonaws.com/${root}/thumbnail/art.png` }]);
    await deleteListing(...context); expect(listing).toBeNull();
    for (const key of [`${root}/manual.jpg`, `${root}/downloads/master.jpg`, `${root}/template-123.png`, `${root}/thumbnail/art.png`]) {
      expect(objects.has(key)).toBe(true); expect(objects.has(`.app-previews/${key}.webp`)).toBe(true);
    }
    expect(objects.has(`${root}/video.mp4`)).toBe(false); expect(objects.has(`${root}/zipped/master.zip`)).toBe(false);
  });

  it.each(['S3', 'database', 'stale', 'group reference'])('restores exact original/preview bytes and keeps DB row on %s failure', async (failure) => {
    const before = new Map(objects);
    if (failure === 'S3') deletionFailure = `${root}/manual.jpg`;
    if (failure === 'database') databaseFailure = true;
    if (failure === 'stale') staleListing = true;
    if (failure === 'group reference') mocks.deleteMany.mockRejectedValue(new Error('Listing is referenced by a grouped listing'));
    await expect(deleteListing(...context)).rejects.toThrow(); expect(listing).toEqual(fixture()); expect(objects).toEqual(before);
    if (failure === 'S3') expect(mocks.transaction).not.toHaveBeenCalled();
  });

  it('can retry after a failed storage deletion', async () => {
    deletionFailure = `${root}/manual.jpg`; await expect(deleteListing(...context)).rejects.toThrow('S3 deletion failed');
    deletionFailure = null; await deleteListing(...context); expect(listing).toBeNull(); expect(objects.has(`${root}/manual.jpg`)).toBe(false);
  });

  it('does not restore orphaned files when deletion committed but its acknowledgement was lost', async () => {
    lostAcknowledgement = true; await deleteListing(...context); expect(listing).toBeNull(); expect(objects.has(`${root}/thumbnail/art.png`)).toBe(false);
    expect(mocks.send.mock.calls.some(([command]) => command.constructor.name === 'PutObjectCommand')).toBe(false);
  });

  it('refuses changed storage context and restores objects before deleting the row', async () => {
    mocks.shop.mockResolvedValueOnce({ id: 1, etsyShopId: 66615491n, shopName: 'Shop', title: 'Shop title' })
      .mockResolvedValueOnce({ id: 1, etsyShopId: 66615491n, shopName: 'Changed shop', title: 'Shop title' });
    const before = new Map(objects); await expect(deleteListing(...context)).rejects.toThrow('storage location changed'); expect(listing).not.toBeNull(); expect(objects).toEqual(before);
  });

  it('keeps existing Dropbox cleanup order and retains listing/S3 if that operation fails', async () => {
    listing!.dropboxBundle = { folderPath: '/Prints/Fox' }; mocks.dropbox.mockRejectedValue(new Error('Dropbox deletion failed'));
    const before = new Map(objects); await expect(deleteListing(...context)).rejects.toThrow('Dropbox deletion failed'); expect(listing).not.toBeNull(); expect(objects).toEqual(before); expect(mocks.send).not.toHaveBeenCalled();
  });
});
