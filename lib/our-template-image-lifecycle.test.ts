import path from 'node:path';
import sharp from 'sharp';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const db = vi.hoisted(() => ({ query: vi.fn(), execute: vi.fn(), transaction: vi.fn(), image: vi.fn(), images: vi.fn(),
  listingImages: vi.fn(), listings: vi.fn(), removeListingImages: vi.fn(), updateListings: vi.fn(),
  removeImages: vi.fn(), removeImage: vi.fn(), updateCategory: vi.fn(), read: vi.fn(), write: vi.fn(), unlink: vi.fn(), discover: vi.fn() }));
vi.mock('@/lib/prisma', () => ({ prisma: {
  $queryRaw: db.query, $executeRaw: db.execute, $transaction: db.transaction,
  ourCategoryImageTemplate: { findUnique: db.image, findMany: db.images, deleteMany: db.removeImages, delete: db.removeImage },
  ourCategory: { updateMany: db.updateCategory },
  etsyListingImage: { findMany: db.listingImages, deleteMany: db.removeListingImages },
  etsyListing: { findMany: db.listings, updateMany: db.updateListings },
} }));
vi.mock('@/lib/s3-listing-storage', () => ({ readFile: db.read, writeFile: db.write, unlink: db.unlink, listGeneratedListingImageFiles: db.discover }));

import { deleteOurTemplateImage, getOurTemplateImageDeletionImpact, updateOurTemplateImage } from '@/lib/our-template-images';
import { renderOurCategoryImageTemplate } from '@/lib/our-categories';
import { getListingDirectoryPath } from '@/lib/local-shop-directory';
import type { OurTemplateImageDefinition } from '@/lib/our-template-image-types';

const sceneId = '10000000-0000-4000-8000-000000000001';
const createdAt = new Date('2026-01-01');
const corners = { topLeft: { x: 20, y: 10 }, topRight: { x: 70, y: 10 }, bottomRight: { x: 70, y: 90 }, bottomLeft: { x: 20, y: 90 } };
const configuration: OurTemplateImageDefinition = { width: 100, height: 100, lightingMode: 'opaque', openings: [{
  id: 'opening', name: 'Print', corners, imageItemNumber: 1, ratio: 'iso-a1', orientation: 'portrait', placements: {},
}] };
function makeTemplate(id: number, categoryId: number, scene: string | null, sourceId: number | null = null) {
  return { id, categoryId, ourTemplateImageId: scene, ourTemplateImageItemMapping: null,
    linkedSourceImageTemplateId: sourceId, linkedSourceCategoryId: sourceId ? 1 : null, linkedImageItemNumber: sourceId ? 1 : null,
    name: `Template ${id}`, description: 'Room', imagePath: `D:/Etsy/EtsyListings/Templates/${id}.png`,
    originalFileName: `${id}.png`, contentType: 'image/png', sizeBytes: 100,
    imageWidth: 100, imageHeight: 100, openingRegions: [{ id: 'legacy', name: 'Legacy print', corners }],
    displayFonts: false, borderEnabled: false, borderSizePercent: 5, topText: '', bottomText: '', fontId: 'nunito-semibold',
    useOnPrints: true, useOnCustomised: false, useOnDigital: true, createdAt, updatedAt: createdAt,
    category: { templateType: 'single' },
  };
}
type Template = ReturnType<typeof makeTemplate>;
function makeListing(id: number, categoryId: number, directory: string) {
  return { id, ourCategoryId: categoryId, shopId: '66615491', localDirectoryName: directory,
    listingImagesRevision: 0, imagesChanged: false, subSection: { name: 'Nursery', shopSection: { title: 'Art',
      shop: { etsyShopId: BigInt(66615491), shopName: 'Shop', title: null } } } };
}
type LocalListing = ReturnType<typeof makeListing>;
type GeneratedImage = { id: number; listingId: number; ourCategoryImageTemplateId: number | null; localFileName: string; listing: LocalListing };
let templates: Map<number, Template>;
let listings: Map<number, LocalListing>;
let generated: Map<number, GeneratedImage>;
let sceneExists: boolean;
let storedDefinition: OurTemplateImageDefinition;
let files: Map<string, Buffer>;
let sourceDeleteFailure: string | null;
let sceneRowDeleteFailure: boolean;
const normalize = (value: string) => value.replaceAll('\\', '/');
const sceneSources = ['D:/Etsy/EtsyListings/OurTemplateImages/scene.png', 'D:/Etsy/EtsyListings/OurTemplateImages/white.png', 'D:/Etsy/EtsyListings/OurTemplateImages/black.png'];
const previewPath = (value: string) => normalize(value).replace('D:/Etsy/EtsyListings/', 'D:/Etsy/EtsyListings/.app-previews/') + '.webp';
const listingImagePath = (listing: LocalListing, fileName: string) => normalize(path.join(
  getListingDirectoryPath('Shop', 'Art', 'Nursery', listing.localDirectoryName), fileName));

