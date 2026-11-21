import {
  createForegroundMaskRaster, foregroundMaskRegionFromRaster, MAX_FOREGROUND_REGION_EDGE, type ForegroundMaskRaster,
} from '@/lib/our-template-image-foreground-mask';
import type { ForegroundMaskRegion, ForegroundMaskStroke } from '@/lib/our-template-image-types';

export type SmartForegroundSelectionInput = {
  rgba: Uint8Array | Uint8ClampedArray;
  width: number;
  height: number;
  seed?: { x: number; y: number };
  sensitivity: number;
  existingMask?: ForegroundMaskRaster;
  allowedMask?: Uint8Array;
};
export type SmartForegroundSelection = {
  region: ForegroundMaskRegion;
  selectedPixelCount: number;
  touchesEdge: boolean;
  confidence: 'high' | 'low';
};

export function createForegroundRegionStroke(region: ForegroundMaskRegion, mode: 'paint' | 'erase' = 'paint'): ForegroundMaskStroke {
  return { mode, size: 1, softness: 0, points: [], region };
}

function checkGrid(width: number, height: number, allowedMask?: Uint8Array) {
  if (!Number.isInteger(width) || !Number.isInteger(height) || width < 1 || height < 1 || width > MAX_FOREGROUND_REGION_EDGE || height > MAX_FOREGROUND_REGION_EDGE) {
    throw new Error(`Use a foreground analysis image no larger than ${MAX_FOREGROUND_REGION_EDGE} pixels per edge.`);
  }
  if (allowedMask && allowedMask.length !== width * height) throw new Error('The foreground selection boundary does not match the analysis image.');
}

function features(rgba: Uint8Array | Uint8ClampedArray, index: number) {
  const offset = index * 4, r = rgba[offset], g = rgba[offset + 1], b = rgba[offset + 2];
  return { y: .2126 * r + .7152 * g + .0722 * b, rg: r - g, bg: b - g };
}

function existingAlpha(mask: ForegroundMaskRaster, index: number, width: number, height: number) {
  const x = Math.min(mask.width - 1, Math.floor((index % width + .5) * mask.width / width));
  const y = Math.min(mask.height - 1, Math.floor((Math.floor(index / width) + .5) * mask.height / height));
  return mask.alpha[y * mask.width + x];
}

function inferSeed(input: SmartForegroundSelectionInput) {
  if (input.seed) {
    if (!Number.isFinite(input.seed.x) || !Number.isFinite(input.seed.y) || input.seed.x < 0 || input.seed.x >= input.width || input.seed.y < 0 || input.seed.y >= input.height) throw new Error('Click a foreground object inside an artwork opening.');
    return Math.min(input.height - 1, Math.round(input.seed.y)) * input.width + Math.min(input.width - 1, Math.round(input.seed.x));
  }
  if (!input.existingMask) throw new Error('Click an overlapping object or paint a few foreground marks first.');
  const groups = new Map<string, { weight: number; index: number }>();
  for (let index = 0; index < input.width * input.height; index++) {
    if (input.allowedMask && !input.allowedMask[index] || input.rgba[index * 4 + 3] < 8) continue;
    const alpha = existingAlpha(input.existingMask, index, input.width, input.height);
    if (alpha < 192) continue;
    const colour = features(input.rgba, index), key = `${Math.round(colour.rg / 16)}:${Math.round(colour.bg / 16)}`;
    const group = groups.get(key);
    if (group) group.weight += alpha;
    else groups.set(key, { weight: alpha, index });
  }
  const dominant = [...groups.values()].sort((a, b) => b.weight - a.weight)[0];
  if (!dominant) throw new Error('Paint a small solid mark inside the object before refining the foreground.');
  return dominant.index;
}

function morph(input: Uint8Array, width: number, height: number, radius: number, dilate: boolean, allowed?: Uint8Array) {
  const horizontal = new Uint8Array(input.length), output = new Uint8Array(input.length);
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    const index = y * width + x; if (allowed && !allowed[index]) continue;
    let value = dilate ? 0 : 1;
    for (let dx = -radius; dx <= radius; dx++) {
      const nx = x + dx; if (nx < 0 || nx >= width || allowed && !allowed[y * width + nx]) continue;
      if (dilate ? input[y * width + nx] : !input[y * width + nx]) { value = dilate ? 1 : 0; break; }
    }
    horizontal[index] = value;
  }
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    const index = y * width + x; if (allowed && !allowed[index]) continue;
    let value = dilate ? 0 : 1;
    for (let dy = -radius; dy <= radius; dy++) {
      const ny = y + dy; if (ny < 0 || ny >= height || allowed && !allowed[ny * width + x]) continue;
      if (dilate ? horizontal[ny * width + x] : !horizontal[ny * width + x]) { value = dilate ? 1 : 0; break; }
    }
    output[index] = value;
  }
  return output;
}

