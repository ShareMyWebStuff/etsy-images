import type { ForegroundMaskRegion, ForegroundMaskStroke, OurTemplateImageForegroundMask } from '@/lib/our-template-image-types';

export const MAX_FOREGROUND_MASK_STROKES = 1000;
export const MAX_FOREGROUND_MASK_POINTS = 100000;
export const MAX_FOREGROUND_REGION_EDGE = 1536;
export const MAX_FOREGROUND_REGION_RUNS = 120000;
export type ForegroundMaskRaster = { width: number; height: number; alpha: Uint8Array };
export type ForegroundMaskDirtyRect = { left: number; top: number; width: number; height: number };
export type ForegroundMaskRasterOptions = { sourceWidth?: number; sourceHeight?: number; fromPointIndex?: number };

export function validateForegroundMask(value: unknown, width: number, height: number): OurTemplateImageForegroundMask {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('The foreground mask is invalid.');
  const record = value as Record<string, unknown>;
  if (record.version !== 1 || !Array.isArray(record.strokes)) throw new Error('The foreground mask needs version 1 and a list of brush strokes.');
  if (record.strokes.length > MAX_FOREGROUND_MASK_STROKES) throw new Error(`The foreground mask may contain no more than ${MAX_FOREGROUND_MASK_STROKES} strokes.`);
  let pointCount = 0, regionRunCount = 0;
  const strokes = record.strokes.map((value): ForegroundMaskStroke => {
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('The foreground mask has an invalid brush stroke.');
    const stroke = value as Record<string, unknown>;
    if (stroke.mode !== 'paint' && stroke.mode !== 'erase') throw new Error('The foreground mask brush mode must be paint or erase.');
    if (stroke.region !== undefined) {
      if (!Array.isArray(stroke.points) || stroke.points.length) throw new Error('The foreground mask region cannot also contain brush points.');
      const region = validateForegroundMaskRegion(stroke.region, width, height);
      regionRunCount += region.runs.length;
      if (regionRunCount > MAX_FOREGROUND_REGION_RUNS) throw new Error(`The foreground mask may contain no more than ${MAX_FOREGROUND_REGION_RUNS} region runs.`);
      return { mode: stroke.mode, size: 1, softness: 0, points: [], region };
    }
    if (typeof stroke.size !== 'number' || !Number.isFinite(stroke.size) || stroke.size <= 0 || stroke.size > Math.max(width, height) * 2) {
      throw new Error('The foreground mask brush size must be positive and no greater than twice the original image edge.');
    }
    if (typeof stroke.softness !== 'number' || !Number.isFinite(stroke.softness) || stroke.softness < 0 || stroke.softness > 1) {
      throw new Error('The foreground mask brush softness must be between 0 and 1.');
    }
    if (!Array.isArray(stroke.points) || !stroke.points.length) throw new Error('The foreground mask brush stroke needs at least one point.');
    pointCount += stroke.points.length;
    if (pointCount > MAX_FOREGROUND_MASK_POINTS) throw new Error(`The foreground mask may contain no more than ${MAX_FOREGROUND_MASK_POINTS} brush points.`);
    const points = stroke.points.map((value) => {
      if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('The foreground mask has an invalid brush point.');
      const point = value as Record<string, unknown>;
      if (typeof point.x !== 'number' || typeof point.y !== 'number' || !Number.isFinite(point.x) || !Number.isFinite(point.y)
        || point.x < 0 || point.x > width - 1 || point.y < 0 || point.y > height - 1) {
        throw new Error('The foreground mask brush points must stay inside the original image dimensions.');
      }
      return { x: point.x, y: point.y };
    });
    return { mode: stroke.mode, size: stroke.size, softness: stroke.softness, points };
  });
  return { version: 1, strokes };
}

export function validateForegroundMaskRegion(value: unknown, sourceWidth: number, sourceHeight: number): ForegroundMaskRegion {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('The foreground mask region is invalid.');
  const region = value as Record<string, unknown>, width = region.width as number, height = region.height as number;
  if (!Number.isInteger(width) || !Number.isInteger(height) || width < 1 || height < 1
    || width > MAX_FOREGROUND_REGION_EDGE || height > MAX_FOREGROUND_REGION_EDGE
    || width > sourceWidth || height > sourceHeight || Math.abs(height - sourceHeight * width / sourceWidth) > 1) {
    throw new Error(`The foreground mask region must preserve the original image proportions on a grid no larger than ${MAX_FOREGROUND_REGION_EDGE} pixels per edge.`);
  }
  if (!Array.isArray(region.runs) || region.runs.length > MAX_FOREGROUND_REGION_RUNS) throw new Error('The foreground mask region has too many runs.');
  let previousEnd = 0;
  const runs = region.runs.map((value): [number, number, number] => {
    if (!Array.isArray(value) || value.length !== 3) throw new Error('The foreground mask region run is invalid.');
    const [start, length, alpha] = value;
    if (!Number.isSafeInteger(start) || !Number.isSafeInteger(length) || !Number.isInteger(alpha)
      || start < previousEnd || length < 1 || alpha < 1 || alpha > 255 || start + length > width * height) {
      throw new Error('The foreground mask region runs must be sorted, non-overlapping and inside their grid.');
    }
    previousEnd = start + length;
    return [start, length, alpha];
  });
  return { width, height, runs };
}

