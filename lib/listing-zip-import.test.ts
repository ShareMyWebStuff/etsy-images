import path from 'node:path';
import { crc32 } from 'node:zlib';
import sharp from 'sharp';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ shop: vi.fn(), section: vi.fn(), subsection: vi.fn(), target: vi.fn(), choices: vi.fn(),
  listings: vi.fn(), transaction: vi.fn(), create: vi.fn(), update: vi.fn(), page: vi.fn(), read: vi.fn(), write: vi.fn(), unlink: vi.fn(), readdir: vi.fn() }));
vi.mock('@/lib/prisma', () => ({ prisma: {
  etsyShop: { findUnique: mocks.shop }, etsyShopSection: { findFirst: mocks.section }, etsyShopSubSection: { findFirst: mocks.subsection },
  ourCategory: { findFirst: mocks.target, findMany: mocks.choices }, etsyListing: { findMany: mocks.listings }, $transaction: mocks.transaction,
} }));
vi.mock('@/lib/listing-table', () => ({ getSubSectionListingsPageData: mocks.page }));
vi.mock('@/lib/s3-listing-storage', () => ({ readFile: mocks.read, writeFile: mocks.write, unlink: mocks.unlink, readdir: mocks.readdir,
  rename: vi.fn(), mkdir: vi.fn(), stat: vi.fn(), rm: vi.fn(), copyFile: vi.fn() }));
import { getListingZipImportTemplates, importListingZip, prepareListingZipArtwork } from './listing-zip-import';

const context = { shopId: '66615491', sectionId: '2', subSectionId: '3' };
const now = new Date('2026-11-21T12:00:00.000Z');
type Row = Record<string, any>;
let rows: Row[];
let target: ReturnType<typeof template>;
let objects: Map<string, Buffer>;
let writeFailure: number;
let cleanupFailure: boolean;
let createFailure: number;
let loseAcknowledgement: boolean;
let unconfirmed: boolean;
let nextId: number;

function template(extra = {}) {
  return { id: 10, shopId: 1, name: 'Living Room', templateType: 'single', itemCount: 1, roomTheme: 'Countryside',
    printsFrames: true, customisePrints: false, digitalDownload: false, customTop: true, customBottom: true,
    sizes: { a4: true }, frames: { no_frame: true, black: false, white: false, oak: false },
    downloadSection: null as null | { etsyShopId: bigint; etsyShopSectionId: number }, updatedAt: now, ...extra };
}

function zip(entries: Array<[string, Buffer | string]>) {
  let offset = 0; const locals: Buffer[] = [], directory: Buffer[] = [];
  for (const [name, value] of entries) {
    const filename = Buffer.from(name), contents = Buffer.isBuffer(value) ? value : Buffer.from(value), checksum = crc32(contents);
    const local = Buffer.alloc(30); local.writeUInt32LE(0x04034b50); local.writeUInt16LE(20, 4); local.writeUInt16LE(0x800, 6);
    local.writeUInt32LE(checksum, 14); local.writeUInt32LE(contents.length, 18); local.writeUInt32LE(contents.length, 22); local.writeUInt16LE(filename.length, 26);
    locals.push(local, filename, contents);
    const central = Buffer.alloc(46); central.writeUInt32LE(0x02014b50); central.writeUInt16LE(20, 4); central.writeUInt16LE(20, 6); central.writeUInt16LE(0x800, 8);
    central.writeUInt32LE(checksum, 16); central.writeUInt32LE(contents.length, 20); central.writeUInt32LE(contents.length, 24); central.writeUInt16LE(filename.length, 28); central.writeUInt32LE(offset, 42);
    directory.push(central, filename); offset += local.length + filename.length + contents.length;
  }
  const central = Buffer.concat(directory), end = Buffer.alloc(22); end.writeUInt32LE(0x06054b50); end.writeUInt16LE(entries.length, 8); end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(central.length, 12); end.writeUInt32LE(offset, 16);
  return new File([Buffer.concat([...locals, central, end])], 'listings.zip', { type: 'application/zip' });
}
async function archive(csv = 'Title,Description,Filename\nFox,"First line\nSecond line",art.png', image?: Buffer, filename = 'art.png') {
  return zip([['overview.csv', csv], [filename, image ?? await sharp({ create: { width: 40, height: 50, channels: 3, background: '#ff3300' } }).png().toBuffer()]]);
}

