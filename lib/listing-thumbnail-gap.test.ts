import path from 'node:path';
import sharp from 'sharp';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createListingPrintCropSettings, defaultNativeListingPrintCropDraft, parseCurrentListingPrintCropSettings } from '@/lib/listing-print-crops';
import { defaultListingPersonalisationTextAreaSettings } from '@/lib/personalisation-text-areas';

const mocks = vi.hoisted(() => ({ source: vi.fn(), map: vi.fn(), read: vi.fn(), stage: vi.fn(), cleanup: vi.fn(), analyse: vi.fn(), adjust: vi.fn(), transaction: vi.fn(), updateMany: vi.fn(), raw: vi.fn(), current: vi.fn() }));
vi.mock('@/lib/listing-editor', () => ({ getListingForContext: mocks.source, mapEditorData: mocks.map }));
vi.mock('@/lib/local-shop-directory', () => ({ getListingDirectoryPath: () => 'D:/Listings/Current' }));
vi.mock('@/lib/s3-listing-storage', () => ({ readFile: mocks.read, writeStagedListingThumbnail: mocks.stage, removeStagedListingThumbnail: mocks.cleanup }));
vi.mock('@/lib/thumbnail-gap', () => ({ analyseThumbnailGap: mocks.analyse, adjustThumbnailGap: mocks.adjust }));
vi.mock('@/lib/prisma', () => ({ prisma: { $transaction: mocks.transaction, etsyListing: { findUnique: mocks.current } } }));
import { adjustListingThumbnailGap, getListingThumbnailGap } from './listing-thumbnail-gap';

const context = { shopId: '66615491', sectionId: '2', subSectionId: '3', listingId: '79' };
const sourcePath = path.join('D:/Listings/Current', 'thumbnail', 'thumbnail.png');
const analysis = { eligible: true, reason: null, width: 80, height: 100, bounds: { left: 10, top: 10, width: 60, height: 80 }, hasTransparentBackground: true, hasVisibleArtwork: true };
let original: Buffer;
let replacement: Buffer;
let source: ReturnType<typeof fixture>;
let objects: Map<string, Buffer>;

function fixture() {
  return {
    shop: { id: 1, etsyShopId: 66615491n, shopName: 'Shop', title: 'Shop' },
    section: { id: 2, title: 'Animals' }, subSection: { id: 3, name: 'Woodland' },
    listing: { id: 79, shopId: '66615491', subSectionId: 3, localDirectoryName: 'Fox', thumbnailFileName: 'thumbnail.png', thumbnailOriginalFileName: 'Original Fox.png', thumbnailUpdatedAt: new Date('2026-11-17T08:00:00.000Z'), thumbnailWidthPixels: 80, thumbnailHeightPixels: 100, updatedAt: new Date('2026-11-17T08:01:00.000Z'), lastLocalChangeAt: new Date('2026-11-17T08:01:00.000Z'), downloadsRevision: 4, imagesChanged: false, downloadsChanged: false, printCropSettings: createListingPrintCropSettings(defaultNativeListingPrintCropDraft(80, 100), { fileName: 'thumbnail.png', updatedAt: '2026-11-17T08:00:00.000Z', width: 80, height: 100 }) as unknown, personalisationTextAreas: defaultListingPersonalisationTextAreaSettings() as unknown, overviewGenerationFingerprint: 'a'.repeat(64), artworkOrientation: 'portrait', ourCategory: { customisePrints: true, customTop: true, customBottom: true }, productConfig: null },
  };
}