export function createForegroundMaskRaster(width: number, height: number): ForegroundMaskRaster {
  if (!Number.isInteger(width) || !Number.isInteger(height) || width < 1 || height < 1 || width * height > 64000000) {
    throw new Error('The foreground mask raster dimensions are invalid.');
  }
  return { width, height, alpha: new Uint8Array(width * height) };
}

function segmentDistanceSquared(x: number, y: number, first: { x: number; y: number }, second: { x: number; y: number }) {
  const dx = second.x - first.x, dy = second.y - first.y, lengthSquared = dx * dx + dy * dy;
  const t = lengthSquared ? Math.max(0, Math.min(1, ((x - first.x) * dx + (y - first.y) * dy) / lengthSquared)) : 0;
  return (x - first.x - t * dx) ** 2 + (y - first.y - t * dy) ** 2;
}

/**
 * Mutates just the touched pixels; callers can redraw the returned rectangle.
 * Replaying overlapping segments is idempotent, so incremental pointer strokes
 * and a server replay produce identical masks independent of event frequency.
 */
export function applyForegroundMaskStroke(raster: ForegroundMaskRaster, stroke: ForegroundMaskStroke,
  options: ForegroundMaskRasterOptions = {}): ForegroundMaskDirtyRect | null {
  if (stroke.region) return applyForegroundMaskRegion(raster, stroke.region, stroke.mode);
  const sourceWidth = options.sourceWidth ?? raster.width, sourceHeight = options.sourceHeight ?? raster.height;
  const scaleX = raster.width / sourceWidth, scaleY = raster.height / sourceHeight;
  const radius = stroke.size / 2, innerRadius = radius * (1 - stroke.softness), radiusSquared = radius * radius;
  let dirtyLeft = raster.width, dirtyTop = raster.height, dirtyRight = -1, dirtyBottom = -1;
  const fromPointIndex = Math.max(0, Math.floor(options.fromPointIndex ?? 0));
  for (let index = fromPointIndex; index < stroke.points.length; index++) {
    // Starting at the newly appended point also joins its previous endpoint.
    const first = stroke.points[Math.max(0, index - 1)], second = stroke.points[index];
    const left = Math.max(0, Math.floor((Math.min(first.x, second.x) - radius + .5) * scaleX - .5));
    const right = Math.min(raster.width - 1, Math.ceil((Math.max(first.x, second.x) + radius + .5) * scaleX - .5));
    const top = Math.max(0, Math.floor((Math.min(first.y, second.y) - radius + .5) * scaleY - .5));
    const bottom = Math.min(raster.height - 1, Math.ceil((Math.max(first.y, second.y) + radius + .5) * scaleY - .5));
    for (let y = top; y <= bottom; y++) for (let x = left; x <= right; x++) {
      const sourceX = (x + .5) / scaleX - .5, sourceY = (y + .5) / scaleY - .5;
      const distanceSquared = segmentDistanceSquared(sourceX, sourceY, first, second);
      if (distanceSquared > radiusSquared) continue;
      const distance = Math.sqrt(distanceSquared);
      const coverage = stroke.softness === 0 || distance <= innerRadius ? 255 : Math.round(255 * (radius - distance) / (radius - innerRadius));
      const offset = y * raster.width + x, previous = raster.alpha[offset];
      const next = stroke.mode === 'paint' ? Math.max(previous, coverage) : Math.min(previous, 255 - coverage);
      if (next === previous) continue;
      raster.alpha[offset] = next;
      dirtyLeft = Math.min(dirtyLeft, x); dirtyRight = Math.max(dirtyRight, x);
      dirtyTop = Math.min(dirtyTop, y); dirtyBottom = Math.max(dirtyBottom, y);
    }
  }
  return dirtyRight < dirtyLeft ? null : { left: dirtyLeft, top: dirtyTop, width: dirtyRight - dirtyLeft + 1, height: dirtyBottom - dirtyTop + 1 };
}

