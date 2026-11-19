import sharp from 'sharp';
import { describe, expect, it } from 'vitest';
import { adjustThumbnailGap, analyseThumbnailGap } from './thumbnail-gap';

type Pixel = [number, number, number, number];

async function image(width: number, height: number, pixel: (x: number, y: number) => Pixel) {
  const raw = Buffer.alloc(width * height * 4);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const index = (y * width + x) * 4;
      raw.set(pixel(x, y), index);
    }
  }
  return sharp(raw, { raw: { width, height, channels: 4 } }).png().toBuffer();
}

async function rectangle(width: number, height: number, left: number, top: number, artworkWidth: number, artworkHeight: number) {
  return image(width, height, (x, y) => x >= left && x < left + artworkWidth && y >= top && y < top + artworkHeight
    ? [35, 110, 190, 255] : [0, 0, 0, 0]);
}

async function pixels(buffer: Buffer) {
  return sharp(buffer).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
}

async function image16(width: number, height: number, pixel: (x: number, y: number) => Pixel) {
  const raw = new Uint16Array(width * height * 4);
  for (let y = 0; y < height; y += 1) for (let x = 0; x < width; x += 1) raw.set(pixel(x, y), (y * width + x) * 4);
  return sharp(raw, { raw: { width, height, channels: 4 } }).toColourspace('rgb16').png().toBuffer();
}

async function pixels16(buffer: Buffer) {
  return sharp(buffer).toColourspace('rgb16').ensureAlpha().raw({ depth: 'ushort' }).toBuffer();
}

function pixelAt(raw: Buffer, width: number, x: number, y: number) {
  return [...raw.subarray((y * width + x) * 4, (y * width + x + 1) * 4)];
}

describe('thumbnail gap analysis', () => {
  it('includes every nonzero alpha value in artwork bounds, including alpha 1 tendrils', async () => {
    const input = await image(12, 10, (x, y) => {
      if (x === 1 && y === 2) return [0, 0, 0, 1];
      if (x === 10 && y === 8) return [255, 0, 0, 1];
      if (x >= 4 && x <= 7 && y >= 4 && y <= 6) return [20, 100, 180, 255];
      return [255, 255, 255, 0];
    });
    expect(await analyseThumbnailGap(input)).toEqual({
      eligible: true, reason: null, width: 12, height: 10,
      bounds: { left: 1, top: 2, width: 10, height: 7 }, hasTransparentBackground: true, hasVisibleArtwork: true,
    });
  });

  it('includes alpha 1 in a 16-bit PNG instead of quantising faint artwork to invisible', async () => {
    const input = await image16(10, 10, (x, y) => {
      if ((x === 1 && y === 1) || (x === 8 && y === 8)) return [60000, 10000, 0, 1];
      return x >= 4 && x <= 5 && y >= 4 && y <= 5 ? [20000, 30000, 40000, 65535] : [0, 0, 0, 0];
    });
    expect((await sharp(input).metadata()).depth).toBe('ushort');
    expect((await analyseThumbnailGap(input)).bounds).toEqual({ left: 1, top: 1, width: 8, height: 8 });
  });

  it('does not mistake transparent RGB colour for visible artwork', async () => {
    const input = await image(8, 6, () => [255, 120, 80, 0]);
    expect(await analyseThumbnailGap(input)).toMatchObject({
      eligible: false, reason: expect.stringContaining('no visible artwork'), width: 8, height: 6,
      bounds: null, hasTransparentBackground: true, hasVisibleArtwork: false,
    });
    const result = await adjustThumbnailGap(input, 10);
    expect(result.changed).toBe(false);
    expect(result.buffer).toBe(input);
  });

  it('requires actual fully transparent pixels rather than merely alpha metadata', async () => {
    for (const alpha of [255, 128, 1]) {
      const input = await image(7, 5, () => [20, 80, 140, alpha]);
      expect((await sharp(input).metadata()).hasAlpha).toBe(true);
      expect(await analyseThumbnailGap(input)).toMatchObject({
        eligible: false, reason: expect.stringContaining('no fully transparent background'),
        hasTransparentBackground: false, hasVisibleArtwork: true,
        bounds: { left: 0, top: 0, width: 7, height: 5 },
      });
      const result = await adjustThumbnailGap(input, 10);
      expect(result.changed).toBe(false);
      expect(result.buffer).toBe(input);
    }
  });

  it('disables ordinary opaque RGB images without adding artificial transparent margins', async () => {
    const input = await sharp({ create: { width: 7, height: 5, channels: 3, background: '#f4c188' } }).png().toBuffer();
    expect((await sharp(input).metadata()).hasAlpha).toBe(false);
    expect(await analyseThumbnailGap(input)).toMatchObject({ eligible: false, hasTransparentBackground: false, hasVisibleArtwork: true });
    expect((await adjustThumbnailGap(input, 20)).buffer).toBe(input);
  });

  it.each([Buffer.alloc(0), Buffer.from('this is not an image')])('reports malformed image data safely', async (input) => {
    await expect(analyseThumbnailGap(input)).rejects.toThrow('The thumbnail image could not be read.');
    await expect(adjustThumbnailGap(input, 10)).rejects.toThrow('The thumbnail image could not be read.');
  });
});

