import { beforeEach, describe, expect, it, vi } from 'vitest';

const storage = vi.hoisted(() => ({ objects: new Map<string, Buffer>(), failDelete: null as string | null,
  discover: vi.fn(), reads: vi.fn(), deletes: vi.fn(), writes: vi.fn() }));
const db = vi.hoisted(() => ({ shop: vi.fn(), section: vi.fn(), subsection: vi.fn(), listing: vi.fn(),
  query: vi.fn(), deleteImages: vi.fn(), updateListing: vi.fn(), transaction: vi.fn(), render: vi.fn() }));
const directory = 'D:/Listings/Current';
function normal(filePath: string) { return filePath.replace(/\\/g, '/'); }
function preview(filePath: string) { return `.app-previews/${normal(filePath)}.webp`; }
function missing(filePath: string) { return Object.assign(new Error(`Missing ${filePath}`), { code: 'ENOENT' }); }

vi.mock('@/lib/local-shop-directory', () => ({ getListingDirectoryPath: () => 'D:/Listings/Current' }));
vi.mock('@/lib/prisma', () => ({ prisma: {
  etsyShop: { findUnique: db.shop }, etsyShopSection: { findFirst: db.section }, etsyShopSubSection: { findFirst: db.subsection },
  etsyListing: { findFirst: db.listing, update: db.updateListing }, etsyListingImage: { deleteMany: db.deleteImages },
  adminProductPrice: { findMany: vi.fn(async () => []) }, $queryRaw: db.query, $transaction: db.transaction,
} }));
vi.mock('@/lib/our-categories', () => ({ renderOurCategoryImageTemplate: db.render }));
vi.mock('@/lib/s3-listing-storage', () => ({
  mkdir: vi.fn(async () => undefined), listGeneratedListingImageFiles: storage.discover,
  readFile: vi.fn(async (filePath: string) => {
    const key = normal(filePath); storage.reads(key);
    const contents = storage.objects.get(key); if (!contents) throw missing(key); return Buffer.from(contents);
  }),
  unlink: vi.fn(async (filePath: string) => {
    const key = normal(filePath); storage.deletes(key);
    if (storage.failDelete === key) throw new Error('Storage delete failed');
    const removed = storage.objects.delete(key); const removedPreview = storage.objects.delete(preview(key));
    if (!removed && !removedPreview) throw missing(key);
  }),
  writeFile: vi.fn(async (filePath: string, contents: Buffer) => {
    const key = normal(filePath); storage.writes(key); storage.objects.set(key, Buffer.from(contents));
    storage.objects.set(preview(key), Buffer.from('restored preview'));
  }),
}));

import { deleteAllListingImages } from '@/lib/listing-editor';

const context = { shopId: '66', sectionId: '15', subSectionId: '27', listingId: '548' };
const registered = [{ id: 1, localFileName: 'manual.png' }, { id: 2, localFileName: 'template-7.png' }];
const preserved = [`${directory}/thumbnail/thumbnail.png`, `${directory}/downloads/template-8.png`, `${directory}/manual-untracked.png`, `${directory}/template-8.jpg`];

beforeEach(() => {
  vi.clearAllMocks(); storage.objects.clear(); storage.failDelete = null;
  for (const name of ['manual.png', 'template-7.png', 'template-8.png']) {
    storage.objects.set(`${directory}/${name}`, Buffer.from(name));
    storage.objects.set(preview(`${directory}/${name}`), Buffer.from(`preview ${name}`));
  }
  storage.objects.set(preview(`${directory}/template-9.png`), Buffer.from('preview-only orphan'));
  for (const key of preserved) storage.objects.set(key, Buffer.from('keep'));
  storage.discover.mockResolvedValue(['template-7.png', 'template-8.png', 'template-9.png']);
  db.shop.mockResolvedValueOnce({ id: 1, etsyShopId: 66n, shopName: 'Shop' }).mockResolvedValue(null);
  db.section.mockResolvedValue({ id: 15, title: 'Art' }); db.subsection.mockResolvedValue({ id: 27, name: 'Single' });
  db.listing.mockResolvedValue({ id: 548, localDirectoryName: 'Current', images: registered, ourCategory: null });
  db.query.mockResolvedValue([]); db.deleteImages.mockResolvedValue({ count: 2 }); db.updateListing.mockResolvedValue({ id: 548 });
  db.transaction.mockImplementation(async (operations: unknown[]) => {
    expect(storage.objects.has(`${directory}/manual.png`)).toBe(false);
    expect(storage.objects.has(`${directory}/template-7.png`)).toBe(false);
    expect(storage.objects.has(`${directory}/template-8.png`)).toBe(false);
    expect(storage.objects.has(preview(`${directory}/template-9.png`))).toBe(false);
    await Promise.all(operations);
  });
});