beforeEach(() => {
  vi.resetAllMocks(); rows = []; target = template(); objects = new Map(); writeFailure = 0; cleanupFailure = false; createFailure = 0;
  loseAcknowledgement = false; unconfirmed = false; nextId = 100;
  mocks.shop.mockResolvedValue({ id: 1, etsyShopId: 66615491n, shopName: 'Shop', title: 'Shop title' });
  mocks.section.mockResolvedValue({ id: 2, title: 'Prints', etsyShopSectionId: '1234' });
  mocks.subsection.mockResolvedValue({ id: 3, name: 'Animals' });
  mocks.target.mockImplementation(async ({ where }) => where.id === target.id && where.shopId === target.shopId ? structuredClone(target) : null);
  mocks.choices.mockImplementation(async () => [{ id: target.id, name: target.name }]);
  mocks.readdir.mockResolvedValue([]);
  mocks.write.mockImplementation(async (filePath, contents) => {
    objects.set(filePath, Buffer.from(contents)); objects.set(`${filePath}.webp`, Buffer.from('preview'));
    if (writeFailure && mocks.write.mock.calls.length === writeFailure) throw new Error('S3 upload failed');
  });
  mocks.unlink.mockImplementation(async (filePath) => {
    if (cleanupFailure) throw new Error('S3 delete failed');
    objects.delete(filePath); objects.delete(`${filePath}.webp`);
  });
  mocks.listings.mockImplementation(async ({ where }) => {
    if (where.thumbnailFileName) {
      if (unconfirmed) throw new Error('Unable to confirm transaction');
      return rows.filter(row => where.thumbnailFileName.in.includes(row.thumbnailFileName)).map(row => ({ id: row.id, thumbnailFileName: row.thumbnailFileName }));
    }
    return rows.map(row => ({ title: row.title, localDirectoryName: row.localDirectoryName }));
  });
  mocks.create.mockImplementation(async ({ data }) => {
    if (createFailure && mocks.create.mock.calls.length === createFailure) throw new Error('Database creation failed');
    const row = { id: nextId++, ...data, etsyId: null, etsyDownloadId: null, productConfig: null, products: [] };
    rows.push(row); return { id: row.id };
  });
  mocks.update.mockImplementation(async ({ where, data }) => { Object.assign(rows.find(row => row.id === where.id)!, data); });
  mocks.page.mockImplementation(async () => ({ listings: rows.map(row => ({ id: String(row.id), listingName: row.title })) }));
  mocks.transaction.mockImplementation(async (operation) => {
    const before = structuredClone(rows);
    const tx = {
      $queryRaw: async () => [{ id: 2, title: 'Prints' }], etsyShop: { findUnique: mocks.shop }, etsyShopSubSection: { findFirst: mocks.subsection },
      ourCategory: { findFirst: mocks.target }, adminProductPrice: { findMany: async () => [] },
      etsyListing: { create: mocks.create, update: mocks.update, findMany: mocks.listings,
        findUnique: async ({ where }: any) => { const row = rows.find(row => row.id === where.id)!; return { ...row, ourCategory: target }; } },
      etsySkuAllocation: { upsert: async ({ where }: any) => ({ sequenceNumber: where.listingId }) },
      etsyListingProductConfig: { upsert: async ({ where, create, update }: any) => {
        const row = rows.find(row => row.id === where.listingId)!; row.productConfig = row.productConfig ? { ...row.productConfig, ...update } : create;
      } },
      etsyListingProduct: {
        findMany: async ({ where }: any) => typeof where.listingId === 'number' ? rows.find(row => row.id === where.listingId)!.products : [],
        deleteMany: async () => ({ count: 0 }), update: async () => ({}),
        upsert: async ({ create }: any) => { rows.find(row => row.id === create.listingId)!.products.push(create); },
      },
    };
    let result;
    try { result = await operation(tx); } catch (error) { rows = before; throw error; }
    if (loseAcknowledgement) throw new Error('Commit response lost');
    return result;
  });
});

