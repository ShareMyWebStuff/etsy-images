import sharp from 'sharp';
import { describe, expect, it } from 'vitest';

import {
  composeOurCategoryTemplate,
  composeOurCategoryTemplateWithArtworks,
  detectTemplateOpening,
  remapTemplateOpeningRegionImageItem,
} from '@/lib/our-category-template-composite';
import { defaultTemplateGridLayout } from '@/lib/template-grid-layout';

const FOREGROUND = [120, 40, 20, 255] as const;

function templatePixels(width: number, height: number) {
  const pixels = Buffer.alloc(width * height * 4);
  for (let index = 0; index < width * height; index += 1) {
    pixels.set(FOREGROUND, index * 4);
  }
  return pixels;
}

function clearRectangle(pixels: Buffer, canvasWidth: number, left: number, top: number, width: number, height: number) {
  for (let y = top; y < top + height; y += 1) {
    for (let x = left; x < left + width; x += 1) pixels[(y * canvasWidth + x) * 4 + 3] = 0;
  }
}

function clearPolygon(pixels: Buffer, canvasWidth: number, canvasHeight: number, points: Array<{ x: number; y: number }>) {
  for (let y = 0; y < canvasHeight; y += 1) {
    for (let x = 0; x < canvasWidth; x += 1) {
      let inside = false;
      for (let current = 0, previous = points.length - 1; current < points.length; previous = current++) {
        const first = points[current];
        const second = points[previous];
        const crosses = first.y > y !== second.y > y
          && x < ((second.x - first.x) * (y - first.y)) / (second.y - first.y) + first.x;
        if (crosses) inside = !inside;
      }
      if (inside) pixels[(y * canvasWidth + x) * 4 + 3] = 0;
    }
  }
}

async function pngFromPixels(pixels: Buffer, width: number, height: number) {
  return sharp(pixels, { raw: { width, height, channels: 4 } }).png().toBuffer();
}

function colourAt(pixels: Buffer, width: number, x: number, y: number) {
  return [...pixels.subarray((y * width + x) * 4, (y * width + x) * 4 + 4)];
}

function blueBounds(pixels: Buffer, width: number, height: number) {
  let minX = width;
  let maxX = -1;
  let minY = height;
  let maxY = -1;
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const offset = (y * width + x) * 4;
      if (pixels[offset] === 0 && pixels[offset + 1] === 0 && pixels[offset + 2] === 255 && pixels[offset + 3] === 255) {
        minX = Math.min(minX, x);
        maxX = Math.max(maxX, x);
        minY = Math.min(minY, y);
        maxY = Math.max(maxY, y);
      }
    }
  }
  return { left: minX, right: maxX, top: minY, bottom: maxY, width: maxX - minX + 1, height: maxY - minY + 1 };
}

function rectangleCorners(left: number, top: number, width: number, height: number) {
  return {
    topLeft: { x: left, y: top },
    topRight: { x: left + width - 1, y: top },
    bottomRight: { x: left + width - 1, y: top + height - 1 },
    bottomLeft: { x: left, y: top + height - 1 },
  };
}