beforeEach(async () => {
  vi.resetAllMocks();
  original = await sharp({ create: { width: 80, height: 100, channels: 4, background: '#ff000080' } }).png().toBuffer();
  replacement = await sharp({ create: { width: 80, height: 100, channels: 4, background: '#00ff0080' } }).png().toBuffer();
  source = fixture();
  objects = new Map([[sourcePath, Buffer.from(original)]]);
  mocks.source.mockImplementation(async () => source);
  mocks.read.mockImplementation(async (filePath) => {
    const bytes = objects.get(filePath);
    if (!bytes) throw new Error('Missing thumbnail.');
    return Buffer.from(bytes);
  });
  mocks.analyse.mockResolvedValue(analysis);
  mocks.adjust.mockResolvedValue({ changed: true, buffer: replacement, analysis });
  mocks.map.mockImplementation(async (ctx, data) => ({ context: ctx, thumbnail: { fileName: data.listing.thumbnailFileName, originalFileName: data.listing.thumbnailOriginalFileName, updatedAt: data.listing.thumbnailUpdatedAt.toISOString(), widthPixels: data.listing.thumbnailWidthPixels, heightPixels: data.listing.thumbnailHeightPixels }, listing: { printCropSettings: data.listing.printCropSettings, personalisationTextAreas: data.listing.personalisationTextAreas }, pendingChanges: ['Images', 'Digital Downloads'], downloadsRevision: data.listing.downloadsRevision }));
  mocks.stage.mockImplementation(async (filePath, contents) => { objects.set(filePath, Buffer.from(contents)); objects.set(`${filePath}.preview`, Buffer.from('new preview')); });
  mocks.cleanup.mockImplementation(async (filePath) => { objects.delete(filePath); objects.delete(`${filePath}.preview`); });
  mocks.updateMany.mockImplementation(async ({ where, data }) => {
    if (where.id === source.listing.id) {
      Object.assign(source.listing, data, { downloadsRevision: source.listing.downloadsRevision + data.downloadsRevision.increment });
    }
    return { count: 1 };
  });
  mocks.raw.mockResolvedValue(1);
  mocks.transaction.mockImplementation(async (operation) => {
    const previous = { ...source.listing };
    try { return await operation({ etsyListing: { updateMany: mocks.updateMany }, $executeRaw: mocks.raw }); }
    catch (error) { source.listing = previous; throw error; }
  });
  mocks.current.mockImplementation(async () => ({ thumbnailFileName: source.listing.thumbnailFileName }));
});

async function currentVersion() { return (await getListingThumbnailGap(context)).thumbnailVersion!; }
function expectOriginalIntact(before = fixture().listing) {
  expect(objects.get(sourcePath)).toEqual(original);
  expect(source.listing).toEqual(before);
  expect(mocks.cleanup.mock.calls.every(([filePath]) => filePath !== sourcePath)).toBe(true);
}

describe('thumbnail gap source analysis', () => {
  it('reads the validated listing source without storage or database mutations', async () => {
    const result = await getListingThumbnailGap(context);
    expect(result).toMatchObject({ analysis, thumbnailVersion: expect.stringMatching(/^[a-f0-9]{64}$/), thumbnailIdentity: { fileName: 'thumbnail.png', updatedAt: '2026-11-17T08:00:00.000Z' } });
    expect(mocks.source).toHaveBeenCalledWith(context);
    expect(mocks.read).toHaveBeenCalledWith(sourcePath);
    expect(mocks.stage).not.toHaveBeenCalled();
    expect(mocks.transaction).not.toHaveBeenCalled();
    expect(mocks.map).not.toHaveBeenCalled();
  });

  it('returns explicit empty analysis when the listing has no thumbnail', async () => {
    Object.assign(source.listing, { thumbnailFileName: null });
    await expect(getListingThumbnailGap(context)).resolves.toEqual({ analysis: null, thumbnailVersion: null, thumbnailIdentity: null });
    expect(mocks.read).not.toHaveBeenCalled();
    expect(mocks.analyse).not.toHaveBeenCalled();
  });

  it('rejects unsafe filenames and mismatched shop data before reading storage', async () => {
    source.listing.thumbnailFileName = '../another.png';
    await expect(getListingThumbnailGap(context)).rejects.toThrow('filename is invalid');
    expect(mocks.read).not.toHaveBeenCalled();
    source = fixture(); source.listing.shopId = 'another-shop';
    await expect(getListingThumbnailGap(context)).rejects.toMatchObject({ status: 404 });
    expect(mocks.read).not.toHaveBeenCalled();
  });

  it('returns a missing-context error before touching thumbnail storage', async () => {
    mocks.source.mockRejectedValue(new Error('Listing not found.'));
    await expect(getListingThumbnailGap(context)).rejects.toMatchObject({ status: 404 });
    expect(mocks.read).not.toHaveBeenCalled();
  });

  it('versions include saved image bytes as well as filename and timestamp', async () => {
    const first = await currentVersion();
    objects.set(sourcePath, replacement);
    expect(await currentVersion()).not.toBe(first);
  });
});