function fillBinaryHoles(binary: Uint8Array, width: number, height: number, allowed?: Uint8Array, maximumHoleArea = Infinity) {
  const exterior = new Uint8Array(binary.length), queue = new Int32Array(binary.length);
  let head = 0, tail = 0;
  const enqueue = (index: number) => {
    if (binary[index] || exterior[index] || allowed && !allowed[index]) return;
    exterior[index] = 1; queue[tail++] = index;
  };
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    const index = y * width + x;
    if (x === 0 || y === 0 || x === width - 1 || y === height - 1
      || allowed && (!allowed[index - 1] || !allowed[index + 1] || !allowed[index - width] || !allowed[index + width])) enqueue(index);
  }
  while (head < tail) {
    const index = queue[head++], x = index % width, y = Math.floor(index / width);
    if (x > 0) enqueue(index - 1); if (x < width - 1) enqueue(index + 1);
    if (y > 0) enqueue(index - width); if (y < height - 1) enqueue(index + width);
  }
  const output = Uint8Array.from(binary);
  for (let index = 0; index < binary.length; index++) {
    if (binary[index] || exterior[index] || allowed && !allowed[index]) continue;
    head = 0; tail = 1; queue[0] = index; exterior[index] = 2;
    while (head < tail) {
      const current = queue[head++], x = current % width, y = Math.floor(current / width);
      for (const next of [x > 0 ? current - 1 : -1, x < width - 1 ? current + 1 : -1, y > 0 ? current - width : -1, y < height - 1 ? current + width : -1]) {
        if (next < 0 || binary[next] || exterior[next] || allowed && !allowed[next]) continue;
        exterior[next] = 2; queue[tail++] = next;
      }
    }
    if (tail <= maximumHoleArea) for (let position = 0; position < tail; position++) output[queue[position]] = 1;
  }
  return output;
}

function softenBinary(binary: Uint8Array, width: number, height: number, allowed?: Uint8Array) {
  const raster = createForegroundMaskRaster(width, height);
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    const index = y * width + x; if (!binary[index] || allowed && !allowed[index]) continue;
    let count = 0, total = 0;
    for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
      const nx = x + dx, ny = y + dy;
      if (nx < 0 || nx >= width || ny < 0 || ny >= height || allowed && !allowed[ny * width + nx]) continue;
      total++; count += binary[ny * width + nx];
    }
    raster.alpha[index] = Math.round(255 * count / Math.max(1, total));
  }
  return raster;
}

/** Close small brush gaps, fill enclosed holes, and retain the existing soft outline. */
export function fillForegroundMaskHoles(raster: ForegroundMaskRaster, options: { gapRadius?: number; allowedMask?: Uint8Array } = {}): ForegroundMaskRegion {
  checkGrid(raster.width, raster.height, options.allowedMask);
  const radius = Math.max(0, Math.min(8, Math.round(options.gapRadius ?? 2)));
  const originalBinary = Uint8Array.from(raster.alpha, (alpha, index) => alpha >= 128 && (!options.allowedMask || options.allowedMask[index]) ? 1 : 0);
  let binary = originalBinary;
  if (radius) binary = morph(morph(binary, raster.width, raster.height, radius, true, options.allowedMask), raster.width, raster.height, radius, false, options.allowedMask);
  binary = fillBinaryHoles(binary, raster.width, raster.height, options.allowedMask);
  const filled = softenBinary(binary, raster.width, raster.height, options.allowedMask);
  for (let index = 0; index < raster.alpha.length; index++) {
    if (originalBinary[index] || options.allowedMask && !options.allowedMask[index] || filled.alpha[index] <= raster.alpha[index]) filled.alpha[index] = 0;
  }
  return foregroundMaskRegionFromRaster(filled);
}