describe('ZIP import preflight', () => {
  it('offers only same-shop single-item templates after full context validation', async () => {
    expect(await getListingZipImportTemplates(context)).toEqual({ templates: [{ id: '10', name: 'Living Room', templateType: 'single', itemCount: 1 }] });
    expect(mocks.choices).toHaveBeenCalledWith(expect.objectContaining({ where: { shopId: 1, templateType: 'single', itemCount: 1 } }));
    mocks.subsection.mockResolvedValueOnce(null);
    await expect(getListingZipImportTemplates(context)).rejects.toMatchObject({ status: 404 });
  });

  it.each(['99', 'invalid'])('rejects wrong-shop/missing or invalid template ID %s before writes', async (id) => {
    await expect(importListingZip(context, id, await archive())).rejects.toMatchObject({ status: id === '99' ? 404 : 400 });
    expect(mocks.write).not.toHaveBeenCalled(); expect(mocks.transaction).not.toHaveBeenCalled();
  });

  it('rejects grouped templates and invalid digital template sections before writes', async () => {
    target.templateType = 'multiple'; target.itemCount = 3;
    await expect(importListingZip(context, '10', await archive())).rejects.toThrow('single-item');
    target = template({ digitalDownload: true });
    await expect(importListingZip(context, '10', await archive())).rejects.toThrow('Digital Download'); expect(mocks.write).not.toHaveBeenCalled();
  });

  it.each([
    ['x'.repeat(101), 'description', '1 to 100'], ['CON', 'description', 'folder name'],
    ['Fox.', 'description', 'folder name'], ['Fox', 'x'.repeat(1001), '1000 characters'],
  ])('rejects row-specific title/text violations without truncation: %s', async (title, description, error) => {
    await expect(importListingZip(context, '10', await archive(`Title,Description,Filename\n${title},${description},art.png`))).rejects.toThrow(`CSV row 2:`);
    await expect(importListingZip(context, '10', await archive(`Title,Description,Filename\n${title},${description},art.png`))).rejects.toThrow(error);
    expect(mocks.write).not.toHaveBeenCalled();
  });

  it('checks DB names across the section, including remote-only rows, before staging', async () => {
    rows = [{ title: 'FOX', localDirectoryName: 'Different name' }];
    await expect(importListingZip(context, '10', await archive())).rejects.toMatchObject({ status: 409 });
    expect(mocks.listings).toHaveBeenCalledWith(expect.objectContaining({ where: { shopId: '66615491', OR: [
      { subSection: { is: { shopSectionId: 2 } } }, { subSectionId: null, shopSectionId: 1234 },
    ] } })); expect(mocks.write).not.toHaveBeenCalled();
  });

  it.each([0, 1])('checks existing original or preview-only S3 folder names case-insensitively: %s', async (index) => {
    mocks.readdir.mockResolvedValueOnce(index === 0 ? ['fOx'] : []).mockResolvedValueOnce(index === 1 ? ['fOx'] : []);
    await expect(importListingZip(context, '10', await archive())).rejects.toMatchObject({ status: 409 }); expect(mocks.write).not.toHaveBeenCalled();
  });

  it('validates every image before writing even the first valid row', async () => {
    const valid = await sharp({ create: { width: 40, height: 50, channels: 3, background: '#ff0000' } }).png().toBuffer();
    const file = zip([['overview.csv', 'Title,Description,Filename\nFox,one,fox.png\nOwl,two,owl.png'], ['fox.png', valid], ['owl.png', 'not an image']]);
    await expect(importListingZip(context, '10', file)).rejects.toThrow('CSV row 3:'); expect(mocks.write).not.toHaveBeenCalled();
  });

  it('rejects filename/content mismatches and oversized input before writes', async () => {
    const png = await sharp({ create: { width: 40, height: 50, channels: 3, background: '#ff0000' } }).png().toBuffer();
    await expect(importListingZip(context, '10', await archive('Title,Description,Filename\nFox,one,art.jpg', png, 'art.jpg'))).rejects.toThrow('filename extension');
    const file = await archive(); Object.defineProperty(file, 'size', { value: 400 * 1024 * 1024 + 1 });
    await expect(importListingZip(context, '10', file)).rejects.toThrow('400 MB'); expect(mocks.write).not.toHaveBeenCalled();
  });

  it('reports unreadable image headers separately from an actual pixel limit', async () => {
    await expect(importListingZip(context, '10', await archive(undefined, Buffer.from('not an image')))).rejects.toThrow('CSV row 2: The artwork headers in "art.png" could not be read');
    expect(mocks.write).not.toHaveBeenCalled();
  });

  it('reports actual format and dimensions when the default manual-upload pixel guard is exceeded', async () => {
    // A valid PNG header is enough to exercise the guard before allocating or decoding huge pixels.
    const png = await sharp({ create: { width: 4, height: 5, channels: 3, background: '#ff0000' } }).png().toBuffer();
    png.writeUInt32BE(20_000, 16); png.writeUInt32BE(20_000, 20); png.writeUInt32BE(crc32(png.subarray(12, 29)), 29);
    await expect(importListingZip(context, '10', await archive(undefined, png))).rejects.toMatchObject({ status: 400,
      message: expect.stringContaining('PNG artwork "art.png" is 20000 × 20000 (400.0 MP), which exceeds the safe image limit used by manual uploads') });
    expect(mocks.write).not.toHaveBeenCalled(); expect(mocks.transaction).not.toHaveBeenCalled();
  });

  it('fully validates an unrotated PNG while preserving its exact original bytes and colour profile', async () => {
    const source = await sharp({ create: { width: 48, height: 60, channels: 3, background: '#aa3311' } }).withIccProfile('srgb').png({ compressionLevel: 9, adaptiveFiltering: true }).toBuffer();
    const prepared = await prepareListingZipArtwork({ rowNumber: 2, relativeFilename: 'art.png', originalFileName: 'art.png', image: source });
    expect(prepared.contents).toBe(source); expect(prepared).toMatchObject({ width: 48, height: 60, orientation: 'portrait' });
    await expect(sharp(prepared.contents).metadata()).resolves.toMatchObject({ hasProfile: true });
    expect(mocks.write).not.toHaveBeenCalled(); expect(mocks.transaction).not.toHaveBeenCalled();
  });

  it('rejects a truncated PNG whose dimensions can be read but whose pixels cannot be decoded', async () => {
    const source = await sharp({ create: { width: 40, height: 50, channels: 3, background: '#aa3311' } }).png().toBuffer();
    const idat = source.indexOf(Buffer.from('IDAT'));
    const truncated = source.subarray(0, idat + 8);
    await expect(sharp(truncated, { failOn: 'error', limitInputPixels: false }).metadata()).resolves.toMatchObject({ format: 'png', width: 40, height: 50 });
    await expect(importListingZip(context, '10', await archive(undefined, truncated))).rejects.toMatchObject({ status: 400,
      message: expect.stringContaining('PNG artwork "art.png" (40 × 50) could not be decoded') });
    expect(mocks.write).not.toHaveBeenCalled(); expect(mocks.transaction).not.toHaveBeenCalled();
  });
});

