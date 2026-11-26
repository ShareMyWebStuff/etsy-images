import sharp from 'sharp';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ query: vi.fn(), image: vi.fn(), listing: vi.fn(), read: vi.fn(), preview: vi.fn(), execute: vi.fn(), write: vi.fn() }));
vi.mock('@/lib/prisma', () => ({ prisma: { $queryRaw: mocks.query, $executeRaw: mocks.execute,
  ourCategoryImageTemplate: { findUnique: mocks.image }, etsyListing: { findUnique: mocks.listing } } }));
vi.mock('@/lib/s3-listing-storage', () => ({ readFile: mocks.read, readImagePreview: mocks.preview, writeFile: mocks.write }));

import { getOurCategoryTemplateImage, renderOurCategoryImageTemplate, testOurCategoryImageTemplate } from '@/lib/our-categories';
import { renderSavedOurTemplateImage, testOurTemplateImage } from '@/lib/our-template-images';
import { createListingPrintCropSettings, defaultNativeListingPrintCropDraft, type ListingPrintCropSettings } from '@/lib/listing-print-crops';
import { defaultPaperPlacement, estimateOpeningAspect, placementKey } from '@/lib/our-template-image-geometry';
import type { OurTemplateImageDefinition } from '@/lib/our-template-image-types';

const sceneId = '10000000-0000-4000-8000-000000000001';
let scene: OurTemplateImageDefinition;
let mapping: Record<string, number> | null;
let scenePng: Buffer;
let savedSample: { contents: Buffer; crops: ListingPrintCropSettings } | null;
const image = { id: 94, categoryId: 6, name: 'Nursery', description: 'Room scene', imagePath: 'copy.png',
  originalFileName: 'Canva.png', imageWidth: 240, imageHeight: 140, useOnPrints: true, useOnCustomised: false,
  useOnDigital: true, displayFonts: false, borderEnabled: false, borderSizePercent: 5,
  topText: '', bottomText: '', fontId: 'nunito-semibold', createdAt: new Date('2026-01-01'), updatedAt: new Date('2026-01-01') };
const category = { id: 6, shopId: 1, name: 'Nursery', templateType: 'multiple', itemCount: 3,
  printsFrames: true, customisePrints: false, digitalDownload: true, customTop: false, customBottom: false, sizes: {}, frames: {} };

beforeEach(async () => {
  vi.clearAllMocks(); mapping = null; savedSample = null;
  scene = { width: 240, height: 140, lightingMode: 'opaque', openings: [
    { id: 'left', name: 'Left print', imageItemNumber: 1, ratio: 'iso-a1', orientation: 'portrait', placements: {},
      corners: { topLeft: { x: 20, y: 20 }, topRight: { x: 80, y: 25 }, bottomRight: { x: 75, y: 120 }, bottomLeft: { x: 15, y: 115 } } },
    { id: 'right', name: 'Right print', imageItemNumber: 2, ratio: '4x5', orientation: 'portrait', placements: {},
      corners: { topLeft: { x: 135, y: 20 }, topRight: { x: 215, y: 15 }, bottomRight: { x: 225, y: 105 }, bottomLeft: { x: 145, y: 115 } } },
  ] };
  scenePng = await sharp({ create: { width: 240, height: 140, channels: 4, background: '#ddddcc' } }).png().toBuffer();
  mocks.read.mockImplementation(async (filePath: string) => filePath.endsWith('markers.png') && savedSample ? savedSample.contents : scenePng);
  mocks.listing.mockResolvedValue(null);
  mocks.image.mockImplementation(async ({ where }) => where.id === 94 ? image : { ...image, id: 95, categoryId: 7 });
  mocks.query.mockImplementation(async (sql: TemplateStringsArray | { sql: string }) => {
    const statement = Array.isArray(sql) ? sql.join('') : (sql as { sql: string }).sql;
    if (statement.includes('FROM etsy_listings') && savedSample) return [{ printCropSettings: savedSample.crops,
      thumbnailUpdatedAt: new Date(savedSample.crops.source.updatedAt), artworkOrientation: 'portrait' }];
    if (statement.includes('FROM our_template_image_tag_links')) return [];
    if (statement.includes('FROM our_template_images')) return [{ id: sceneId, name: 'Room', originalFileName: 'Canva.png', imagePath: 'scene.png',
      whiteImagePath: null, blackImagePath: null, definition: scene, createdAt: image.createdAt, updatedAt: image.updatedAt }];
    if (statement.includes('FROM our_categories')) return [category];
    if (statement.includes('SELECT linked.id')) return [];
    if (statement.includes('FROM our_category_image_templates')) return [{ ...image, ourTemplateImageId: sceneId,
      ourTemplateImageItemMapping: mapping, openingRegions: scene.openings }];
    return [];
  });
});
async function solid(colour: string) { return sharp({ create: { width: 60, height: 90, channels: 3, background: colour } }).png().toBuffer(); }