/** Deterministic, guided photo selection; ambiguous low-contrast objects remain reviewable. */
export function smartSelectForeground(input: SmartForegroundSelectionInput): SmartForegroundSelection {
  checkGrid(input.width, input.height, input.allowedMask);
  if (input.rgba.length < input.width * input.height * 4) throw new Error('The foreground analysis image pixels are incomplete.');
  const sensitivity = Math.max(0, Math.min(1, Number.isFinite(input.sensitivity) ? input.sensitivity : .4));
  const seed = inferSeed(input), { width, height, allowedMask, rgba } = input;
  if (allowedMask && !allowedMask[seed] || rgba[seed * 4 + 3] < 8) throw new Error('Click the visible foreground object inside an artwork opening.');
  const anchor = features(rgba, seed), chromaTolerance = 6 + sensitivity * 20, lightTolerance = 8 + sensitivity * 45;
  const localChromaTolerance = 10 + sensitivity * 30, localLightTolerance = 16 + sensitivity * 55;
  const binary = new Uint8Array(width * height), queue = new Int32Array(width * height);
  let head = 0, tail = 0, domainCount = 0, domainLeft = width, domainRight = -1, domainTop = height, domainBottom = -1;
  const acceptsColour = (index: number, factor = 1) => {
    const colour = features(rgba, index);
    return Math.hypot(colour.rg - anchor.rg, colour.bg - anchor.bg) <= chromaTolerance * factor && Math.abs(colour.y - anchor.y) <= lightTolerance * factor;
  };
  const enqueueSeed = (index: number) => { if (!binary[index]) { binary[index] = 1; queue[tail++] = index; } };
  enqueueSeed(seed);
  for (let index = 0; index < binary.length; index++) {
    if (allowedMask && !allowedMask[index]) continue; domainCount++;
    const x = index % width, y = Math.floor(index / width);
    domainLeft = Math.min(domainLeft, x); domainRight = Math.max(domainRight, x); domainTop = Math.min(domainTop, y); domainBottom = Math.max(domainBottom, y);
  }
  while (head < tail) {
    const index = queue[head++], x = index % width, y = Math.floor(index / width), current = features(rgba, index);
    const neighbours = [x > 0 ? index - 1 : -1, x < width - 1 ? index + 1 : -1, y > 0 ? index - width : -1, y < height - 1 ? index + width : -1];
    for (const next of neighbours) {
      if (next < 0 || binary[next] || allowedMask && !allowedMask[next] || rgba[next * 4 + 3] < 8 || !acceptsColour(next)) continue;
      const candidate = features(rgba, next);
      if (Math.hypot(current.rg - candidate.rg, current.bg - candidate.bg) > localChromaTolerance || Math.abs(current.y - candidate.y) > localLightTolerance) continue;
      binary[next] = 1; queue[tail++] = next;
    }
  }
  const opened = morph(morph(binary, width, height, 1, false, allowedMask), width, height, 1, true, allowedMask);
  const closed = fillBinaryHoles(morph(morph(opened, width, height, 1, true, allowedMask), width, height, 1, false, allowedMask), width, height, allowedMask, Math.max(16, Math.min(2048, tail * .1)));
  let selectedPixelCount = 0, touchesEdge = false, selectedLeft = width, selectedRight = -1, selectedTop = height, selectedBottom = -1;
  for (let index = 0; index < closed.length; index++) if (closed[index]) {
    selectedPixelCount++; const x = index % width, y = Math.floor(index / width);
    selectedLeft = Math.min(selectedLeft, x); selectedRight = Math.max(selectedRight, x); selectedTop = Math.min(selectedTop, y); selectedBottom = Math.max(selectedBottom, y);
    if (x === 0 || y === 0 || x === width - 1 || y === height - 1) touchesEdge = true;
  }
  const selectedWidth = selectedRight - selectedLeft + 1, selectedHeight = selectedBottom - selectedTop + 1;
  const suspiciousBranch = Math.max(selectedWidth, selectedHeight) > Math.min(domainRight - domainLeft + 1, domainBottom - domainTop + 1) * .5
    && Math.max(selectedWidth, selectedHeight) > Math.min(selectedWidth, selectedHeight) * 3;
  return { region: foregroundMaskRegionFromRaster(softenBinary(closed, width, height, allowedMask)), selectedPixelCount, touchesEdge,
    confidence: touchesEdge || suspiciousBranch || selectedPixelCount < 4 || selectedPixelCount > domainCount * .7 ? 'low' : 'high' };
}