beforeEach(async () => {
  vi.clearAllMocks(); sceneExists = true; storedDefinition = structuredClone(configuration); files = new Map();
  sourceDeleteFailure = null; sceneRowDeleteFailure = false;
  templates = new Map([makeTemplate(10, 1, sceneId), makeTemplate(11, 1, null),
    makeTemplate(20, 2, null, 10), makeTemplate(40, 4, 'unrelated-scene')].map((row) => [row.id, row]));
  listings = new Map([makeListing(101, 1, 'Direct'), makeListing(202, 2, 'Linked'),
    makeListing(303, 1, 'Not yet generated'), makeListing(404, 4, 'Unrelated')].map((row) => [row.id, row]));
  generated = new Map([
    { id: 100, listingId: 101, ourCategoryImageTemplateId: 10, localFileName: 'template-10.png', listing: listings.get(101)! },
    { id: 110, listingId: 101, ourCategoryImageTemplateId: 11, localFileName: 'template-11.png', listing: listings.get(101)! },
    { id: 200, listingId: 202, ourCategoryImageTemplateId: 20, localFileName: 'template-20.png', listing: listings.get(202)! },
    { id: 400, listingId: 404, ourCategoryImageTemplateId: 40, localFileName: 'template-40.png', listing: listings.get(404)! },
  ].map((row) => [row.id, row]));
  const opaque = await sharp({ create: { width: 100, height: 100, channels: 4, background: '#ddddcc' } }).png().toBuffer();
  const foreground = await sharp({ create: { width: 100, height: 100, channels: 4, background: '#aabbcc' } }).raw().toBuffer();
  for (let y = 10; y <= 90; y++) for (let x = 20; x <= 70; x++) foreground[(y * 100 + x) * 4 + 3] = 0;
  const transparent = await sharp(foreground, { raw: { width: 100, height: 100, channels: 4 } }).png().toBuffer();
  for (const row of templates.values()) files.set(normalize(row.imagePath), row.id === 11 ? transparent : opaque);
  for (const filePath of sceneSources) files.set(filePath, opaque);
  for (const image of generated.values()) files.set(listingImagePath(image.listing, image.localFileName), opaque);
  for (const filePath of [...files.keys()]) files.set(previewPath(filePath), Buffer.from('stored WebP'));
  db.read.mockImplementation(async (filePath: string) => {
    const contents = files.get(normalize(filePath));
    if (!contents) throw Object.assign(new Error(`Missing fixture ${filePath}`), { code: 'ENOENT' });
    return contents;
  });
  db.write.mockImplementation(async (filePath: string, contents: Buffer) => { files.set(normalize(filePath), contents); files.set(previewPath(filePath), Buffer.from('restored WebP')); });
  db.unlink.mockImplementation(async (filePath: string) => {
    if (normalize(filePath) === sourceDeleteFailure) throw new Error('Source storage deletion failed');
    files.delete(normalize(filePath)); files.delete(previewPath(filePath));
  });
  db.discover.mockImplementation(async (directoryPath: string) => {
    const prefix = normalize(directoryPath) + '/', previewPrefix = previewPath(directoryPath).replace(/\.webp$/, '/') ;
    const names = new Set<string>();
    for (const filePath of files.keys()) {
      const original = filePath.startsWith(prefix) ? filePath.slice(prefix.length) : null;
      const preview = filePath.startsWith(previewPrefix) ? filePath.slice(previewPrefix.length).replace(/\.webp$/, '') : null;
      for (const name of [original, preview]) if (name && /^template-\d+\.png$/.test(name)) names.add(name);
    }
    return [...names];
  });
  db.query.mockImplementation(async (sql: TemplateStringsArray | { sql: string }) => {
    const statement = Array.isArray(sql) ? sql.join('') : (sql as { sql: string }).sql;
    if (statement.includes('FROM our_template_image_tag_links')) return [];
    if (statement.includes('FROM our_template_images')) return sceneExists ? [{ id: sceneId, name: 'Shared nursery', originalFileName: 'Canva.png',
      imagePath: sceneSources[0], whiteImagePath: sceneSources[1], blackImagePath: sceneSources[2],
      definition: storedDefinition, createdAt, updatedAt: createdAt }] : [];
    if (statement.includes('FROM our_categories')) return [{ id: 1, shopId: 1, name: 'Nursery', templateType: 'single', itemCount: 1,
      printsFrames: true, customisePrints: false, digitalDownload: true, customTop: false, customBottom: false, sizes: {}, frames: {} }];
    if (statement.includes('SELECT linked.id')) return [];
    if (statement.includes('FROM our_category_image_templates')) return [...templates.values()];
    throw new Error(`Unexpected query: ${statement}`);
  });
  db.execute.mockImplementation(async (sql: TemplateStringsArray | { sql: string; values: unknown[] }, ...values: unknown[]) => {
    const statement = Array.isArray(sql) ? sql.join('') : (sql as { sql: string }).sql;
    if (statement.includes('listingImagesRevision')) {
      for (const value of (sql as { values: number[] }).values) listings.get(value)!.listingImagesRevision += 1;
    } else if (statement.includes('DELETE FROM our_template_images')) {
      if (sceneRowDeleteFailure) throw new Error('Scene database deletion failed');
      sceneExists = false;
    }
    else if (statement.includes('UPDATE our_template_images')) storedDefinition = JSON.parse(String(values[5]));
    else throw new Error(`Unexpected write: ${statement}`);
    return 1;
  });
  db.image.mockImplementation(async ({ where }: { where: { id: number } }) => templates.get(where.id) ?? null);
  db.images.mockImplementation(async ({ where }: { where: { linkedSourceImageTemplateId: { in: number[] } } }) =>
    [...templates.values()].filter((row) => row.linkedSourceImageTemplateId && where.linkedSourceImageTemplateId.in.includes(row.linkedSourceImageTemplateId)));
  db.listings.mockImplementation(async ({ where, select }: { where: { ourCategoryId: { in: number[] } }; select: { localDirectoryName?: boolean } }) =>
    [...listings.values()].filter((listing) => where.ourCategoryId.in.includes(listing.ourCategoryId)).map((row) => select.localDirectoryName ? row : { id: row.id }));
  db.listingImages.mockImplementation(async ({ where }: { where: { OR: [{ ourCategoryImageTemplateId: { in: number[] } }, { localFileName: { in: string[] } }] } }) =>
    [...generated.values()].filter((image) => image.ourCategoryImageTemplateId !== null && where.OR[0].ourCategoryImageTemplateId.in.includes(image.ourCategoryImageTemplateId)
      || where.OR[1].localFileName.in.includes(image.localFileName)));
  db.removeListingImages.mockImplementation(async ({ where }: { where: { id: { in: number[] } } }) => {
    for (const id of where.id.in) generated.delete(id);
  });
  db.updateListings.mockImplementation(async ({ where, data }: { where: { id: { in: number[] } }; data: { imagesChanged: boolean } }) => {
    for (const id of where.id.in) listings.get(id)!.imagesChanged = data.imagesChanged;
  });
  db.removeImages.mockImplementation(async ({ where }: { where: { id: { in: number[] } } }) => {
    for (const id of where.id.in) templates.delete(id);
  });
  db.removeImage.mockImplementation(async ({ where }: { where: { id: number } }) => { templates.delete(where.id); });
  db.transaction.mockImplementation(async (operation) => operation({ $executeRaw: db.execute,
    ourCategoryImageTemplate: { deleteMany: db.removeImages, delete: db.removeImage }, ourCategory: { updateMany: db.updateCategory },
    etsyListingImage: { deleteMany: db.removeListingImages }, etsyListing: { updateMany: db.updateListings } }));
});