async function preparePortraitMarkerSample() {
  const pixels = Buffer.alloc(80 * 100 * 4);
  for (let y = 0; y < 100; y++) for (let x = 0; x < 80; x++) {
    // Amber canopy, water and a bright lower stepping-stone marker expose accidental top-only zoom.
    let colour = y < 34 ? [210, 130, 20, 255] : y < 67 ? [30, 110, 130, 255] : [30, 190, 70, 255];
    if (x >= 36 && x <= 52 && y >= 75 && y <= 95) colour = [210, 30, 160, 255];
    // A left margin distinguishes the saved right-shifted crop from a centred upload crop.
    if (x < 15) colour = [230, 20, 25, 255];
    pixels.set(colour, (y * 80 + x) * 4);
  }
  const contents = await sharp(pixels, { raw: { width: 80, height: 100, channels: 4 } }).png().toBuffer();
  const draft = defaultNativeListingPrintCropDraft(80, 100);
  draft.regions['2x3'].x = .15;
  const crops = createListingPrintCropSettings(draft, { width: 80, height: 100, fileName: 'markers.png', updatedAt: '2026-11-18T12:00:00.000Z' });
  savedSample = { contents, crops };
  mocks.listing.mockResolvedValue({ id: 586, thumbnailFileName: 'markers.png', localDirectoryName: 'Stepping stones regression', backgroundColour: '#FFFFFF',
    ourCategory: { backgroundColour: '#FFFFFF' }, subSection: { name: 'Art', shopSection: { title: 'Art', shop: { shopName: 'Shop', title: null, etsyShopId: 66n } } } });
  const corners = { topLeft: { x: 20, y: 10 }, topRight: { x: 100, y: 10 }, bottomRight: { x: 100, y: 130 }, bottomLeft: { x: 20, y: 130 } };
  const ratio = '2x3' as const, orientation = 'portrait' as const;
  scene.openings = [{ ...scene.openings[0], ratio, orientation, corners, placements: {
    [placementKey(ratio, orientation)]: defaultPaperPlacement(estimateOpeningAspect(corners, scene.width, scene.height), ratio, orientation),
  } }];
  return { contents, crops };
}

async function pixelReader(contents: Buffer) {
  const { data, info } = await sharp(contents).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  return (x: number, y: number) => [...data.subarray((y * info.width + x) * 4, (y * info.width + x) * 4 + 3)];
}

function expectColour(actual: number[], expected: number[]) {
  for (let channel = 0; channel < 3; channel++) expect(Math.abs(actual[channel] - expected[channel])).toBeLessThanOrEqual(8);
}

