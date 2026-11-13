import sharp from 'sharp';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  findImage: vi.fn(), findDuplicate: vi.fn(), updateImage: vi.fn(), query: vi.fn(),
  execute: vi.fn(), transaction: vi.fn(), read: vi.fn(), preview: vi.fn(), composed: vi.fn(),
}));

vi.mock('@/lib/prisma', () => ({ prisma: {
  ourCategoryImageTemplate: { findUnique: mocks.findImage, findFirst: mocks.findDuplicate },
  $queryRaw: mocks.query, $transaction: mocks.transaction,
} }));
vi.mock('@/lib/s3-listing-storage', () => ({ readFile: mocks.read }));
vi.mock('@/lib/listing-personalisation-preview', () => ({ createListingPersonalisationPreview: mocks.preview }));
vi.mock('@/lib/our-category-template-composite', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/our-category-template-composite')>();
  return {
    ...actual,
    composeOurCategoryTemplateWithArtworks: (...args: Parameters<typeof actual.composeOurCategoryTemplateWithArtworks>) => {
      mocks.composed(...args);
      return actual.composeOurCategoryTemplateWithArtworks(...args);
    },
  };
});

import { renderOurCategoryImageTemplate, updateOurCategoryImageTemplate } from '@/lib/our-categories';
import type { TemplateOpeningCorners, TemplateOpeningRegion } from '@/lib/our-category-template-composite';
import { createListingPrintCropSettings, defaultNativeListingPrintCropDraft } from '@/lib/listing-print-crops';
import { defaultTemplateGridLayout } from '@/lib/template-grid-layout';

function rectangle(left: number, top: number, width: number, height: number): TemplateOpeningCorners {
  return {
    topLeft: { x: left, y: top }, topRight: { x: left + width, y: top },
    bottomRight: { x: left + width, y: top + height }, bottomLeft: { x: left, y: top + height },
  };
}
const portrait = rectangle(20, 20, 60, 90);
const landscape = rectangle(110, 160, 90, 60);
const area = (): TemplateOpeningRegion => ({
  id: 'area-1', name: 'Area 1', corners: portrait,
  orientationCorners: { portrait, landscape },
});
const category = {
  id: 6, shopId: 1, name: 'Wall art', templateType: 'single', itemCount: 1,
  printsFrames: true, customisePrints: false, digitalDownload: true,
  customTop: false, customBottom: false, sizes: {}, frames: {},
};
let image: ReturnType<typeof makeImage>;
let categorySettings: typeof category;
function makeImage() {
  return {
    id: 94, categoryId: 6, name: 'Wall', description: 'Prints on a wall', imagePath: 'templates/wall.png',
    originalFileName: 'wall.png', imageWidth: 240, imageHeight: 240,
    openingRegions: [area()], topText: '', bottomText: '', fontId: 'nunito-semibold',
    useOnPrints: true, useOnCustomised: false, useOnDigital: true, displayFonts: false,
    borderEnabled: false, borderSizePercent: 5, createdAt: new Date('2026-01-01'), updatedAt: new Date('2026-01-02'),
  };
}

async function sourceImage(width: number, height: number) {
  return sharp({ create: { width, height, channels: 4, background: '#0000ff' } })
    .composite([{ input: await sharp({ create: { width: Math.floor(width / 2), height, channels: 4, background: '#ff0000' } }).png().toBuffer(), left: 0, top: 0 }])
    .png().toBuffer();
}

beforeEach(async () => {
  vi.clearAllMocks();
  image = makeImage();
  categorySettings = { ...category };
  mocks.findImage.mockImplementation(async () => image);
  mocks.findDuplicate.mockResolvedValue(null);
  mocks.updateImage.mockImplementation(async () => image);
  mocks.query.mockImplementation(async (sql: TemplateStringsArray) => {
    const statement = sql.join('');
    if (statement.includes('FROM our_categories')) return [categorySettings];
    if (statement.includes('SELECT id, imageWidth')) return [image];
    return [];
  });
  mocks.transaction.mockImplementation(async (operation) => operation({
    ourCategoryImageTemplate: { update: mocks.updateImage }, $executeRaw: mocks.execute,
  }));
  mocks.read.mockResolvedValue(await sharp({ create: { width: 240, height: 240, channels: 4, background: '#ffffff' } }).png().toBuffer());
  mocks.preview.mockImplementation(async (source: Buffer) => ({ buffer: source }));
});