describe('thumbnail gap adjustment', () => {
  it('fits a square into a 1000×800 canvas with 5% margins as a centred 720×720 artwork', async () => {
    const input = await rectangle(1000, 800, 10, 20, 200, 200);
    const result = await adjustThumbnailGap(input, 5);
    expect(result.changed).toBe(true);
    expect(result.analysis.bounds).toEqual({ left: 140, top: 40, width: 720, height: 720 });
    expect(await sharp(result.buffer).metadata()).toMatchObject({ format: 'png', width: 1000, height: 800, hasAlpha: true });
    expect(await analyseThumbnailGap(result.buffer)).toEqual(result.analysis);
  });

  it.each([{ size: 4, left: 1, direction: 'up' }, { size: 18, left: 1, direction: 'down' }])('scales artwork $direction to the largest fitting size', async ({ size, left }) => {
    const input = await rectangle(20, 20, left, left, size, size);
    const result = await adjustThumbnailGap(input, 20);
    expect(result.analysis).toMatchObject({ width: 20, height: 20, bounds: { left: 4, top: 4, width: 12, height: 12 } });
    expect(result.changed).toBe(true);
    const again = await adjustThumbnailGap(result.buffer, 20);
    expect(again.changed).toBe(false);
    expect(again.buffer).toBe(result.buffer);
  });

  it('uses ceiling margins for fractional percentages and rounds spare centring pixels deterministically', async () => {
    const fractional = await adjustThumbnailGap(await rectangle(80, 40, 2, 3, 4, 4), 1.25);
    expect(fractional.analysis.bounds).toEqual({ left: 21, top: 1, width: 38, height: 38 });
    const odd = await adjustThumbnailGap(await rectangle(11, 10, 0, 0, 2, 2), 20);
    expect(odd.analysis.bounds).toEqual({ left: 3, top: 2, width: 5, height: 5 });
    expect(10 - (odd.analysis.bounds!.top + odd.analysis.bounds!.height)).toBe(3);
  });

  it('fits non-square artwork without exceeding either inner dimension', async () => {
    const result = await adjustThumbnailGap(await rectangle(101, 81, 0, 0, 8, 4), 20);
    expect(result.analysis.bounds).toEqual({ left: 21, top: 26, width: 59, height: 29 });
  });

  it('allows 0% and touches the limiting canvas edges while retaining the artwork ratio', async () => {
    const result = await adjustThumbnailGap(await rectangle(12, 8, 1, 1, 2, 4), 0);
    expect(result.analysis.bounds).toEqual({ left: 4, top: 0, width: 4, height: 8 });
    const decoded = await pixels(result.buffer);
    expect(pixelAt(decoded.data, 12, 4, 0)[3]).toBeGreaterThan(0);
    expect(pixelAt(decoded.data, 12, 7, 7)[3]).toBeGreaterThan(0);
  });

  it('returns the original buffer byte-for-byte when artwork is already the right size and position', async () => {
    const input = await rectangle(12, 10, 3, 2, 6, 6);
    const result = await adjustThumbnailGap(input, 20);
    expect(result.changed).toBe(false);
    expect(result.buffer).toBe(input);
    expect(result.buffer.equals(input)).toBe(true);
  });

  it('moves correctly sized off-centre artwork without resampling any RGBA pixels', async () => {
    const input = await image(20, 10, (x, y) => {
      if (x < 1 || x >= 7 || y < 1 || y >= 7) return [0, 0, 0, 0];
      return [x * 31, y * 29, (x + y) * 13, x === 3 && y === 3 ? 0 : [1, 32, 128, 255][(x + y) % 4]];
    });
    const before = await pixels(input);
    const result = await adjustThumbnailGap(input, 20);
    const after = await pixels(result.buffer);
    expect(result.analysis.bounds).toEqual({ left: 7, top: 2, width: 6, height: 6 });
    for (let y = 0; y < 6; y += 1) {
      for (let x = 0; x < 6; x += 1) expect(pixelAt(after.data, 20, 7 + x, 2 + y)).toEqual(pixelAt(before.data, 20, 1 + x, 1 + y));
    }
    expect(pixelAt(after.data, 20, 1, 1)).toEqual([0, 0, 0, 0]);
  });

  it('preserves alpha-1 tendrils on all four edges when resizing down', async () => {
    const input = await image(20, 20, (x, y) => {
      if ((x === 0 && y === 10) || (x === 19 && y === 8) || (x === 7 && y === 0) || (x === 12 && y === 19)) return [180, 30, 70, 1];
      if (x >= 8 && x <= 11 && y >= 8 && y <= 11) return [20, 110, 180, 255];
      return [0, 0, 0, 0];
    });
    const result = await adjustThumbnailGap(input, 20);
    expect(result.analysis.bounds).toEqual({ left: 4, top: 4, width: 12, height: 12 });
    const decoded = await pixels(result.buffer);
    for (const [x, y] of [[4, 10], [15, 8], [8, 4], [11, 15]]) expect(pixelAt(decoded.data, 20, x, y)[3]).toBeGreaterThan(0);
    expect(await analyseThumbnailGap(result.buffer)).toEqual(result.analysis);
  });

  it('keeps a thin entirely alpha-1 artwork visible after a reduction', async () => {
    const input = await image(20, 20, (x, y) => x === y || x === 19 - y ? [100, 140, 20, 1] : [0, 0, 0, 0]);
    const result = await adjustThumbnailGap(input, 20);
    expect(result.analysis).toMatchObject({ hasVisibleArtwork: true, bounds: { left: 4, top: 4, width: 12, height: 12 } });
    const decoded = await pixels(result.buffer);
    expect(pixelAt(decoded.data, 20, 4, 4)[3]).toBe(1);
    expect(pixelAt(decoded.data, 20, 15, 15)[3]).toBe(1);
  });

  it('preserves 16-bit samples exactly when only moving the artwork', async () => {
    const input = await image16(20, 10, (x, y) => x >= 1 && x < 7 && y >= 1 && y < 7
      ? [x * 1234, y * 2345, (x + y) * 3456, x === 1 || y === 1 ? 1 : 40000 + x + y] : [0, 0, 0, 0]);
    const before = await pixels16(input);
    const result = await adjustThumbnailGap(input, 20);
    const after = await pixels16(result.buffer);
    expect((await sharp(result.buffer).metadata()).depth).toBe('ushort');
    expect(result.analysis.bounds).toEqual({ left: 7, top: 2, width: 6, height: 6 });
    for (let y = 0; y < 6; y += 1) {
      const originalRow = ((1 + y) * 20 + 1) * 8;
      const movedRow = ((2 + y) * 20 + 7) * 8;
      expect(after.subarray(movedRow, movedRow + 6 * 8)).toEqual(before.subarray(originalRow, originalRow + 6 * 8));
    }
  });

  it('preserves 16-bit alpha-1 tendrils through resize without cutting off their bounds', async () => {
    const input = await image16(20, 20, (x, y) => x === y || x === 19 - y ? [30000, 40000, 5000, 1] : [0, 0, 0, 0]);
    const result = await adjustThumbnailGap(input, 20);
    const raw = await pixels16(result.buffer);
    expect(result.analysis.bounds).toEqual({ left: 4, top: 4, width: 12, height: 12 });
    expect(raw.readUInt16LE(((4 * 20 + 4) * 4 + 3) * 2)).toBe(1);
    expect(raw.readUInt16LE(((15 * 20 + 15) * 4 + 3) * 2)).toBe(1);
    expect(await analyseThumbnailGap(result.buffer)).toEqual(result.analysis);
  });

  it('reports actual output transparency when 0% fills an entire square canvas', async () => {
    const result = await adjustThumbnailGap(await rectangle(10, 10, 3, 3, 4, 4), 0);
    expect(result.analysis).toMatchObject({ eligible: false, hasTransparentBackground: false, hasVisibleArtwork: true, bounds: { left: 0, top: 0, width: 10, height: 10 } });
    expect(await analyseThumbnailGap(result.buffer)).toEqual(result.analysis);
  });

  it.each([-0.01, 20.01, NaN, Infinity, -Infinity, '5' as unknown as number])('rejects invalid percentage %s before decoding', async (percent) => {
    await expect(adjustThumbnailGap(Buffer.from('bad'), percent)).rejects.toThrow('between 0 and 20 percent');
  });

  it('reports an impossible gap on a tiny canvas without returning a damaged image', async () => {
    await expect(adjustThumbnailGap(await rectangle(2, 3, 0, 0, 1, 1), 20)).rejects.toThrow('too large for the thumbnail dimensions');
  });
});