/** Encode only nonzero runs; 17-step alpha keeps soft outlines compact. */
export function foregroundMaskRegionFromRaster(raster: ForegroundMaskRaster): ForegroundMaskRegion {
  if (raster.width > MAX_FOREGROUND_REGION_EDGE || raster.height > MAX_FOREGROUND_REGION_EDGE) throw new Error('Reduce the foreground selection grid before saving it.');
  const runs: ForegroundMaskRegion['runs'] = [];
  let start = 0, previous = 0;
  for (let index = 0; index <= raster.alpha.length; index++) {
    const alpha = index < raster.alpha.length ? Math.round(raster.alpha[index] / 17) * 17 : 0;
    if (alpha === previous) continue;
    if (previous) runs.push([start, index - start, previous]);
    start = index; previous = alpha;
  }
  if (runs.length > MAX_FOREGROUND_REGION_RUNS) throw new Error('This foreground selection is too detailed. Reduce its sensitivity or clear unneeded details before saving.');
  return { width: raster.width, height: raster.height, runs };
}

export function foregroundMaskRegionRaster(region: ForegroundMaskRegion): ForegroundMaskRaster {
  const raster = createForegroundMaskRaster(region.width, region.height);
  for (const [start, length, alpha] of region.runs) raster.alpha.fill(alpha, start, start + length);
  return raster;
}

function applyForegroundMaskRegion(raster: ForegroundMaskRaster, region: ForegroundMaskRegion, mode: 'paint' | 'erase'): ForegroundMaskDirtyRect | null {
  if (!region.runs.length) return null;
  const source = foregroundMaskRegionRaster(region), scaleX = raster.width / region.width, scaleY = raster.height / region.height;
  let minX = region.width, maxX = -1, minY = region.height, maxY = -1;
  for (const [start, length] of region.runs) {
    const end = start + length - 1, firstY = Math.floor(start / region.width), lastY = Math.floor(end / region.width);
    minY = Math.min(minY, firstY); maxY = Math.max(maxY, lastY);
    minX = Math.min(minX, firstY === lastY ? start % region.width : 0);
    maxX = Math.max(maxX, firstY === lastY ? end % region.width : region.width - 1);
  }
  const left = Math.max(0, Math.floor((minX - .5) * scaleX - .5)), right = Math.min(raster.width - 1, Math.ceil((maxX + 1.5) * scaleX - .5));
  const top = Math.max(0, Math.floor((minY - .5) * scaleY - .5)), bottom = Math.min(raster.height - 1, Math.ceil((maxY + 1.5) * scaleY - .5));
  let dirtyLeft = raster.width, dirtyRight = -1, dirtyTop = raster.height, dirtyBottom = -1;
  for (let y = top; y <= bottom; y++) for (let x = left; x <= right; x++) {
    const gx = Math.max(0, Math.min(region.width - 1, (x + .5) / scaleX - .5));
    const gy = Math.max(0, Math.min(region.height - 1, (y + .5) / scaleY - .5));
    const x0 = Math.floor(gx), y0 = Math.floor(gy), x1 = Math.min(region.width - 1, x0 + 1), y1 = Math.min(region.height - 1, y0 + 1), wx = gx - x0, wy = gy - y0;
    const alpha = Math.round((source.alpha[y0 * region.width + x0] * (1 - wx) + source.alpha[y0 * region.width + x1] * wx) * (1 - wy)
      + (source.alpha[y1 * region.width + x0] * (1 - wx) + source.alpha[y1 * region.width + x1] * wx) * wy);
    const offset = y * raster.width + x, previous = raster.alpha[offset], next = mode === 'paint' ? Math.max(previous, alpha) : Math.min(previous, 255 - alpha);
    if (next === previous) continue;
    raster.alpha[offset] = next; dirtyLeft = Math.min(dirtyLeft, x); dirtyRight = Math.max(dirtyRight, x); dirtyTop = Math.min(dirtyTop, y); dirtyBottom = Math.max(dirtyBottom, y);
  }
  return dirtyRight < dirtyLeft ? null : { left: dirtyLeft, top: dirtyTop, width: dirtyRight - dirtyLeft + 1, height: dirtyBottom - dirtyTop + 1 };
}

export function rasterizeForegroundMask(mask: OurTemplateImageForegroundMask, width: number, height: number,
  options: Pick<ForegroundMaskRasterOptions, 'sourceWidth' | 'sourceHeight'> = {}): ForegroundMaskRaster {
  const raster = createForegroundMaskRaster(width, height);
  for (const stroke of mask.strokes) applyForegroundMaskStroke(raster, stroke, options);
  return raster;
}

export function maskAlphaAtPixel(raster: ForegroundMaskRaster, x: number, y: number) {
  if (!Number.isFinite(x) || !Number.isFinite(y) || x < 0 || y < 0 || x >= raster.width || y >= raster.height) return 0;
  return raster.alpha[Math.floor(y) * raster.width + Math.floor(x)] / 255;
}