describe('Our Category template compositing', () => {
  it('remaps every grid cell when a linked template selects a different listing image', () => {
    const grid = defaultTemplateGridLayout(2);
    grid.cells[1] = { ...grid.cells[1], imageItemNumber: 3 };
    const region = {
      id: 'area-1',
      name: 'Area 1',
      corners: rectangleCorners(10, 10, 100, 120),
      imageItemNumber: 1,
      grid,
    };

    const remapped = remapTemplateOpeningRegionImageItem(region, 2);

    expect(remapped.imageItemNumber).toBe(2);
    expect(remapped.grid?.cells.map(({ imageItemNumber }) => imageItemNumber)).toEqual([2, 2]);
    expect(region.grid.cells.map(({ imageItemNumber }) => imageItemNumber)).toEqual([1, 3]);
  });

  it('detects the main enclosed opening from alpha and ignores edge transparency and small holes', () => {
    const width = 160;
    const height = 160;
    const pixels = templatePixels(width, height);
    clearRectangle(pixels, width, 30, 20, 80, 110);
    clearRectangle(pixels, width, 130, 100, 4, 4);
    clearRectangle(pixels, width, 0, 40, 3, 50);

    const opening = detectTemplateOpening(pixels, width, height);
    expect(opening.bounds).toEqual({ left: 30, top: 20, width: 80, height: 110 });
    expect(opening.axisAligned).toBe(true);
    expect(opening.mask[20 * width + 30]).toBe(255);
    expect(opening.mask[100 * width + 130]).toBe(0);
    expect(opening.mask[40 * width]).toBe(0);
  });

  it('ignores partially transparent pixels that connect an opening to the canvas edge', () => {
    const width = 160;
    const height = 160;
    const pixels = templatePixels(width, height);
    clearRectangle(pixels, width, 30, 20, 80, 110);
    for (let index = 0; index < width * height; index += 1) {
      if (pixels[index * 4 + 3] === 255) pixels[index * 4 + 3] = 254;
    }

    const opening = detectTemplateOpening(pixels, width, height);
    expect(opening.bounds).toEqual({ left: 30, top: 20, width: 80, height: 110 });
    expect(opening.mask[0]).toBe(0);
  });

  it('keeps the template dimensions and covers the entire configured opening without white margins', async () => {
    const canvasWidth = 140;
    const canvasHeight = 180;
    const pixels = templatePixels(canvasWidth, canvasHeight);
    clearRectangle(pixels, canvasWidth, 20, 20, 100, 140);
    pixels[(90 * canvasWidth + 70) * 4 + 3] = 255;
    const template = await pngFromPixels(pixels, canvasWidth, canvasHeight);
    const originalTemplate = Buffer.from(template);
    const artwork = await sharp({ create: { width: 100, height: 100, channels: 4, background: '#0000ff' } }).png().toBuffer();

    const result = await composeOurCategoryTemplate(template, artwork, rectangleCorners(20, 20, 100, 140));
    const decoded = await sharp(result).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
    const bounds = blueBounds(decoded.data, canvasWidth, canvasHeight);

    expect(decoded.info).toMatchObject({ width: canvasWidth, height: canvasHeight });
    expect(bounds).toEqual({ left: 20, right: 119, top: 20, bottom: 159, width: 100, height: 140 });
    expect(colourAt(decoded.data, canvasWidth, 21, 90)).toEqual([0, 0, 255, 255]);
    expect(colourAt(decoded.data, canvasWidth, 19, 90)).toEqual([...FOREGROUND]);
    expect(colourAt(decoded.data, canvasWidth, 70, 90)).toEqual([0, 0, 255, 255]);
    expect(template.equals(originalTemplate)).toBe(true);
  });

  it('adds a uniform white percentage border inside the paper opening when enabled', async () => {
    const canvasWidth = 140;
    const canvasHeight = 180;
    const pixels = templatePixels(canvasWidth, canvasHeight);
    clearRectangle(pixels, canvasWidth, 20, 20, 100, 140);
    const template = await pngFromPixels(pixels, canvasWidth, canvasHeight);
    const artwork = await sharp({ create: { width: 100, height: 100, channels: 4, background: '#0000ff' } }).png().toBuffer();

    const result = await composeOurCategoryTemplate(
      template,
      artwork,
      rectangleCorners(20, 20, 100, 140),
      { borderEnabled: true, borderSizePercent: 5 },
    );
    const decoded = await sharp(result).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
    const bounds = blueBounds(decoded.data, canvasWidth, canvasHeight);

    // Five per cent of the 100px short paper edge gives an even 5px border.
    expect(bounds).toEqual({ left: 25, right: 114, top: 25, bottom: 154, width: 90, height: 130 });
    expect(colourAt(decoded.data, canvasWidth, 22, 90)).toEqual([255, 255, 255, 255]);
    expect(colourAt(decoded.data, canvasWidth, 117, 90)).toEqual([255, 255, 255, 255]);
    expect(colourAt(decoded.data, canvasWidth, 70, 22)).toEqual([255, 255, 255, 255]);
    expect(colourAt(decoded.data, canvasWidth, 70, 157)).toEqual([255, 255, 255, 255]);
    expect(decoded.info).toMatchObject({ width: canvasWidth, height: canvasHeight });
  });

  it('cuts the configured opening from a fully opaque template in memory', async () => {
    const width = 120;
    const height = 120;
    const pixels = templatePixels(width, height);
    for (let y = 20; y < 100; y += 1) {
      for (let x = 30; x < 90; x += 1) pixels.set([255, 255, 255, 255], (y * width + x) * 4);
    }
    const template = await pngFromPixels(pixels, width, height);
    const originalTemplate = Buffer.from(template);
    const artwork = await sharp({ create: { width: 30, height: 60, channels: 4, background: '#0000ff' } }).png().toBuffer();

    const result = await composeOurCategoryTemplate(template, artwork, rectangleCorners(30, 20, 60, 80));
    const decoded = await sharp(result).ensureAlpha().raw().toBuffer();

    expect(colourAt(decoded, width, 30, 20)).toEqual([0, 0, 255, 255]);
    expect(colourAt(decoded, width, 89, 99)).toEqual([0, 0, 255, 255]);
    expect(colourAt(decoded, width, 29, 60)).toEqual([...FOREGROUND]);
    expect(colourAt(decoded, width, 90, 60)).toEqual([...FOREGROUND]);
    expect(template.equals(originalTemplate)).toBe(true);
  });

  it('renders the artwork into every configured region', async () => {
    const width = 160;
    const height = 100;
    const template = await pngFromPixels(templatePixels(width, height), width, height);
    const artwork = await sharp({ create: { width: 40, height: 40, channels: 4, background: '#0000ff' } }).png().toBuffer();
    const result = await composeOurCategoryTemplate(template, artwork, [
      { id: 'left', name: 'Area 1', corners: rectangleCorners(10, 20, 50, 60) },
      { id: 'right', name: 'Area 2', corners: rectangleCorners(100, 10, 40, 40) },
    ]);
    const decoded = await sharp(result).ensureAlpha().raw().toBuffer();

    expect(colourAt(decoded, width, 30, 40)).toEqual([0, 0, 255, 255]);
    expect(colourAt(decoded, width, 120, 30)).toEqual([0, 0, 255, 255]);
    expect(colourAt(decoded, width, 80, 50)).toEqual([...FOREGROUND]);
  });

  it('renders each numbered multiple-template image into its assigned region', async () => {
    const width = 160;
    const height = 100;
    const template = await pngFromPixels(templatePixels(width, height), width, height);
    const firstArtwork = await sharp({ create: { width: 40, height: 40, channels: 4, background: '#ff0000' } }).png().toBuffer();
    const secondArtwork = await sharp({ create: { width: 40, height: 40, channels: 4, background: '#0000ff' } }).png().toBuffer();
    const result = await composeOurCategoryTemplateWithArtworks(template, [
      {
        region: { id: 'left', name: 'Area 1', imageItemNumber: 1, corners: rectangleCorners(10, 20, 50, 60) },
        artwork: firstArtwork,
      },
      {
        region: { id: 'right', name: 'Area 2', imageItemNumber: 2, corners: rectangleCorners(100, 10, 40, 40) },
        artwork: secondArtwork,
      },
    ]);
    const decoded = await sharp(result).ensureAlpha().raw().toBuffer();

    expect(colourAt(decoded, width, 30, 40)).toEqual([255, 0, 0, 255]);
    expect(colourAt(decoded, width, 120, 30)).toEqual([0, 0, 255, 255]);
    expect(colourAt(decoded, width, 80, 50)).toEqual([...FOREGROUND]);
  });

  it('renders grid cells over the template and preserves the background in grid gaps', async () => {
    const width = 180;
    const height = 120;
    const template = await pngFromPixels(templatePixels(width, height), width, height);
    const red = await sharp({ create: { width: 70, height: 100, channels: 4, background: '#ff0000' } }).png().toBuffer();
    const blue = await sharp({ create: { width: 70, height: 100, channels: 4, background: '#0000ff' } }).png().toBuffer();
    const grid = defaultTemplateGridLayout(2);
    grid.rows = 1;
    grid.columns = 2;
    grid.horizontalGapPercent = 20;
    grid.verticalGapPercent = 0;
    const region = { id: 'grid', name: 'Area 1', corners: rectangleCorners(20, 20, 120, 80), grid };

    const result = await composeOurCategoryTemplateWithArtworks(template, [{ region, cellArtworks: [red, blue] }]);
    const decoded = await sharp(result).ensureAlpha().raw().toBuffer();

    expect(colourAt(decoded, width, 35, 60)).toEqual([255, 0, 0, 255]);
    expect(colourAt(decoded, width, 125, 60)).toEqual([0, 0, 255, 255]);
    expect(colourAt(decoded, width, 80, 60)).toEqual([...FOREGROUND]);
    expect(colourAt(decoded, width, 10, 60)).toEqual([...FOREGROUND]);
  });

  it('leaves the template unchanged when it has no configured regions', async () => {
    const width = 100;
    const height = 100;
    const template = await pngFromPixels(templatePixels(width, height), width, height);
    const artwork = await sharp({ create: { width: 20, height: 20, channels: 4, background: '#0000ff' } }).png().toBuffer();
    const result = await composeOurCategoryTemplate(template, artwork, []);
    const [templatePixelsResult, resultPixels] = await Promise.all([
      sharp(template).ensureAlpha().raw().toBuffer(),
      sharp(result).ensureAlpha().raw().toBuffer(),
    ]);

    expect(resultPixels.equals(templatePixelsResult)).toBe(true);
  });

  it.each([
    { label: 'landscape', width: 200, height: 100 },
    { label: 'portrait', width: 100, height: 200 },
  ])('centres and crops a $label artwork to cover the opening without stretching', async ({ width, height }) => {
    const canvasWidth = 140;
    const canvasHeight = 180;
    const pixels = templatePixels(canvasWidth, canvasHeight);
    clearRectangle(pixels, canvasWidth, 20, 20, 100, 140);
    const template = await pngFromPixels(pixels, canvasWidth, canvasHeight);
    const artwork = await sharp({ create: { width, height, channels: 4, background: '#0000ff' } }).png().toBuffer();
    const result = await composeOurCategoryTemplate(template, artwork, rectangleCorners(20, 20, 100, 140));
    const decoded = await sharp(result).ensureAlpha().raw().toBuffer();
    const bounds = blueBounds(decoded, canvasWidth, canvasHeight);

    expect(bounds).toEqual({ left: 20, right: 119, top: 20, bottom: 159, width: 100, height: 140 });
  });

  it('uses a white backing beneath transparent areas in the complete artwork canvas', async () => {
    const pixels = templatePixels(120, 120);
    clearRectangle(pixels, 120, 20, 20, 80, 80);
    const template = await pngFromPixels(pixels, 120, 120);
    const artworkPixels = Buffer.alloc(40 * 40 * 4);
    for (let y = 10; y < 30; y += 1) {
      for (let x = 10; x < 30; x += 1) artworkPixels.set([0, 0, 255, 255], (y * 40 + x) * 4);
    }
    const artwork = await pngFromPixels(artworkPixels, 40, 40);
    const result = await composeOurCategoryTemplate(template, artwork, rectangleCorners(20, 20, 80, 80));
    const decoded = await sharp(result).ensureAlpha().raw().toBuffer();

    expect(colourAt(decoded, 120, 60, 60)).toEqual([0, 0, 255, 255]);
    expect(colourAt(decoded, 120, 34, 60)).toEqual([255, 255, 255, 255]);
    expect(colourAt(decoded, 120, 22, 60)).toEqual([255, 255, 255, 255]);
  });

  it('maps artwork into an angled four-corner print plane and clips it to the configured polygon', async () => {
    const width = 140;
    const height = 140;
    const pixels = templatePixels(width, height);
    clearPolygon(pixels, width, height, [
      { x: 30, y: 20 },
      { x: 110, y: 30 },
      { x: 100, y: 120 },
      { x: 20, y: 110 },
    ]);
    const opening = detectTemplateOpening(pixels, width, height);
    expect(opening.axisAligned).toBe(false);
    const template = await pngFromPixels(pixels, width, height);
    const artwork = await sharp({ create: { width: 80, height: 80, channels: 4, background: '#0000ff' } }).png().toBuffer();
    const result = await composeOurCategoryTemplate(template, artwork, {
      topLeft: { x: 30, y: 20 },
      topRight: { x: 110, y: 30 },
      bottomRight: { x: 100, y: 120 },
      bottomLeft: { x: 20, y: 110 },
    });
    const decoded = await sharp(result).ensureAlpha().raw().toBuffer();

    expect(colourAt(decoded, width, 65, 70)).toEqual([0, 0, 255, 255]);
    expect(colourAt(decoded, width, 28, 21)).toEqual([...FOREGROUND]);
    expect(colourAt(decoded, width, 5, 70)).toEqual([...FOREGROUND]);
    expect(opening.axisAligned).toBe(false);
  });

  it('reports a clear error instead of guessing when configured corners are invalid', async () => {
    const pixels = templatePixels(100, 100);
    clearRectangle(pixels, 100, 0, 20, 30, 60);
    const template = await pngFromPixels(pixels, 100, 100);
    const artwork = await sharp({ create: { width: 20, height: 20, channels: 4, background: '#0000ff' } }).png().toBuffer();

    await expect(composeOurCategoryTemplate(template, artwork, {
      topLeft: { x: 20, y: 20 },
      topRight: { x: 20, y: 20 },
      bottomRight: { x: 20, y: 20 },
      bottomLeft: { x: 20, y: 20 },
    })).rejects.toThrow(
      'The S3 template image has opening corners that do not form a valid four-sided print area.',
    );
  });
});