describe('guarded thumbnail gap replacement', () => {
  it.each([undefined, null, '5', NaN, Infinity, -1, 20.1])('rejects invalid percentage %s before reading or writing', async (percent) => {
    await expect(adjustListingThumbnailGap(context, percent, 'a'.repeat(64))).rejects.toMatchObject({ status: 400 });
    expect(mocks.source).not.toHaveBeenCalled();
    expect(mocks.stage).not.toHaveBeenCalled();
    expect(mocks.transaction).not.toHaveBeenCalled();
  });

  it.each([undefined, null, '', 'old-version'])('requires a valid expected version %s', async (version) => {
    await expect(adjustListingThumbnailGap(context, 5, version)).rejects.toMatchObject({ status: 400 });
    expect(mocks.source).not.toHaveBeenCalled();
  });

  it('rejects a stale version before processing or staging', async () => {
    const version = await currentVersion();
    objects.set(sourcePath, replacement);
    await expect(adjustListingThumbnailGap(context, 5, version)).rejects.toMatchObject({ status: 409 });
    expect(mocks.adjust).not.toHaveBeenCalled();
    expect(mocks.stage).not.toHaveBeenCalled();
    expect(mocks.transaction).not.toHaveBeenCalled();
  });

  it.each([0, 5, 20])('writes nothing for an unchanged result at %s percent', async (percent) => {
    const version = await currentVersion();
    mocks.adjust.mockResolvedValue({ changed: false, buffer: original, analysis });
    await expect(adjustListingThumbnailGap(context, percent, version)).resolves.toEqual({ changed: false, analysis, thumbnailVersion: version });
    expect(mocks.adjust).toHaveBeenCalledWith(original, percent);
    expect(mocks.stage).not.toHaveBeenCalled();
    expect(mocks.cleanup).not.toHaveBeenCalled();
    expect(mocks.transaction).not.toHaveBeenCalled();
    expect(mocks.map).not.toHaveBeenCalled();
    expectOriginalIntact();
  });

  it('stages a unique PNG and projected editor response before the atomic pointer and dependent-state commit', async () => {
    const version = await currentVersion();
    const previous = { ...source.listing };
    const result = await adjustListingThumbnailGap(context, 5, version);
    expect(result.changed).toBe(true);
    if (!result.changed) throw new Error('Expected a changed thumbnail.');
    expect(result.thumbnailVersion).not.toBe(version);
    expect(result.data!.thumbnail).toMatchObject({ fileName: expect.stringMatching(/^thumbnail-gap-[a-f0-9-]{36}\.png$/), originalFileName: 'Original Fox.png', widthPixels: 80, heightPixels: 100 });
    expect(source.listing.thumbnailOriginalFileName).toBe('Original Fox.png');
    expect(source.listing.artworkOrientation).toBe('portrait');
    expect(source.listing.downloadsRevision).toBe(5);
    expect(source.listing.imagesChanged).toBe(true);
    expect(source.listing.downloadsChanged).toBe(true);
    expect(objects.get(sourcePath)).toEqual(original);
    expect(objects.get(mocks.stage.mock.calls[0][0])).toEqual(replacement);
    expect(mocks.map.mock.invocationCallOrder[0]).toBeLessThan(mocks.stage.mock.invocationCallOrder[0]);
    expect(mocks.stage.mock.invocationCallOrder[0]).toBeLessThan(mocks.transaction.mock.invocationCallOrder[0]);
    expect(mocks.updateMany.mock.calls[0][0].where).toMatchObject({ id: 79, shopId: '66615491', subSectionId: 3, thumbnailFileName: 'thumbnail.png', thumbnailUpdatedAt: previous.thumbnailUpdatedAt, updatedAt: previous.updatedAt, lastLocalChangeAt: previous.lastLocalChangeAt, downloadsRevision: 4, subSection: { is: { id: 3, shopSectionId: 2, shopSection: { is: { id: 2 } } } } });
    expect(mocks.updateMany.mock.calls[1][0]).toMatchObject({ where: { groupItems: { some: { sourceListingId: 79 } } }, data: { imagesChanged: true, downloadsChanged: true, downloadsRevision: { increment: 1 } } });
    expect(mocks.raw.mock.calls[0][0].join('')).not.toContain('printCropSettings = NULL');
    const storedCrops = JSON.parse(mocks.raw.mock.calls[0][1]);
    const storedTextAreas = JSON.parse(mocks.raw.mock.calls[0][2]);
    expect(storedCrops).toMatchObject({ source: { fileName: result.data!.thumbnail!.fileName, updatedAt: result.data!.thumbnail!.updatedAt, width: 80, height: 100 } });
    expect(storedCrops.regions).toEqual((previous.printCropSettings as { regions: unknown }).regions);
    expect(storedTextAreas).toEqual(previous.personalisationTextAreas);
    expect(result.data.listing.printCropSettings).toEqual(storedCrops);
    expect(result.data.listing.personalisationTextAreas).toEqual(storedTextAreas);
    expect(parseCurrentListingPrintCropSettings(storedCrops, { fileName: result.data.thumbnail!.fileName, updatedAt: result.data.thumbnail!.updatedAt })).not.toBeNull();
    expect(mocks.raw.mock.calls.every((call) => call.includes('0'.repeat(64)))).toBe(true);
    expect(mocks.cleanup).not.toHaveBeenCalled();
    expect(mocks.current).not.toHaveBeenCalled();
  });

  it('initializes generation-ready sizes and applicable text areas when no configuration was saved', async () => {
    source.listing.printCropSettings = null;
    source.listing.personalisationTextAreas = null;
    const result = await adjustListingThumbnailGap(context, 5, await currentVersion());
    if (!result.changed) throw new Error('Expected a changed thumbnail.');
    expect(result.data.listing.printCropSettings).not.toBeNull();
    expect(result.data.listing.personalisationTextAreas).toEqual(defaultListingPersonalisationTextAreaSettings());
    expect(parseCurrentListingPrintCropSettings(result.data.listing.printCropSettings, {
      fileName: result.data.thumbnail!.fileName,
      updatedAt: result.data.thumbnail!.updatedAt,
      orientation: 'portrait',
    })).not.toBeNull();
    expect(JSON.parse(mocks.raw.mock.calls[0][1])).toEqual(result.data.listing.printCropSettings);
    expect(JSON.parse(mocks.raw.mock.calls[0][2])).toEqual(result.data.listing.personalisationTextAreas);
  });

  it('does not initialize missing configuration when image adjustment is a no-op', async () => {
    source.listing.printCropSettings = null;
    source.listing.personalisationTextAreas = null;
    const previous = { ...source.listing };
    mocks.adjust.mockResolvedValue({ changed: false, buffer: original, analysis });
    await expect(adjustListingThumbnailGap(context, 5, await currentVersion())).resolves.toMatchObject({ changed: false });
    expect(mocks.map).not.toHaveBeenCalled();
    expect(mocks.stage).not.toHaveBeenCalled();
    expect(mocks.transaction).not.toHaveBeenCalled();
    expectOriginalIntact(previous);
  });

  it('leaves the original untouched on image processing failure', async () => {
    const version = await currentVersion();
    mocks.adjust.mockRejectedValue(new Error('Decode failed'));
    await expect(adjustListingThumbnailGap(context, 5, version)).rejects.toThrow('Decode failed');
    expect(mocks.stage).not.toHaveBeenCalled();
    expect(mocks.transaction).not.toHaveBeenCalled();
    expectOriginalIntact();
  });

  it('rejects changed output that changes canvas dimensions before any write', async () => {
    const version = await currentVersion();
    const wrongSize = await sharp({ create: { width: 40, height: 50, channels: 4, background: '#00000000' } }).png().toBuffer();
    mocks.adjust.mockResolvedValue({ changed: true, buffer: wrongSize, analysis });
    await expect(adjustListingThumbnailGap(context, 5, version)).rejects.toThrow('retain its original canvas');
    expect(mocks.map).not.toHaveBeenCalled();
    expect(mocks.stage).not.toHaveBeenCalled();
    expectOriginalIntact();
  });

  it('does not stage or commit if constructing the refreshed editor response fails', async () => {
    const version = await currentVersion();
    mocks.map.mockRejectedValue(new Error('Editor asset unavailable'));
    await expect(adjustListingThumbnailGap(context, 5, version)).rejects.toThrow('Editor asset unavailable');
    expect(mocks.stage).not.toHaveBeenCalled();
    expect(mocks.transaction).not.toHaveBeenCalled();
    expectOriginalIntact();
  });

  it('cleans only new staged objects if saving the PNG or preview fails', async () => {
    const version = await currentVersion();
    mocks.stage.mockImplementation(async (filePath) => { objects.set(`${filePath}.preview`, Buffer.from('partial')); throw new Error('S3 preview failed'); });
    await expect(adjustListingThumbnailGap(context, 5, version)).rejects.toThrow('S3 preview failed');
    expect(mocks.transaction).not.toHaveBeenCalled();
    expect(mocks.cleanup).toHaveBeenCalledTimes(1);
    expect(objects.size).toBe(1);
    expectOriginalIntact();
  });

  it('rolls back pointer metadata and cleans staging when dependent invalidation fails', async () => {
    const version = await currentVersion();
    mocks.raw.mockResolvedValueOnce(1).mockRejectedValueOnce(new Error('DB invalidation failed'));
    await expect(adjustListingThumbnailGap(context, 5, version)).rejects.toThrow('DB invalidation failed');
    expect(mocks.cleanup).toHaveBeenCalledTimes(1);
    expect(objects.size).toBe(1);
    expectOriginalIntact();
  });

  it('cleans staging and returns conflict when a concurrent edit wins the CAS', async () => {
    const version = await currentVersion();
    mocks.updateMany.mockResolvedValueOnce({ count: 0 });
    await expect(adjustListingThumbnailGap(context, 5, version)).rejects.toMatchObject({ status: 409 });
    expect(mocks.raw).not.toHaveBeenCalled();
    expect(mocks.cleanup).toHaveBeenCalledTimes(1);
    expect(objects.size).toBe(1);
    expectOriginalIntact();
  });

  it('reports success without deleting the live image if only the commit acknowledgement is lost', async () => {
    const version = await currentVersion();
    mocks.transaction.mockImplementation(async (operation) => { await operation({ etsyListing: { updateMany: mocks.updateMany }, $executeRaw: mocks.raw }); throw new Error('Commit response lost'); });
    const result = await adjustListingThumbnailGap(context, 5, version);
    expect(result.changed).toBe(true);
    if (!result.changed) throw new Error('Expected a confirmed thumbnail save.');
    expect(result.data).toBeDefined();
    expect(mocks.current).toHaveBeenCalledWith({ where: { id: 79 }, select: { thumbnailFileName: true } });
    expect(mocks.cleanup).not.toHaveBeenCalled();
    expect(objects.get(sourcePath)).toEqual(original);
    expect(objects.has(mocks.stage.mock.calls[0][0])).toBe(true);
  });

  it('retains staged data when the commit outcome cannot safely be confirmed', async () => {
    const version = await currentVersion();
    mocks.transaction.mockRejectedValue(new Error('Connection lost'));
    mocks.current.mockRejectedValue(new Error('Database unreachable'));
    await expect(adjustListingThumbnailGap(context, 5, version)).rejects.toMatchObject({ status: 503 });
    expect(mocks.cleanup).not.toHaveBeenCalled();
    expectOriginalIntact();
  });
});