describe('atomic ZIP import and storage ownership', () => {
  it('uses the actual parser, image normalization, local defaults and products in one batch transaction', async () => {
    const file = await archive('Title,Description,Filename\nFox,"First line\nSecond line",art.png\nOwl,Another description,art.png');
    const result = await importListingZip(context, '10', file);
    expect(result).toMatchObject({ importedCount: 2, listingIds: ['100', '101'] }); expect(mocks.transaction).toHaveBeenCalledOnce();
    expect(rows).toHaveLength(2); expect(rows[0]).toMatchObject({ title: 'Fox', localDirectoryName: 'Fox', description: 'First line\nSecond line', listingDescription: 'First line\nSecond line',
      shopId: '66615491', subSectionId: 3, ourCategoryId: 10, backgroundColour: '#F5F0E8', artworkOrientation: 'portrait', thumbnailWidthPixels: 40, thumbnailHeightPixels: 50,
      quantity: 999, priceDivisor: 100, priceCurrencyCode: 'GBP', state: 'local', isLocal: true, numberOfItems: 1, includeAllItems: false, etsyProductType: 'physical' });
    expect(rows[0].productConfig).toMatchObject({ listOnEtsy: true, digitalDownload: false, printsFrames: true, customisePrints: false, sku: 'SKU_000100' });
    expect(rows[0].products).toMatchObject([{ productKey: 'unframed_a4', etsyListingId: null }]);
    expect(rows[0].thumbnailFileName).toMatch(/^import-[a-f0-9-]{36}\.png$/); expect(rows[1].thumbnailFileName).not.toBe(rows[0].thumbnailFileName);
    expect(objects.size).toBe(4); expect(mocks.unlink).not.toHaveBeenCalled();
    expect(mocks.write.mock.invocationCallOrder.at(-1)!).toBeLessThan(mocks.transaction.mock.invocationCallOrder[0]);
  });

  it('rotates EXIF JPEGs, writes matching PNG names, and accepts a valid nonstandard aspect ratio', async () => {
    const source = await sharp({ create: { width: 30, height: 60, channels: 3, background: '#ff0000' } }).withMetadata({ orientation: 6 }).jpeg().toBuffer();
    await importListingZip(context, '10', await archive('Title,Description,Filename\nFox,one,art.jpg', source, 'art.jpg'));
    expect(rows[0]).toMatchObject({ artworkOrientation: 'landscape', thumbnailWidthPixels: 60, thumbnailHeightPixels: 30, thumbnailOriginalFileName: 'art.jpg' });
    const metadata = await sharp(mocks.write.mock.calls[0][1]).metadata(); expect(metadata).toMatchObject({ format: 'png', width: 60, height: 30 }); expect(metadata.orientation).toBeUndefined();
  });

  it('accepts the user archive artwork size of 7200 × 9000 and preserves every pixel dimension', async () => {
    const source = await sharp({ create: { width: 7200, height: 9000, channels: 3, background: '#aa3311' } }).png().toBuffer();
    await importListingZip(context, '10', await archive(undefined, source));
    expect(rows[0]).toMatchObject({ artworkOrientation: 'portrait', thumbnailWidthPixels: 7200, thumbnailHeightPixels: 9000 });
    await expect(sharp(mocks.write.mock.calls[0][1]).metadata()).resolves.toMatchObject({ format: 'png', width: 7200, height: 9000 });
  }, 20_000);

  it('inherits digital-only template products, prices and SKU defaults without physical products', async () => {
    target = template({ printsFrames: false, digitalDownload: true, downloadSection: { etsyShopId: 66615491n, etsyShopSectionId: 123456 } });
    await importListingZip(context, '10', await archive());
    expect(rows[0]).toMatchObject({ etsyProductType: 'digital', taxonomyId: 2078 });
    expect(rows[0].productConfig).toMatchObject({ listOnEtsy: true, digitalDownload: true, printsFrames: false, downloadSectionId: 123456, sku: 'SKU_000100' });
    expect(rows[0].products).toMatchObject([{ productKey: 'digital', productType: 'digital', priceKey: 'digital_1' }]); expect(rows[0].products).toHaveLength(1);
  });

  it.each(['storage', 'database'])('cleans only owned original/WebP uploads and rolls back all listing rows on %s failure', async (failure) => {
    const file = await archive('Title,Description,Filename\nFox,one,art.png\nOwl,two,art.png');
    objects.set('unrelated.png', Buffer.from('keep')); if (failure === 'storage') writeFailure = 2; else createFailure = 2;
    await expect(importListingZip(context, '10', file)).rejects.toThrow(failure === 'storage' ? 'S3 upload failed' : 'Database creation failed');
    expect(rows).toEqual([]); expect([...objects.keys()]).toEqual(['unrelated.png']); expect(mocks.unlink).toHaveBeenCalledTimes(2);
  });

  it('reports a cleanup failure instead of silently leaving staged artwork', async () => {
    writeFailure = 1; cleanupFailure = true;
    await expect(importListingZip(context, '10', await archive())).rejects.toMatchObject({ status: 503, message: expect.stringContaining('Cleanup must be retried') }); expect(rows).toEqual([]);
  });

  it('rechecks section-wide duplicates in the transaction and removes staged files on a concurrent conflict', async () => {
    mocks.listings.mockResolvedValueOnce([]).mockResolvedValueOnce([{ title: 'fOx', localDirectoryName: null }]);
    await expect(importListingZip(context, '10', await archive())).rejects.toMatchObject({ status: 409 }); expect(rows).toEqual([]); expect(objects.size).toBe(0);
  });

  it.each(['shop', 'template'])('cleans staged artwork when the %s changes after preflight', async (change) => {
    if (change === 'shop') mocks.shop.mockResolvedValueOnce({ id: 1, etsyShopId: 66615491n, shopName: 'Shop', title: 'Shop title' })
      .mockResolvedValueOnce({ id: 1, etsyShopId: 66615491n, shopName: 'Renamed shop', title: 'Shop title' });
    else mocks.target.mockResolvedValueOnce(structuredClone(target)).mockResolvedValueOnce({ ...target, updatedAt: new Date(now.getTime() + 1000) });
    await expect(importListingZip(context, '10', await archive())).rejects.toMatchObject({ status: 409 }); expect(rows).toEqual([]); expect(objects.size).toBe(0);
  });

  it('does not unlink committed artwork when a commit acknowledgement is lost', async () => {
    loseAcknowledgement = true;
    expect(await importListingZip(context, '10', await archive())).toMatchObject({ importedCount: 1, listingIds: ['100'] });
    expect(rows).toHaveLength(1); expect(objects.size).toBe(2); expect(mocks.unlink).not.toHaveBeenCalled();
  });

  it('uses canonical shop identity to protect committed artwork when input IDs have leading zeros', async () => {
    loseAcknowledgement = true;
    expect(await importListingZip({ ...context, shopId: '00066615491' }, '10', await archive())).toMatchObject({ importedCount: 1 });
    expect(mocks.listings).toHaveBeenLastCalledWith(expect.objectContaining({ where: expect.objectContaining({ shopId: '66615491', thumbnailFileName: { in: expect.any(Array) } }) }));
    expect(objects.size).toBe(2); expect(mocks.unlink).not.toHaveBeenCalled();
  });

  it('retains potentially committed artwork when commit ownership cannot be checked', async () => {
    loseAcknowledgement = true; unconfirmed = true;
    await expect(importListingZip(context, '10', await archive())).rejects.toMatchObject({ status: 503 }); expect(objects.size).toBe(2); expect(mocks.unlink).not.toHaveBeenCalled();
  });

  it.each([null, new Error('Database reload failed')])('preserves committed rows/artwork and explains a page reload failure: %s', async (failure) => {
    if (failure instanceof Error) mocks.page.mockRejectedValue(failure); else mocks.page.mockResolvedValue(null);
    await expect(importListingZip(context, '10', await archive())).rejects.toMatchObject({ status: 503, message: expect.stringContaining('were imported') });
    expect(rows).toHaveLength(1); expect(objects.size).toBe(2); expect(mocks.unlink).not.toHaveBeenCalled();
  });
});