describe('template source orientation during image generation', () => {
  it.each(['portrait', 'landscape'] as const)('uses the saved %s bounds for the actual source image', async (orientation) => {
    const source = await sourceImage(orientation === 'landscape' ? 90 : 60, orientation === 'landscape' ? 60 : 90);
    const output = await renderOurCategoryImageTemplate(94, new Map([[1, source]]));
    const supplied = mocks.composed.mock.calls[0][1][0];
    expect(supplied.region.corners).toEqual(orientation === 'landscape' ? landscape : portrait);
    const result = await sharp(output).raw().toBuffer({ resolveWithObject: true });
    const pixel = (x: number, y: number) => [...result.data.subarray((y * 240 + x) * 4, (y * 240 + x) * 4 + 3)];
    expect(pixel(orientation === 'landscape' ? 120 : 30, orientation === 'landscape' ? 180 : 50)).toEqual([255, 0, 0]);
    expect(pixel(orientation === 'landscape' ? 180 : 70, orientation === 'landscape' ? 180 : 50)).toEqual([0, 0, 255]);
    expect(pixel(orientation === 'landscape' ? 30 : 120, orientation === 'landscape' ? 50 : 180)).toEqual([255, 255, 255]);
  });

  it('uses actual source orientation for one-image grids and preserves upright cropped artwork', async () => {
    image.openingRegions[0].grid = defaultTemplateGridLayout();
    image.openingRegions[0].grid.cells[0].ratio = '2x3';
    const source = await sourceImage(90, 60);
    const crop = createListingPrintCropSettings(defaultNativeListingPrintCropDraft(90, 60, 'landscape'), {
      fileName: 'art.png', updatedAt: '2026-01-01T00:00:00.000Z', width: 90, height: 60,
    }, 'landscape');
    const output = await renderOurCategoryImageTemplate(94, new Map([[1, source]]), undefined, undefined, undefined, new Map([[1, crop]]));
    const supplied = mocks.composed.mock.calls[0][1][0];
    expect(supplied.region.corners).toEqual(landscape);
    expect(supplied.region.grid.cells[0].orientation).toBe('landscape');
    expect(supplied.cellArtworks[0]).toEqual(source);
    expect(mocks.preview.mock.calls[0][1].orientation).toBe('landscape');
    const decoded = await sharp(output).raw().toBuffer({ resolveWithObject: true });
    const red = (180 * 240 + 120) * 4;
    const blue = (180 * 240 + 190) * 4;
    expect([...decoded.data.subarray(red, red + 3)]).toEqual([255, 0, 0]);
    expect([...decoded.data.subarray(blue, blue + 3)]).toEqual([0, 0, 255]);
  });

  it('keeps a multi-image area fixed while routing each source orientation independently', async () => {
    categorySettings.templateType = 'multiple';
    categorySettings.itemCount = 3;
    const grid = defaultTemplateGridLayout(2);
    grid.rows = 1;
    grid.columns = 2;
    grid.cells[1].imageItemNumber = 2;
    image.openingRegions = [{ ...area(), corners: rectangle(10, 10, 220, 220), grid }];
    await renderOurCategoryImageTemplate(94, new Map([[1, await sourceImage(60, 90)], [2, await sourceImage(90, 60)]]));
    const supplied = mocks.composed.mock.calls[0][1][0];
    expect(supplied.region.corners).toEqual(image.openingRegions[0].corners);
    expect(supplied.region.grid.cells.map((cell: { orientation: string }) => cell.orientation)).toEqual(['portrait', 'landscape']);
    expect(image.openingRegions[0].grid?.cells.map((cell) => cell.orientation)).toEqual(['portrait', 'portrait']);
  });

  it('supports legacy areas that only saved one set of corners', async () => {
    delete image.openingRegions[0].orientationCorners;
    await renderOurCategoryImageTemplate(94, new Map([[1, await sourceImage(90, 60)]]));
    expect(mocks.composed.mock.calls[0][1][0].region.corners).toEqual(portrait);
  });
});

describe('saving template orientation bounds', () => {
  it('persists and returns both orientation sizes for more than four artwork areas', async () => {
    const regions = Array.from({ length: 5 }, (_, index) => ({ ...area(), id: `area-${index + 1}`, name: `Area ${index + 1}`, grid: defaultTemplateGridLayout() }));
    const form = new FormData();
    for (const [key, value] of Object.entries({
      name: image.name, description: image.description, imageWidth: '240', imageHeight: '240',
      openingRegions: JSON.stringify(regions), borderSizePercent: '5', useOnPrints: 'true',
      useOnCustomised: 'false', useOnDigital: 'true', displayFonts: 'false', borderEnabled: 'false',
    })) form.set(key, value);
    const result = await updateOurCategoryImageTemplate('94', form);
    expect(result.openingRegions).toHaveLength(5);
    expect(result.openingRegions.every((region) => JSON.stringify(region.orientationCorners) === JSON.stringify({ portrait, landscape }))).toBe(true);
    const saved = mocks.execute.mock.calls[0][4];
    expect(JSON.parse(saved)).toMatchObject(regions.map(({ id, orientationCorners }) => ({ id, orientationCorners })));
  });
});
