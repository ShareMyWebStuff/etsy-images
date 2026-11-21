import { describe, expect, it } from 'vitest';
import {
  createForegroundMaskRaster, foregroundMaskRegionRaster, rasterizeForegroundMask,
} from '@/lib/our-template-image-foreground-mask';
import { createForegroundRegionStroke, fillForegroundMaskHoles, smartSelectForeground } from '@/lib/our-template-image-smart-selection';

function photo(width: number, height: number, pixel: (x: number, y: number) => number[]) {
  const rgba = new Uint8Array(width * height * 4);
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) rgba.set(pixel(x, y), (y * width + x) * 4);
  return rgba;
}

describe('guided smart foreground selection', () => {
  it('selects the clicked colour and edge bounded object, fills a small internal hole and softens its outline', () => {
    const width = 80, height = 80;
    const rgba = photo(width, height, (x, y) => {
      if (x >= 30 && x <= 49 && y >= 20 && y <= 59) {
        if (x >= 39 && x <= 40 && y >= 39 && y <= 40) return [20, 40, 80, 255];
        return [191 + (x % 3), 171 + (x % 3), 164 + (x % 3), 255];
      }
      return [190, 208, 215, 255];
    });
    const result = smartSelectForeground({ rgba, width, height, seed: { x: 35, y: 30 }, sensitivity: .4 });
    const raster = foregroundMaskRegionRaster(result.region);
    expect(result.confidence).toBe('high'); expect(result.touchesEdge).toBe(false);
    expect(raster.alpha[40 * width + 40]).toBe(255);
    expect(raster.alpha[30 * width + 29]).toBe(0);
    expect(raster.alpha[30 * width + 30]).toBeGreaterThan(0);
    expect(raster.alpha[30 * width + 30]).toBeLessThan(255);
    expect(result.selectedPixelCount).toBe(800);
  });

  it('grows only the clicked component even when old paint marks cover a separate matching object', () => {
    const width = 80, height = 80;
    const rgba = photo(width, height, (x, y) => x >= 10 && x <= 25 && y >= 10 && y <= 35 || x >= 50 && x <= 65 && y >= 45 && y <= 70 ? [191, 171, 164, 255] : [190, 208, 215, 255]);
    const existingMask = createForegroundMaskRaster(width, height); existingMask.alpha[55 * width + 55] = 255;
    const result = smartSelectForeground({ rgba, width, height, seed: { x: 15, y: 20 }, sensitivity: .4, existingMask });
    const raster = foregroundMaskRegionRaster(result.region);
    expect(raster.alpha[20 * width + 15]).toBe(255);
    expect(raster.alpha[55 * width + 55]).toBe(0);
    const inferred = smartSelectForeground({ rgba, width, height, sensitivity: .4, existingMask });
    expect(foregroundMaskRegionRaster(inferred.region).alpha[55 * width + 55]).toBe(255);
  });

  it('restricts growth to openings while accepting an object continuing across the opening boundary', () => {
    const width = 80, height = 80, allowedMask = new Uint8Array(width * height);
    for (let y = 10; y <= 60; y++) for (let x = 10; x <= 49; x++) allowedMask[y * width + x] = 1;
    const rgba = photo(width, height, (x, y) => x >= 35 && x <= 65 && y >= 25 && y <= 45 ? [191, 171, 164, 255] : [190, 208, 215, 255]);
    const result = smartSelectForeground({ rgba, width, height, seed: { x: 40, y: 30 }, sensitivity: .4, allowedMask });
    const raster = foregroundMaskRegionRaster(result.region);
    expect(raster.alpha[35 * width + 49]).toBeGreaterThan(0);
    expect(raster.alpha[35 * width + 50]).toBe(0);
    expect(result.touchesEdge).toBe(false); expect(result.confidence).toBe('high');
    expect(() => smartSelectForeground({ rgba, width, height, seed: { x: 55, y: 30 }, sensitivity: .4, allowedMask })).toThrow(/inside an artwork opening/);
  });

  it('does not fill a large blue artwork area surrounded by a similarly coloured frame', () => {
    const width = 100, height = 100;
    const rgba = photo(width, height, (x, y) => x >= 10 && x <= 89 && y >= 10 && y <= 89 && !(x >= 20 && x <= 79 && y >= 20 && y <= 79) ? [191, 171, 164, 255] : [190, 208, 215, 255]);
    const result = smartSelectForeground({ rgba, width, height, seed: { x: 15, y: 30 }, sensitivity: .4 });
    expect(foregroundMaskRegionRaster(result.region).alpha[50 * width + 50]).toBe(0);
    expect(result.selectedPixelCount).toBeLessThan(3000);
  });

  it('reports broad leaking selections as uncertain and rejects incomplete source pixels', () => {
    const rgba = photo(40, 40, () => [191, 171, 164, 255]);
    expect(smartSelectForeground({ rgba, width: 40, height: 40, seed: { x: 20, y: 20 }, sensitivity: .4 }).confidence).toBe('low');
    expect(() => smartSelectForeground({ rgba: new Uint8Array(4), width: 40, height: 40, seed: { x: 20, y: 20 }, sensitivity: .4 })).toThrow(/incomplete/);
  });
});

