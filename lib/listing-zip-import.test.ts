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
import { getListingZipImportTemplates, importListingZip, insertListingZipReviewRow, prepareListingZipArtwork, prepareListingZipReview } from './listing-zip-import';
import { createListingPrintCropSettings, defaultNativeListingPrintCropDraft, listingPrintCropDraftForSave,
  parseCurrentListingPrintCropSettings, PRINT_CROP_RATIOS } from '@/lib/listing-print-crops';

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
      const owners = rows.filter(row => where.thumbnailFileName.in.includes(row.thumbnailFileName));
      if (unconfirmed && owners.length) throw new Error('Unable to confirm transaction');
      return owners.map(row => ({ id: row.id, shopId: row.shopId, subSectionId: row.subSectionId,
        localDirectoryName: row.localDirectoryName, thumbnailFileName: row.thumbnailFileName }));
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
    const file = await archive(); Object.defineProperty(file, 'size', { value: 500 * 1024 * 1024 + 1 });
    await expect(importListingZip(context, '10', file)).rejects.toThrow('500 MB'); expect(mocks.write).not.toHaveBeenCalled();
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

describe('sequential ZIP review preparation and insertion', () => {
  it.each([
    { source: 'current title', title: 'FOX', localDirectoryName: 'Different folder' },
    { source: 'original uploaded title after renaming', title: 'A new generated listing title', localDirectoryName: 'Fox' },
  ])('keeps an existing $source visible as a blocked review row while another listing can be inserted', async ({ title, localDirectoryName }) => {
    rows = [{ id: 90, title, localDirectoryName }];
    const plan = await prepareListingZipReview(context, '10', await archive('Title,Description,Filename\n fOx ,Previously uploaded artwork,art.png\nOwl,A new listing,art.png'));
    const duplicate = plan.rows[0];
    expect(duplicate).toMatchObject({ title: 'fOx', description: 'Previously uploaded artwork', width: 40, height: 50,
      error: 'CSV row 2: A listing or folder named "fOx" already exists in this section. Choose Skip to continue.', contents: expect.any(Buffer) });
    expect(await sharp(duplicate.contents).metadata()).toMatchObject({ format: 'png', width: 40, height: 50 });
    expect(mocks.listings).toHaveBeenCalledWith({ where: { shopId: '66615491', OR: [
      { subSection: { is: { shopSectionId: 2 } } }, { subSectionId: null, shopSectionId: 1234 },
    ] }, select: { title: true, localDirectoryName: true } });
    await expect(insertListingZipReviewRow(plan, 0)).rejects.toMatchObject({ status: 409, message: duplicate.error });
    expect(mocks.write).not.toHaveBeenCalled(); expect(mocks.transaction).not.toHaveBeenCalled();
    expect(plan.rows[1]).toMatchObject({ title: 'Owl', error: null });
    expect(await insertListingZipReviewRow(plan, 1)).toEqual({ listingIds: ['100'] });
    expect(rows).toHaveLength(2); expect(rows[1].title).toBe('Owl');
    expect(mocks.write).toHaveBeenCalledOnce();
  });

  it('reviews repeated CSV titles with their own images and blocks only later duplicates without rejecting the ZIP', async () => {
    const fox = await sharp({ create: { width: 40, height: 50, channels: 3, background: '#ff3300' } }).png().toBuffer();
    const owl = await sharp({ create: { width: 60, height: 40, channels: 3, background: '#0055bb' } }).png().toBuffer();
    const plan = await prepareListingZipReview(context, '10', zip([
      ['overview.csv', 'Title,Description,Filename\nFox,First artwork,fox.png\nfOx,Repeated title different artwork,owl.png\nOwl,Unique artwork,owl.png'],
      ['fox.png', fox], ['owl.png', owl],
    ]));
    expect(plan.rows[0]).toMatchObject({ error: null, title: 'Fox', contents: fox });
    expect(plan.rows[1]).toMatchObject({ title: 'fOx', description: 'Repeated title different artwork', contents: owl, width: 60, height: 40,
      error: 'CSV row 3: The title "fOx" duplicates another row in this ZIP. Choose Skip to continue.' });
    expect(plan.rows[2]).toMatchObject({ title: 'Owl', error: null, contents: owl });
    await expect(insertListingZipReviewRow(plan, 1)).rejects.toMatchObject({ status: 409 });
    expect(mocks.write).not.toHaveBeenCalled(); expect(mocks.transaction).not.toHaveBeenCalled();
  });

  it('shows an oversized image as a preview-only blocked row and still allows a later valid listing', async () => {
    const original = await sharp({ create: { width: 1800, height: 2400, channels: 3, background: '#bc7b54' } }).png().toBuffer();
    const oversized = Buffer.alloc(60 * 1024 * 1024 + 1); original.copy(oversized);
    const valid = await sharp({ create: { width: 40, height: 50, channels: 3, background: '#ff3300' } }).png().toBuffer();
    const file = zip([
      ['overview.csv', 'Title,Description,Filename\nLarge art,Review and skip,large.png\nSmall art,Ready to insert,small.png'],
      ['large.png', oversized], ['small.png', valid],
    ]);
    const plan = await prepareListingZipReview(context, '10', file);
    const rejected = plan.rows[0];
    expect(rejected).toMatchObject({ title: 'Large art', description: 'Review and skip', width: 1800, height: 2400, orientation: 'portrait',
      error: expect.stringMatching(/Skipping this image.*60 MB per-image limit.*Choose Skip/) });
    expect(rejected.error).toContain('60.1 MB');
    expect(rejected.contents).toBeUndefined(); expect(rejected.fileName).toBeUndefined(); expect(rejected.filePath).toBeUndefined();
    expect(rejected).not.toHaveProperty('image');
    expect(rejected.previewContents!.length).toBeLessThan(1024 * 1024);
    expect(await sharp(rejected.previewContents).metadata()).toMatchObject({ format: 'webp', width: 750, height: 1000 });
    expect(plan.rows[1]).toMatchObject({ title: 'Small art', error: null, contents: expect.any(Buffer) });
    await expect(insertListingZipReviewRow(plan, 0)).rejects.toMatchObject({ status: 400, message: rejected.error });
    expect(mocks.write).not.toHaveBeenCalled(); expect(mocks.transaction).not.toHaveBeenCalled();
    expect(await insertListingZipReviewRow(plan, 1)).toEqual({ listingIds: ['100'] });
    expect(rows.map(row => row.title)).toEqual(['Small art']);
    expect(mocks.write).toHaveBeenCalledOnce(); expect(mocks.write.mock.calls[0][1]).toEqual(valid);
  });

  it('prepares row metadata, previews and skippable collision/decode/text errors without creating listings or storage', async () => {
    rows = [{ title: 'FOX', localDirectoryName: 'Existing fox' }];
    const valid = await sharp({ create: { width: 40, height: 50, channels: 3, background: '#ff3300' } }).png().toBuffer();
    const file = zip([
      ['overview.csv', `Title,Description,Filename\nFox,Existing listing,art.png\nOwl,Invalid image,broken.png\nDeer,${'x'.repeat(1001)},art.png\nRabbit,Ready to insert,art.png`],
      ['art.png', valid], ['broken.png', 'invalid image'],
    ]);
    const plan = await prepareListingZipReview(context, '10', file);
    expect(plan.target).toMatchObject({ id: 10, name: 'Living Room' }); expect(plan.input).toEqual(context);
    expect(plan.rows.map(({ title, rowNumber }) => ({ title, rowNumber }))).toEqual([
      { title: 'Fox', rowNumber: 2 }, { title: 'Owl', rowNumber: 3 }, { title: 'Deer', rowNumber: 4 }, { title: 'Rabbit', rowNumber: 5 },
    ]);
    expect(plan.rows[0]).toMatchObject({ width: 40, height: 50, orientation: 'portrait', error: expect.stringContaining('already exists'), contents: expect.any(Buffer) });
    expect(plan.rows[1]).toMatchObject({ width: null, height: null, orientation: null, error: expect.stringContaining('headers') }); expect(plan.rows[1].contents).toBeUndefined();
    expect(plan.rows[2].error).toContain('1000 characters'); expect(plan.rows[2].contents).toBeInstanceOf(Buffer);
    expect(plan.rows[3]).toMatchObject({ error: null, title: 'Rabbit', description: 'Ready to insert', relativeFilename: 'art.png', originalFileName: 'art.png', contents: expect.any(Buffer) });
    for (const row of plan.rows) expect(row).not.toHaveProperty('image');
    expect(mocks.write).not.toHaveBeenCalled(); expect(mocks.transaction).not.toHaveBeenCalled(); expect(mocks.page).not.toHaveBeenCalled();
    expect(rows).toHaveLength(1);
  });

  it('inserts only the chosen row with inherited defaults, and returns IDs without a table reload', async () => {
    const plan = await prepareListingZipReview(context, '10', await archive('Title,Description,Filename\nFox,First row,art.png\nOwl,Reviewed row,art.png'));
    mocks.page.mockRejectedValue(new Error('Table reload should belong to the session layer'));
    expect(await insertListingZipReviewRow(plan, 1)).toEqual({ listingIds: ['100'] });
    expect(rows).toHaveLength(1); expect(rows[0]).toMatchObject({ title: 'Owl', description: 'Reviewed row', listingDescription: 'Reviewed row', ourCategoryId: 10, backgroundColour: '#F5F0E8' });
    expect(rows[0].productConfig).toMatchObject({ printsFrames: true, digitalDownload: false, customisePrints: false, sku: 'SKU_000100' });
    expect(mocks.write).toHaveBeenCalledOnce(); expect(mocks.write.mock.calls[0][0]).toBe(plan.rows[1].filePath); expect(mocks.page).not.toHaveBeenCalled();
    expect(plan.rows[0].contents).toBeInstanceOf(Buffer);
  });

  it('prepares nonpersisted Set Size defaults without creating artwork, crop records or listings', async () => {
    const plan = await prepareListingZipReview(context, '10', await archive());
    expect(plan.rows[0].initialCropSettings).toEqual(listingPrintCropDraftForSave(defaultNativeListingPrintCropDraft(40, 50)));
    expect(plan.rows[0].cropError).toBeUndefined(); expect(plan.rows[0].insertion).toBeUndefined();
    expect(rows).toEqual([]); expect(objects.size).toBe(0); expect(mocks.transaction).not.toHaveBeenCalled();
  });

  it.each([[300, 300], [202, 300], [300, 202]])('retains unsupported or near-native %i × %i artwork for Skip without exposing invalid crop defaults', async (width, height) => {
    const source = await sharp({ create: { width, height, channels: 3, background: '#aa3311' } }).png().toBuffer();
    const plan = await prepareListingZipReview(context, '10', await archive(undefined, source));
    expect(plan.rows[0]).toMatchObject({ contents: source, width, height, error: null,
      cropError: expect.stringMatching(/Set Size supports 2:3 or 4:5.*Choose Skip/) });
    expect(plan.rows[0].initialCropSettings).toBeUndefined();
    await expect(insertListingZipReviewRow(plan, 0, { requireCropSettings: true, cropSettings: {} })).rejects.toMatchObject({ status: 400 });
    expect(mocks.write).not.toHaveBeenCalled(); expect(mocks.transaction).not.toHaveBeenCalled();
  });

  it.each(['portrait', 'landscape'] as const)('atomically persists all six individually chosen %s 4:5 crops with exact thumbnail identity', async (orientation) => {
    const [width, height] = orientation === 'portrait' ? [80, 100] : [100, 80];
    const source = await sharp({ create: { width, height, channels: 3, background: '#ff3300' } }).png().toBuffer();
    const plan = await prepareListingZipReview(context, '10', await archive(undefined, source));
    const draft = structuredClone(plan.rows[0].initialCropSettings!);
    for (const [index, { key }] of PRINT_CROP_RATIOS.entries()) {
      const region = draft.regions[key];
      region.x = index % 2 ? Math.max(0, 1 - region.width) : Math.min(0, 1 - region.width);
    }
    expect(await insertListingZipReviewRow(plan, 0, { requireCropSettings: true, cropSettings: draft })).toEqual({ listingIds: ['100'] });
    const inserted = rows[0];
    const expected = createListingPrintCropSettings(draft, { width, height, fileName: inserted.thumbnailFileName,
      updatedAt: inserted.thumbnailUpdatedAt.toISOString() }, orientation);
    expect(inserted.printCropSettings).toEqual(expected);
    expect(inserted.printCropSettings.version).toBe(4);
    expect(inserted.printCropSettings.source.updatedAt).toBe(inserted.thumbnailUpdatedAt.toISOString());
    expect(parseCurrentListingPrintCropSettings(inserted.printCropSettings, { fileName: inserted.thumbnailFileName,
      updatedAt: inserted.thumbnailUpdatedAt.toISOString(), orientation })).toEqual(expected);
    expect(mocks.transaction).toHaveBeenCalledOnce(); expect(mocks.write).toHaveBeenCalledOnce();
    expect(objects.get(plan.rows[0].filePath!)!.equals(source)).toBe(true);
    if (orientation === 'landscape') {
      expect(expected.regions['2x3'].x).toBeLessThan(0);
      expect(expected.placements['2x3'].width).toBeLessThan(1);
    }
  });

  it('persists native 2:3 crop selections without coupling the six ratio placements', async () => {
    const source = await sharp({ create: { width: 60, height: 90, channels: 3, background: '#ff3300' } }).png().toBuffer();
    const plan = await prepareListingZipReview(context, '10', await archive(undefined, source));
    const draft = structuredClone(plan.rows[0].initialCropSettings!);
    draft.regions['5x7'].y = 0;
    draft.placements!['5x7'].y = 0;
    await insertListingZipReviewRow(plan, 0, { requireCropSettings: true, cropSettings: draft });
    expect(rows[0].printCropSettings).toMatchObject({ version: 3, orientation: 'portrait', regions: draft.regions, placements: draft.placements });
  });

  it.each([undefined, null, {}, { regions: {} }])('rejects missing or malformed reviewed crops before writes and allows correction: %j', async (cropSettings) => {
    const plan = await prepareListingZipReview(context, '10', await archive());
    await expect(insertListingZipReviewRow(plan, 0, { requireCropSettings: true, cropSettings })).rejects.toMatchObject({ status: 400,
      message: expect.stringMatching(/CSV row 2:.*Set Size/) });
    expect(plan.rows[0].insertion).toBeUndefined(); expect(mocks.write).not.toHaveBeenCalled(); expect(mocks.transaction).not.toHaveBeenCalled();
    await insertListingZipReviewRow(plan, 0, { requireCropSettings: true, cropSettings: plan.rows[0].initialCropSettings });
    expect(rows).toHaveLength(1); expect(rows[0].printCropSettings.version).toBe(4);
  });

  it('rolls back crop persistence and artwork together, retaining the first validated payload for retry', async () => {
    const plan = await prepareListingZipReview(context, '10', await archive());
    const chosen = structuredClone(plan.rows[0].initialCropSettings!);
    chosen.regions['2x3'].x = 0;
    let failedCropUpdate = false;
    mocks.update.mockImplementation(async ({ where, data }) => {
      Object.assign(rows.find((row) => row.id === where.id)!, data);
      if (data.printCropSettings && !failedCropUpdate) {
        failedCropUpdate = true;
        throw new Error('Crop persistence failed');
      }
    });
    await expect(insertListingZipReviewRow(plan, 0, { requireCropSettings: true, cropSettings: chosen })).rejects.toThrow('Crop persistence failed');
    const frozen = structuredClone(plan.rows[0].insertion);
    expect(rows).toEqual([]); expect(objects.size).toBe(0);
    expect(mocks.update.mock.calls.find(([value]) => value.data.printCropSettings)![0].data.printCropSettings).toEqual(frozen!.cropSettings);
    const changed = structuredClone(chosen); changed.regions['2x3'].x = 1 - changed.regions['2x3'].width;
    await insertListingZipReviewRow(plan, 0, { requireCropSettings: true, cropSettings: changed });
    expect(rows[0].printCropSettings).toEqual(frozen!.cropSettings);
    expect(rows[0].thumbnailUpdatedAt.toISOString()).toBe(frozen!.thumbnailUpdatedAt);
  });

  it.each(['missing', 'changed'])('recovers committed crop identity before inspecting a %s retry payload', async (retry) => {
    const plan = await prepareListingZipReview(context, '10', await archive());
    const chosen = structuredClone(plan.rows[0].initialCropSettings!); chosen.regions['2x3'].x = 0;
    loseAcknowledgement = true; unconfirmed = true;
    await expect(insertListingZipReviewRow(plan, 0, { requireCropSettings: true, cropSettings: chosen })).rejects.toMatchObject({ status: 503 });
    const saved = structuredClone(rows[0].printCropSettings), savedTimestamp = rows[0].thumbnailUpdatedAt.toISOString();
    const assets = new Map(objects); unconfirmed = false; loseAcknowledgement = false;
    expect(await insertListingZipReviewRow(plan, 0, { requireCropSettings: true,
      ...(retry === 'changed' ? { cropSettings: { invalid: 'Changed after commit' } } : {}) })).toEqual({ listingIds: ['100'] });
    expect(rows[0].printCropSettings).toEqual(saved); expect(rows[0].thumbnailUpdatedAt.toISOString()).toBe(savedTimestamp);
    expect(objects).toEqual(assets); expect(mocks.write).toHaveBeenCalledOnce(); expect(mocks.transaction).toHaveBeenCalledOnce();
    expect(mocks.unlink).not.toHaveBeenCalled();
  });

  it('rejects a blocked or released row without uploading it', async () => {
    rows = [{ title: 'FOX', localDirectoryName: 'Fox' }];
    const blocked = await prepareListingZipReview(context, '10', await archive());
    await expect(insertListingZipReviewRow(blocked, 0)).rejects.toMatchObject({ status: 409 });
    rows = [];
    const released = await prepareListingZipReview(context, '10', await archive()); delete released.rows[0].contents;
    await expect(insertListingZipReviewRow(released, 0)).rejects.toMatchObject({ status: 410 });
    expect(mocks.write).not.toHaveBeenCalled(); expect(mocks.transaction).not.toHaveBeenCalled();
  });

  it.each(['database', 'storage'])('rechecks new %s name collisions when Insert is clicked', async (collision) => {
    const plan = await prepareListingZipReview(context, '10', await archive());
    if (collision === 'database') rows = [{ title: 'FOX', localDirectoryName: 'Fox' }]; else mocks.readdir.mockResolvedValue(['Fox']);
    await expect(insertListingZipReviewRow(plan, 0)).rejects.toMatchObject({ status: 409 }); expect(mocks.write).not.toHaveBeenCalled(); expect(mocks.transaction).not.toHaveBeenCalled();
  });

  it.each(['shop', 'section', 'template'])('revalidates live %s settings before inserting a reviewed row', async (change) => {
    const plan = await prepareListingZipReview(context, '10', await archive());
    if (change === 'shop') mocks.shop.mockResolvedValue({ id: 1, etsyShopId: 66615491n, shopName: 'Renamed Shop', title: 'Shop title' });
    else if (change === 'section') mocks.section.mockResolvedValue({ id: 2, title: 'Prints', etsyShopSectionId: '9999' });
    else target.updatedAt = new Date(now.getTime() + 1000);
    await expect(insertListingZipReviewRow(plan, 0)).rejects.toMatchObject({ status: 409 }); expect(mocks.write).not.toHaveBeenCalled(); expect(mocks.transaction).not.toHaveBeenCalled();
  });

  it('rolls back a failed later Insert while retaining the previously inserted row and its artwork', async () => {
    const plan = await prepareListingZipReview(context, '10', await archive('Title,Description,Filename\nFox,First row,art.png\nOwl,Second row,art.png'));
    await insertListingZipReviewRow(plan, 0);
    const firstObjects = new Map(objects); createFailure = 2;
    await expect(insertListingZipReviewRow(plan, 1)).rejects.toThrow('Database creation failed');
    expect(rows).toHaveLength(1); expect(rows[0].title).toBe('Fox'); expect(objects).toEqual(firstObjects); expect(mocks.page).not.toHaveBeenCalled();
  });

  it('returns a committed row ID on lost acknowledgement without a page read or removal of owned artwork', async () => {
    const plan = await prepareListingZipReview(context, '10', await archive()); loseAcknowledgement = true;
    expect(await insertListingZipReviewRow(plan, 0)).toEqual({ listingIds: ['100'] }); expect(objects.size).toBe(2);
    expect(mocks.unlink).not.toHaveBeenCalled(); expect(mocks.page).not.toHaveBeenCalled();
  });

  it('recovers a retry after both the commit acknowledgement and immediate ownership confirmation were lost', async () => {
    const plan = await prepareListingZipReview({ ...context, shopId: '00066615491' }, '10', await archive());
    loseAcknowledgement = true; unconfirmed = true;
    await expect(insertListingZipReviewRow(plan, 0)).rejects.toMatchObject({ status: 503 });
    expect(rows).toHaveLength(1); const committedObjects = new Map(objects);
    expect(mocks.write).toHaveBeenCalledOnce(); expect(mocks.transaction).toHaveBeenCalledOnce(); expect(mocks.unlink).not.toHaveBeenCalled();
    unconfirmed = false; loseAcknowledgement = false; target.updatedAt = new Date(now.getTime() + 1000);
    expect(await insertListingZipReviewRow(plan, 0)).toEqual({ listingIds: ['100'] });
    expect(rows).toHaveLength(1); expect(objects).toEqual(committedObjects);
    expect(mocks.write).toHaveBeenCalledOnce(); expect(mocks.transaction).toHaveBeenCalledOnce(); expect(mocks.unlink).not.toHaveBeenCalled();
    expect(mocks.listings).toHaveBeenLastCalledWith({ where: { shopId: '66615491', thumbnailFileName: { in: [plan.rows[0].fileName] } },
      select: { id: true, shopId: true, subSectionId: true, localDirectoryName: true, thumbnailFileName: true } });
    expect(mocks.page).not.toHaveBeenCalled();
  });

  it.each(['multiple', 'shop', 'subsection', 'folder', 'filename'])('refuses ambiguous or changed UUID ownership without touching artwork: %s', async (mismatch) => {
    const plan = await prepareListingZipReview(context, '10', await archive());
    const owner = { id: 100, shopId: '66615491', subSectionId: 3, localDirectoryName: 'Fox', thumbnailFileName: plan.rows[0].fileName };
    if (mismatch === 'shop') owner.shopId = 'another-shop';
    if (mismatch === 'subsection') owner.subSectionId = 4;
    if (mismatch === 'folder') owner.localDirectoryName = 'Changed folder';
    if (mismatch === 'filename') owner.thumbnailFileName = plan.rows[0].fileName!.toUpperCase();
    mocks.listings.mockResolvedValueOnce(mismatch === 'multiple' ? [owner, { ...owner, id: 101 }] : [owner]);
    await expect(insertListingZipReviewRow(plan, 0)).rejects.toMatchObject({ status: 503, message: expect.stringContaining('ambiguous') });
    expect(mocks.write).not.toHaveBeenCalled(); expect(mocks.unlink).not.toHaveBeenCalled(); expect(mocks.transaction).not.toHaveBeenCalled();
  });

  it('does not guess or upload when the retry ownership lookup is unavailable', async () => {
    const plan = await prepareListingZipReview(context, '10', await archive());
    mocks.listings.mockRejectedValueOnce(new Error('Database unavailable'));
    await expect(insertListingZipReviewRow(plan, 0)).rejects.toMatchObject({ status: 503, message: expect.stringContaining('Retry Insert') });
    expect(mocks.write).not.toHaveBeenCalled(); expect(mocks.unlink).not.toHaveBeenCalled(); expect(mocks.transaction).not.toHaveBeenCalled();
  });
});