describe('Our Template Images through the existing listing renderer', () => {
  it('renders explicitly selected artwork by its original scene number without applying the saved legacy mapping twice', async () => {
    mapping = { '1': 3, '2': 1 };
    const red = await solid('#ee2200'), blue = await solid('#0022ee');
    const expected = await renderSavedOurTemplateImage(sceneId, new Map([[1, { contents: red }], [2, { contents: blue }]]));
    const actual = await renderOurCategoryImageTemplate(94, new Map([[1, red], [2, blue]]),
      undefined, undefined, undefined, undefined, undefined, new Map([[1, 'portrait'], [2, 'portrait']]), 'portrait',
      { sourceItemNumbersAreSceneItems: true });
    expect(actual.equals(expected)).toBe(true);
    expect(mapping).toEqual({ '1': 3, '2': 1 });
    expect(mocks.execute).not.toHaveBeenCalled(); expect(mocks.write).not.toHaveBeenCalled();
  });

  it('keeps lower portrait artwork visible at centred minimum cover, preserves its saved crop and matches listing-artwork Test output', async () => {
    const { contents, crops } = await preparePortraitMarkerSample();
    const body = new FormData(); body.set('listing-1', '586');
    const preview = await testOurTemplateImage(sceneId, body);
    const normal = await renderOurCategoryImageTemplate(94, new Map([[1, contents]]), undefined, undefined, undefined, new Map([[1, crops]]), '#FFFFFF');
    expect(normal.equals(preview)).toBe(true);
    const at = await pixelReader(normal);
    expectColour(at(60, 30), [210, 130, 20]);
    expectColour(at(60, 70), [30, 110, 130]);
    expectColour(at(60, 110), [210, 30, 160]);
    expectColour(at(25, 30), [210, 130, 20]);
    const defaultUpload = await renderSavedOurTemplateImage(sceneId, new Map([[1, { contents }]]));
    expectColour((await pixelReader(defaultUpload))(25, 30), [230, 20, 25]);
    expect(mocks.execute).not.toHaveBeenCalled(); expect(mocks.write).not.toHaveBeenCalled();
  });

  it('continues to honor intentional saved zoom instead of silently resetting it during rendering', async () => {
    const { contents, crops } = await preparePortraitMarkerSample();
    const source = new Map([[1, contents]]), cropSettings = new Map([[1, crops]]);
    const fitted = await renderOurCategoryImageTemplate(94, source, undefined, undefined, undefined, cropSettings, '#FFFFFF');
    scene.openings[0].placements['2x3:portrait'] = { x: 0, y: 0, width: 3 };
    const intentional = await renderOurCategoryImageTemplate(94, source, undefined, undefined, undefined, cropSettings, '#FFFFFF');
    expect(intentional.equals(fitted)).toBe(false);
    expectColour((await pixelReader(fitted))(60, 110), [210, 30, 160]);
    expectColour((await pixelReader(intentional))(60, 110), [210, 130, 20]);
    expect(scene.openings[0].placements['2x3:portrait']).toEqual({ x: 0, y: 0, width: 3 });
  });

  it('preserves the saved crop, explicit item mapping and foreground while keeping lower artwork visible', async () => {
    const { contents, crops } = await preparePortraitMarkerSample();
    mapping = { '1': 3 };
    const original = await sharp(scenePng).ensureAlpha().raw().toBuffer();
    for (let y = 44; y <= 56; y++) for (let x = 39; x <= 51; x++) original.set([90, 45, 20, 255], (y * scene.width + x) * 4);
    scenePng = await sharp(original, { raw: { width: scene.width, height: scene.height, channels: 4 } }).png().toBuffer();
    scene.foregroundMask = { version: 1, strokes: [{ mode: 'paint', size: 10, softness: 0, points: [{ x: 45, y: 50 }] }] };
    const body = new FormData(); body.set('listing-1', '586');
    const preview = await testOurTemplateImage(sceneId, body);
    const normal = await renderOurCategoryImageTemplate(94, new Map([[1, await solid('#0022ee')], [3, contents]]),
      undefined, undefined, undefined, new Map([[1, crops], [3, crops]]), '#FFFFFF');
    expect(normal.equals(preview)).toBe(true);
    const at = await pixelReader(normal);
    expectColour(at(60, 110), [210, 30, 160]);
    expectColour(at(45, 50), [90, 45, 20]);
    expectColour(at(25, 30), [210, 130, 20]);
  });

  it('uses the stored browsing preview in Our Templates while preserving its full-resolution image and rendering', async () => {
    const storedPreview = Buffer.from('existing 512px WebP'); mocks.preview.mockResolvedValue(storedPreview);
    const definition = structuredClone(scene);
    const preview = await getOurCategoryTemplateImage('94', true);
    expect(preview.contents).toBe(storedPreview); expect(preview.contentType).toBe('image/webp');
    expect(mocks.preview).toHaveBeenCalledExactlyOnceWith('scene.png');
    expect(mocks.read).not.toHaveBeenCalled();
    const original = await getOurCategoryTemplateImage('94');
    expect(original.contents).toBe(scenePng); expect(original.contentType).toBe('image/png');
    expect(mocks.read).toHaveBeenCalledExactlyOnceWith('scene.png');
    expect(scene).toEqual(definition);
    const red = await solid('#ee2200'), blue = await solid('#0022ee');
    const generated = await renderOurCategoryImageTemplate(94, new Map([[1, red], [2, blue]]));
    expect((await sharp(generated).metadata()).width).toBe(scene.width);
    expect((await sharp(generated).metadata()).height).toBe(scene.height);
    expect(mocks.preview).toHaveBeenCalledTimes(1);
    expect(mocks.execute).not.toHaveBeenCalled(); expect(mocks.write).not.toHaveBeenCalled();
  });
  it.each(['brush', 'smart selection'] as const)('keeps an opaque object with a %s and matching scene Test and normal generation output', async (maskType) => {
    const source = await sharp(scenePng).ensureAlpha().raw().toBuffer();
    for (let y = 10; y <= 125; y++) for (let x = 40; x <= 55; x++) source.set([90, 45, 20, 255], (y * 240 + x) * 4);
    scenePng = await sharp(source, { raw: { width: 240, height: 140, channels: 4 } }).png().toBuffer();
    mocks.read.mockResolvedValue(scenePng);
    scene.foregroundMask = { version: 1, strokes: [
      maskType === 'brush'
        ? { mode: 'paint', size: 30, softness: 0, points: [{ x: 45, y: 20 }, { x: 45, y: 115 }] }
        : { mode: 'paint', size: 1, softness: 0, points: [], region: { width: 120, height: 70,
          runs: Array.from({ length: 48 }, (_, index): [number, number, number] => [(index + 10) * 120 + 20, 8, 255]),
        } },
      { mode: 'erase', size: 8, softness: 0, points: [{ x: 45, y: 65 }] },
    ] };
    const red = await solid('#ee2200'), blue = await solid('#0022ee');
    const body = new FormData(); body.set('artwork-1', new File([new Uint8Array(red)], 'red.png', { type: 'image/png' }));
    body.set('artwork-2', new File([new Uint8Array(blue)], 'blue.png', { type: 'image/png' }));
    const preview = await testOurTemplateImage(sceneId, body);
    const normal = await renderOurCategoryImageTemplate(94, new Map([[1, red], [2, blue]]));
    expect(preview.equals(normal)).toBe(true);
    const pixels = await sharp(normal).ensureAlpha().raw().toBuffer();
    const at = (x: number, y: number) => [...pixels.subarray((y * 240 + x) * 4, (y * 240 + x) * 4 + 3)];
    expect(at(45, 50)).toEqual([90, 45, 20]);
    expect(at(45, 65)).toEqual([238, 34, 0]);
    expect(at(65, 70)).toEqual([238, 34, 0]);
    expect(at(45, 12)).toEqual([90, 45, 20]);
    expect(at(175, 65)).toEqual([0, 34, 238]);
    expect(mocks.execute).not.toHaveBeenCalled(); expect(mocks.write).not.toHaveBeenCalled();
  });
  it('uses identical rendering for scene Test, Our Templates Test and ordinary listing generation with two angled frames', async () => {
    const red = await solid('#ee2200'), blue = await solid('#0022ee');
    const body = new FormData(); body.set('artwork-1', new File([new Uint8Array(red)], 'red.png', { type: 'image/png' }));
    body.set('artwork-2', new File([new Uint8Array(blue)], 'blue.png', { type: 'image/png' }));
    const test = await testOurTemplateImage(sceneId, body);
    const listing = await renderOurCategoryImageTemplate(94, new Map([[1, red], [2, blue]]));
    const oldTest = await testOurCategoryImageTemplate('94', [new File([new Uint8Array(red)], 'red.png'), new File([new Uint8Array(blue)], 'blue.png')]);
    expect(test.equals(listing)).toBe(true); expect(oldTest.equals(listing)).toBe(true);
    const { data, info } = await sharp(listing).raw().toBuffer({ resolveWithObject: true });
    const colour = (x: number, y: number) => [...data.subarray((y * info.width + x) * 4, (y * info.width + x) * 4 + 3)];
    expect(colour(45, 65)).toEqual([238, 34, 0]); expect(colour(175, 65)).toEqual([0, 34, 238]);
    expect(colour(5, 5)).toEqual([221, 221, 204]);
    expect(mocks.execute).not.toHaveBeenCalled(); expect(mocks.write).not.toHaveBeenCalled();
  });
  it('forwards each saved paper crop unchanged to the same scene renderer', async () => {
    const red = await solid('#ee2200'), blue = await solid('#0022ee');
    const crops = createListingPrintCropSettings(defaultNativeListingPrintCropDraft(60, 90), {
      fileName: 'red.png', updatedAt: '2026-01-01T00:00:00.000Z', width: 60, height: 90,
    });
    const direct = await renderSavedOurTemplateImage(sceneId, new Map([[1, { contents: red, cropSettings: crops }], [2, { contents: blue, cropSettings: crops }]]));
    const generated = await renderOurCategoryImageTemplate(94, new Map([[1, red], [2, blue]]), undefined,
      undefined, undefined, new Map([[1, crops], [2, crops]]));
    expect(generated.equals(direct)).toBe(true);
  });
  it('follows edited scene artwork assignments instead of retaining the attachment snapshot', async () => {
    const red = await solid('#ee2200'), blue = await solid('#0022ee');
    scene.openings[0].imageItemNumber = 2; scene.openings[1].imageItemNumber = 1;
    const generated = await renderOurCategoryImageTemplate(94, new Map([[1, red], [2, blue]]));
    const data = await sharp(generated).raw().toBuffer();
    expect([...data.subarray((65 * 240 + 45) * 4, (65 * 240 + 45) * 4 + 3)]).toEqual([0, 34, 238]);
  });
  it('retains a smart foreground selection alongside an explicit copy remap of scene artwork items', async () => {
    const red = await solid('#ee2200'), blue = await solid('#0022ee');
    mapping = { '1': 3, '2': 3 };
    scene.foregroundMask = { version: 1, strokes: [{ mode: 'paint', size: 1, softness: 0, points: [],
      region: { width: 120, height: 70, runs: Array.from({ length: 30 }, (_, index): [number, number, number] => [(index + 15) * 120 + 20, 8, 255]) },
    }] };
    const generated = await renderOurCategoryImageTemplate(94, new Map([[1, red], [3, blue]]));
    const data = await sharp(generated).raw().toBuffer();
    expect([...data.subarray((65 * 240 + 45) * 4, (65 * 240 + 45) * 4 + 3)]).toEqual([221, 221, 204]);
    for (const x of [65, 175]) expect([...data.subarray((65 * 240 + x) * 4, (65 * 240 + x) * 4 + 3)]).toEqual([0, 34, 238]);
  });
});