describe('shared scene deletion through real template deletion and rendering', () => {
  it('also removes a reserved generated output whose old database row lost its template association', async () => {
    const listing = listings.get(303)!; const fileName = 'template-10.png';
    generated.set(300, { id: 300, listingId: listing.id, ourCategoryImageTemplateId: null, localFileName: fileName, listing });
    const filePath = listingImagePath(listing, fileName);
    files.set(filePath, Buffer.from('detached generated original')); files.set(previewPath(filePath), Buffer.from('detached generated WebP'));
    await deleteOurTemplateImage(sceneId);
    expect(generated.has(300)).toBe(false); expect(files.has(filePath)).toBe(false); expect(files.has(previewPath(filePath))).toBe(false);
    expect(generated.has(110)).toBe(true); expect(generated.has(400)).toBe(true);
  });

  it('discovers source and linked orphan outputs without DB rows, including preview-only files, while preserving other assets', async () => {
    const listing = listings.get(303)!;
    const orphan = listingImagePath(listing, 'template-10.png'), linked = listingImagePath(listing, 'template-20.png');
    files.set(orphan, Buffer.from('orphan original')); files.set(previewPath(orphan), Buffer.from('orphan preview'));
    files.set(previewPath(linked), Buffer.from('preview only'));
    const untouched = [listingImagePath(listing, 'template-40.png'), listingImagePath(listing, 'photo.png'), listingImagePath(listing, 'thumbnail/thumbnail.png')];
    for (const filePath of untouched) { files.set(filePath, Buffer.from('unrelated')); files.set(previewPath(filePath), Buffer.from('unrelated preview')); }
    await deleteOurTemplateImage(sceneId);
    expect(files.has(orphan)).toBe(false); expect(files.has(previewPath(orphan))).toBe(false); expect(files.has(previewPath(linked))).toBe(false);
    for (const filePath of untouched) { expect(files.has(filePath)).toBe(true); expect(files.has(previewPath(filePath))).toBe(true); }
    expect(listings.get(303)!.imagesChanged).toBe(true);
    expect([...generated.values()].map((image) => image.ourCategoryImageTemplateId)).toEqual([11, 40]);
  });

  it('retains the source scene and restores source PNGs/previews when final lighting-source cleanup fails, then permits retry', async () => {
    sourceDeleteFailure = sceneSources[1];
    await expect(deleteOurTemplateImage(sceneId)).rejects.toThrow('Source storage deletion failed');
    expect(sceneExists).toBe(true);
    for (const filePath of sceneSources) { expect(files.has(filePath)).toBe(true); expect(files.has(previewPath(filePath))).toBe(true); }
    expect([...templates.keys()]).toEqual([11, 40]);
    sourceDeleteFailure = null;
    await deleteOurTemplateImage(sceneId);
    expect(sceneExists).toBe(false);
    for (const filePath of sceneSources) { expect(files.has(filePath)).toBe(false); expect(files.has(previewPath(filePath))).toBe(false); }
  });

  it('restores all source originals and previews if deleting the final scene row fails', async () => {
    sceneRowDeleteFailure = true;
    await expect(deleteOurTemplateImage(sceneId)).rejects.toThrow('Scene database deletion failed');
    expect(sceneExists).toBe(true);
    for (const filePath of sceneSources) { expect(files.has(filePath)).toBe(true); expect(files.has(previewPath(filePath))).toBe(true); }
  });

  it('removes shared scene output and linked references, then renders the remaining template successfully', async () => {
    expect(await getOurTemplateImageDeletionImpact(sceneId)).toEqual({ affectedTemplateCount: 2, affectedImageTemplateCount: 2, affectedListingCount: 3 });
    const unrelatedOriginal = files.get(listingImagePath(listings.get(404)!, 'template-40.png'));

    const edit = new FormData(); const changedDefinition = structuredClone(configuration);
    changedDefinition.openings[0].corners.topLeft.x += 1;
    edit.set('name', 'Shared nursery'); edit.set('definition', JSON.stringify(changedDefinition));
    await updateOurTemplateImage(sceneId, edit);
    expect(storedDefinition.openings[0].corners.topLeft.x).toBe(21);
    expect([...listings.values()].map((row) => [row.id, row.listingImagesRevision])).toEqual([[101, 1], [202, 1], [303, 1], [404, 0]]);

    await deleteOurTemplateImage(sceneId);

    expect(sceneExists).toBe(false);
    expect([...templates.keys()]).toEqual([11, 40]);
    expect([...generated.values()].map((image) => image.ourCategoryImageTemplateId)).toEqual([11, 40]);
    expect(files.has(listingImagePath(listings.get(101)!, 'template-10.png'))).toBe(false);
    expect(files.has(previewPath(listingImagePath(listings.get(101)!, 'template-10.png')))).toBe(false);
    expect(files.has(listingImagePath(listings.get(202)!, 'template-20.png'))).toBe(false);
    expect(files.has(previewPath(listingImagePath(listings.get(202)!, 'template-20.png')))).toBe(false);
    expect(files.has('D:/Etsy/EtsyListings/OurTemplateImages/scene.png')).toBe(false);
    expect(files.get(listingImagePath(listings.get(404)!, 'template-40.png'))).toBe(unrelatedOriginal);
    expect([...listings.values()].map((row) => [row.id, row.listingImagesRevision])).toEqual([[101, 2], [202, 2], [303, 2], [404, 0]]);
    expect(listings.get(303)!.imagesChanged).toBe(false);
    expect(listings.get(404)!.imagesChanged).toBe(false);
    expect(db.updateCategory).not.toHaveBeenCalled();

    const artwork = await sharp({ create: { width: 50, height: 80, channels: 3, background: '#0033ee' } }).png().toBuffer();
    const remaining = [...templates.values()].filter((template) => template.categoryId === 1);
    const regenerated = await Promise.all(remaining.map(async (template) => ({
      id: template.id, contents: await renderOurCategoryImageTemplate(template.id, new Map([[1, artwork]])),
    })));
    expect(regenerated.map((image) => image.id)).toEqual([11]);
    const { data, info } = await sharp(regenerated[0].contents).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
    expect(info.width).toBe(100); expect(info.height).toBe(100);
    expect([...data.subarray((50 * 100 + 45) * 4, (50 * 100 + 45) * 4 + 3)]).toEqual([0, 51, 238]);
    expect([...data.subarray((5 * 100 + 5) * 4, (5 * 100 + 5) * 4 + 3)]).toEqual([170, 187, 204]);
  });
});
