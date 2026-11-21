import { describe, expect, it } from 'vitest';
import {
  applyForegroundMaskStroke, createForegroundMaskRaster, maskAlphaAtPixel, rasterizeForegroundMask, validateForegroundMask,
  foregroundMaskRegionFromRaster, foregroundMaskRegionRaster,
} from '@/lib/our-template-image-foreground-mask';
import type { ForegroundMaskStroke, OurTemplateImageForegroundMask } from '@/lib/our-template-image-types';

function stroke(changes: Partial<ForegroundMaskStroke> = {}): ForegroundMaskStroke {
  return { mode: 'paint', size: 20, softness: 0, points: [{ x: 30, y: 30 }], ...changes };
}
function mask(strokes: ForegroundMaskStroke[]): OurTemplateImageForegroundMask { return { version: 1, strokes }; }

describe('foreground brush rasterization shared by the editor and renderer', () => {
  it('joins brush points into round capped strokes in original pixel coordinates', () => {
    const raster = rasterizeForegroundMask(mask([stroke({ points: [{ x: 20, y: 30 }, { x: 80, y: 30 }] })]), 100, 80);
    expect(maskAlphaAtPixel(raster, 50, 30)).toBe(1);
    expect(maskAlphaAtPixel(raster, 10, 30)).toBe(1);
    expect(maskAlphaAtPixel(raster, 9, 30)).toBe(0);
    expect(maskAlphaAtPixel(raster, 50, 41)).toBe(0);
  });

  it('uses a deterministic soft edge and lets erasing remove or feather retained pixels', () => {
    const raster = rasterizeForegroundMask(mask([stroke({ softness: 1 })]), 100, 80);
    expect(raster.alpha[30 * 100 + 30]).toBe(255);
    expect(raster.alpha[30 * 100 + 35]).toBe(128);
    expect(raster.alpha[30 * 100 + 40]).toBe(0);
    applyForegroundMaskStroke(raster, stroke({ mode: 'erase', size: 10 }));
    expect(maskAlphaAtPixel(raster, 30, 30)).toBe(0);
    expect(maskAlphaAtPixel(raster, 35, 30)).toBe(0);
    expect(maskAlphaAtPixel(raster, 36, 30)).toBeGreaterThan(0);
    applyForegroundMaskStroke(raster, stroke({ size: 2 }));
    expect(maskAlphaAtPixel(raster, 30, 30)).toBe(1);
  });

  it('replays incremental pointer segments exactly without reallocating the mask image', () => {
    const complete = stroke({ softness: .6, points: [{ x: 10, y: 20 }, { x: 30, y: 35 }, { x: 55, y: 25 }, { x: 80, y: 60 }] });
    const expected = rasterizeForegroundMask(mask([complete]), 100, 80);
    const incremental = createForegroundMaskRaster(100, 80), originalBuffer = incremental.alpha;
    for (let count = 1; count <= complete.points.length; count++) {
      const dirty = applyForegroundMaskStroke(incremental, { ...complete, points: complete.points.slice(0, count) }, { fromPointIndex: count - 1 });
      expect(dirty).not.toBeNull();
      expect(incremental.alpha).toBe(originalBuffer);
    }
    expect(incremental.alpha).toEqual(expected.alpha);
    expect(applyForegroundMaskStroke(incremental, complete)).toBeNull();
  });

  it('uses original coordinates and brush diameter when the preview raster is scaled', () => {
    const original = stroke({ softness: .6, points: [{ x: 50, y: 40 }, { x: 75, y: 50 }] });
    const scaled = rasterizeForegroundMask(mask([original]), 50, 40, { sourceWidth: 100, sourceHeight: 80 });
    const previewStroke = { ...original, size: original.size / 2, points: original.points.map(({ x, y }) => ({ x: (x + .5) / 2 - .5, y: (y + .5) / 2 - .5 })) };
    expect(scaled.alpha).toEqual(rasterizeForegroundMask(mask([previewStroke]), 50, 40).alpha);
  });

  it('returns only touched pixels as the dirty rectangle and treats outside samples as empty', () => {
    const raster = createForegroundMaskRaster(1000, 800);
    expect(applyForegroundMaskStroke(raster, stroke({ size: 4 }))).toEqual({ left: 28, top: 28, width: 5, height: 5 });
    expect(maskAlphaAtPixel(raster, -1, 30)).toBe(0);
    expect(maskAlphaAtPixel(raster, 1000, 30)).toBe(0);
  });
});