describe('normal listing image reset discovers orphan generated files', () => {
  it('removes tracked images, orphan generated originals and preview-only generated files before database deletion', async () => {
    // Stop at the editor reload after the real reset and transaction finish.
    await expect(deleteAllListingImages(context)).rejects.toThrow('images were removed, but the listing could not be reloaded');
    expect(storage.discover).toHaveBeenCalledExactlyOnceWith(directory);
    expect(storage.deletes.mock.calls.map(([key]) => key)).toEqual([
      `${directory}/manual.png`, `${directory}/template-7.png`, `${directory}/template-8.png`, `${directory}/template-9.png`,
    ]);
    expect([...storage.objects.keys()].sort()).toEqual([...preserved].sort());
    expect(db.deleteImages).toHaveBeenCalledExactlyOnceWith({ where: { listingId: 548 } });
    expect(db.updateListing).toHaveBeenCalledWith({ where: { id: 548 }, data: { imagesChanged: true, lastLocalChangeAt: expect.any(Date) } });
    expect(db.deleteImages.mock.invocationCallOrder[0]).toBeGreaterThan(storage.deletes.mock.invocationCallOrder.at(-1)!);
    expect(db.render).not.toHaveBeenCalled();
  });

  it('stops before deleting any files or rows when orphan discovery fails', async () => {
    storage.discover.mockRejectedValueOnce(new Error('Storage list failed'));
    await expect(deleteAllListingImages(context)).rejects.toThrow('Storage list failed');
    expect(storage.deletes).not.toHaveBeenCalled(); expect(db.deleteImages).not.toHaveBeenCalled();
    expect(db.transaction).not.toHaveBeenCalled(); expect(db.render).not.toHaveBeenCalled();
    expect(storage.objects.get(`${directory}/template-8.png`)?.toString()).toBe('template-8.png');
  });

  it('restores removed originals and leaves database rows intact if a later orphan deletion fails', async () => {
    storage.failDelete = `${directory}/template-8.png`;
    await expect(deleteAllListingImages(context)).rejects.toThrow('Storage delete failed');
    expect(db.deleteImages).not.toHaveBeenCalled(); expect(db.transaction).not.toHaveBeenCalled(); expect(db.render).not.toHaveBeenCalled();
    expect(storage.objects.get(`${directory}/manual.png`)?.toString()).toBe('manual.png');
    expect(storage.objects.get(`${directory}/template-7.png`)?.toString()).toBe('template-7.png');
    expect(storage.objects.get(`${directory}/template-8.png`)?.toString()).toBe('template-8.png');
    for (const key of preserved) expect(storage.objects.get(key)?.toString()).toBe('keep');
  });

  it('restores removed originals when the database transaction fails', async () => {
    db.transaction.mockRejectedValueOnce(new Error('Database delete failed'));
    await expect(deleteAllListingImages(context)).rejects.toThrow('Database delete failed');
    expect(storage.objects.get(`${directory}/manual.png`)?.toString()).toBe('manual.png');
    expect(storage.objects.get(`${directory}/template-7.png`)?.toString()).toBe('template-7.png');
    expect(storage.objects.get(`${directory}/template-8.png`)?.toString()).toBe('template-8.png');
    expect(db.render).not.toHaveBeenCalled();
  });

  it('cleans generated orphans even when there are no listing image rows left', async () => {
    db.listing.mockResolvedValueOnce({ id: 548, localDirectoryName: 'Current', images: [], ourCategory: null });
    db.transaction.mockImplementationOnce(async (operations: unknown[]) => Promise.all(operations));
    await expect(deleteAllListingImages(context)).rejects.toThrow('images were removed, but the listing could not be reloaded');
    expect(storage.objects.has(`${directory}/template-8.png`)).toBe(false);
    expect(storage.objects.has(preview(`${directory}/template-9.png`))).toBe(false);
    expect(storage.objects.has(`${directory}/manual.png`)).toBe(true);
    expect(db.deleteImages).toHaveBeenCalledExactlyOnceWith({ where: { listingId: 548 } });
  });
});