describe('filling foreground mask gaps as an ordered region operation', () => {
  it('returns only newly increased alpha, fills enclosed holes and retains the existing soft outline after replay', () => {
    const raster = createForegroundMaskRaster(40, 40);
    for (let y = 10; y <= 29; y++) for (let x = 10; x <= 29; x++) raster.alpha[y * 40 + x] = x === 10 || y === 10 || x === 29 || y === 29 ? 170 : 255;
    raster.alpha[20 * 40 + 20] = 0;
    const region = fillForegroundMaskHoles(raster, { gapRadius: 0 }), added = foregroundMaskRegionRaster(region);
    expect(added.alpha[20 * 40 + 20]).toBe(255);
    expect(added.alpha[10 * 40 + 20]).toBe(0);
    expect(added.alpha[15 * 40 + 15]).toBe(0);
    const merged = rasterizeForegroundMask({ version: 1, strokes: [
      createForegroundRegionStroke({ width: 40, height: 40, runs: [[10 * 40 + 20, 1, 170]] }), createForegroundRegionStroke(region),
    ] }, 40, 40);
    expect(merged.alpha[10 * 40 + 20]).toBe(170); expect(merged.alpha[20 * 40 + 20]).toBe(255);
  });

  it('is a no-op for a solid painted area instead of adding duplicate saved regions', () => {
    const raster = createForegroundMaskRaster(40, 40);
    for (let y = 10; y <= 29; y++) for (let x = 10; x <= 29; x++) raster.alpha[y * 40 + x] = 255;
    expect(fillForegroundMaskHoles(raster).runs).toEqual([]);
  });

  it('leaves a complete soft brush unchanged instead of hardening its existing feather', () => {
    const raster = rasterizeForegroundMask({ version: 1, strokes: [{ mode: 'paint', size: 30, softness: .8, points: [{ x: 20, y: 20 }] }] }, 40, 40);
    expect(fillForegroundMaskHoles(raster).runs).toEqual([]);
    const originalEdge = raster.alpha[20 * 40 + 30];
    raster.alpha[20 * 40 + 20] = 0;
    const region = foregroundMaskRegionRaster(fillForegroundMaskHoles(raster));
    expect(region.alpha[20 * 40 + 20]).toBe(255);
    expect(region.alpha[20 * 40 + 30]).toBe(0);
    expect(raster.alpha[20 * 40 + 30]).toBe(originalEdge);
  });

  it('closes a small outlined gap before filling the enclosed interior', () => {
    const raster = createForegroundMaskRaster(40, 40);
    for (let position = 10; position <= 29; position++) {
      raster.alpha[10 * 40 + position] = raster.alpha[29 * 40 + position] = 255;
      raster.alpha[position * 40 + 10] = raster.alpha[position * 40 + 29] = 255;
    }
    raster.alpha[10 * 40 + 20] = 0;
    const filled = foregroundMaskRegionRaster(fillForegroundMaskHoles(raster, { gapRadius: 1 }));
    expect(filled.alpha[20 * 40 + 20]).toBe(255);
    expect(filled.alpha[10 * 40 + 20]).toBeGreaterThan(0);
    expect(filled.alpha[0]).toBe(0);
  });
});