describe('foreground mask persistence validation', () => {
  it('retains fractional original coordinates and canonical paint/erase data', () => {
    const value = mask([stroke({ points: [{ x: 30.25, y: 40.75 }] }), stroke({ mode: 'erase' })]);
    expect(validateForegroundMask(value, 100, 80)).toEqual(value);
    expect(validateForegroundMask(mask([]), 100, 80)).toEqual(mask([]));
  });

  it('rejects unsupported modes, malformed brushes and coordinates outside the original image', () => {
    for (const value of [null, { version: 2, strokes: [] }, { version: 1, strokes: 'invalid' }]) {
      expect(() => validateForegroundMask(value, 100, 80)).toThrow(/foreground mask/);
    }
    for (const changes of [
      { mode: 'unknown' }, { size: 0 }, { size: 201 }, { size: Infinity }, { size: NaN },
      { softness: -.1 }, { softness: 1.1 }, { softness: NaN }, { points: [] },
      { points: [{ x: -1, y: 30 }] }, { points: [{ x: 100, y: 30 }] }, { points: [{ x: 30, y: 80 }] },
      { points: [{ x: NaN, y: 30 }] },
    ]) expect(() => validateForegroundMask(mask([stroke(changes as Partial<ForegroundMaskStroke>)]), 100, 80)).toThrow(/foreground mask/);
  });

  it('bounds stroke and point counts before rasterization', () => {
    expect(() => validateForegroundMask(mask(Array(1001).fill(stroke())), 100, 80)).toThrow(/1000 strokes/);
    expect(() => validateForegroundMask(mask([stroke({ points: Array(100001).fill({ x: 30, y: 30 }) })]), 100, 80)).toThrow(/100000 brush points/);
  });

  it('validates compact regions while retaining their paint/erase order with legacy brushes', () => {
    const source = createForegroundMaskRaster(20, 20); source.alpha.fill(255, 200, 220);
    const region = foregroundMaskRegionFromRaster(source);
    expect(region.runs).toEqual([[200, 20, 255]]);
    expect(foregroundMaskRegionRaster(region).alpha).toEqual(source.alpha);
    const regionStroke = stroke({ size: 1, softness: 0, points: [], region });
    const erased = stroke({ mode: 'erase', size: 4, points: [{ x: 10, y: 10 }] });
    const saved = validateForegroundMask(mask([regionStroke, erased, regionStroke]), 20, 20);
    expect(rasterizeForegroundMask(saved, 20, 20).alpha[210]).toBe(255);
    expect(rasterizeForegroundMask(mask([regionStroke, erased]), 20, 20).alpha[210]).toBe(0);
  });

  it('rejects oversized, malformed, overlapping or out-of-grid region runs', () => {
    for (const region of [
      { width: 1537, height: 1537, runs: [] }, { width: 20, height: 5, runs: [] },
      { width: 20, height: 20, runs: [[0, 0, 255]] }, { width: 20, height: 20, runs: [[0, 5, 0]] },
      { width: 20, height: 20, runs: [[399, 2, 255]] }, { width: 20, height: 20, runs: [[10, 5, 255], [12, 2, 255]] },
    ]) expect(() => validateForegroundMask(mask([stroke({ points: [], region: region as never })]), 20, 20)).toThrow(/foreground mask region/);
    expect(() => validateForegroundMask(mask([stroke({ region: { width: 20, height: 20, runs: [[0, 1, 255]] } })]), 20, 20)).toThrow(/also contain brush points/);
  });
});
