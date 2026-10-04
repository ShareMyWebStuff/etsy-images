import sharp from 'sharp';

import { ETSY_PRIMARY_COLOURS } from '@/lib/etsy-colours';

type Rgb = readonly [number, number, number];
type Lab = readonly [number, number, number];

const ETSY_ANALYSIS_RGB: Record<string, Rgb> = {
  beige: [210, 180, 140],
  black: [25, 25, 25],
  blue: [45, 100, 180],
  bronze: [150, 105, 55],
  brown: [115, 75, 45],
  copper: [184, 115, 51],
  gold: [212, 175, 55],
  gray: [128, 128, 128],
  green: [70, 130, 80],
  orange: [230, 130, 35],
  pink: [225, 150, 175],
  purple: [130, 80, 155],
  red: [190, 55, 50],
  'rose-gold': [183, 110, 121],
  silver: [185, 190, 195],
  white: [245, 245, 245],
  yellow: [235, 205, 55],
};

const ANALYSIS_COLOURS = ETSY_PRIMARY_COLOURS.flatMap((colour) => {
  const rgb = ETSY_ANALYSIS_RGB[colour.value];
  return rgb ? [{ ...colour, rgb, lab: rgbToLab(rgb) }] : [];
});

function rgbToLab([red, green, blue]: Rgb): Lab {
  const linear = [red, green, blue].map((channel) => {
    const value = channel / 255;
    return value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
  });
  const x = (linear[0] * 0.4124 + linear[1] * 0.3576 + linear[2] * 0.1805) / 0.95047;
  const y = linear[0] * 0.2126 + linear[1] * 0.7152 + linear[2] * 0.0722;
  const z = (linear[0] * 0.0193 + linear[1] * 0.1192 + linear[2] * 0.9505) / 1.08883;
  const convert = (value: number) => value > 0.008856 ? Math.cbrt(value) : 7.787 * value + 16 / 116;
  const fx = convert(x);
  const fy = convert(y);
  const fz = convert(z);
  return [116 * fy - 16, 500 * (fx - fy), 200 * (fy - fz)];
}

function labDistance(first: Lab, second: Lab) {
  return (first[0] - second[0]) ** 2
    + (first[1] - second[1]) ** 2
    + (first[2] - second[2]) ** 2;
}

function pixelOffset(width: number, x: number, y: number) {
  return (y * width + x) * 4;
}

function isNearWhiteBackgroundPixel(data: Buffer, offset: number) {
  const red = data[offset];
  const green = data[offset + 1];
  const blue = data[offset + 2];
  return data[offset + 3] >= 64
    && Math.min(red, green, blue) >= 225
    && Math.max(red, green, blue) - Math.min(red, green, blue) <= 30;
}

function connectedWhiteBackground(data: Buffer, width: number, height: number) {
  const mask = new Uint8Array(width * height);
  const queue: number[] = [];
  const add = (x: number, y: number) => {
    const index = y * width + x;
    if (mask[index] || !isNearWhiteBackgroundPixel(data, pixelOffset(width, x, y))) return;
    mask[index] = 1;
    queue.push(index);
  };

  for (let x = 0; x < width; x += 1) {
    add(x, 0);
    if (height > 1) add(x, height - 1);
  }
  for (let y = 1; y < height - 1; y += 1) {
    add(0, y);
    if (width > 1) add(width - 1, y);
  }

  for (let cursor = 0; cursor < queue.length; cursor += 1) {
    const index = queue[cursor];
    const x = index % width;
    const y = Math.floor(index / width);
    if (x > 0) add(x - 1, y);
    if (x + 1 < width) add(x + 1, y);
    if (y > 0) add(x, y - 1);
    if (y + 1 < height) add(x, y + 1);
  }
  return mask;
}

export type DetectedEtsyColour = {
  value: string;
  label: string;
  pixelCount: number;
  percentage: number;
};

export async function detectDominantEtsyColours(image: Buffer): Promise<[DetectedEtsyColour, DetectedEtsyColour]> {
  const { data, info } = await sharp(image, { failOn: 'error' })
    .ensureAlpha()
    .resize({ width: 256, height: 256, fit: 'inside', withoutEnlargement: true })
    .raw()
    .toBuffer({ resolveWithObject: true });
  const background = connectedWhiteBackground(data, info.width, info.height);
  const counts = new Map(ANALYSIS_COLOURS.map((colour) => [colour.value, 0]));
  const aggregateDistances = new Map(ANALYSIS_COLOURS.map((colour) => [colour.value, 0]));
  let visiblePixels = 0;

  for (let index = 0; index < info.width * info.height; index += 1) {
    const offset = index * 4;
    const alpha = data[offset + 3];
    if (alpha < 64 || background[index]) continue;
    const lab = rgbToLab([data[offset], data[offset + 1], data[offset + 2]]);
    let closest = ANALYSIS_COLOURS[0];
    let closestDistance = Number.POSITIVE_INFINITY;
    for (const colour of ANALYSIS_COLOURS) {
      const distance = labDistance(lab, colour.lab);
      aggregateDistances.set(colour.value, aggregateDistances.get(colour.value)! + distance);
      if (distance < closestDistance) {
        closest = colour;
        closestDistance = distance;
      }
    }
    counts.set(closest.value, counts.get(closest.value)! + 1);
    visiblePixels += 1;
  }

  if (visiblePixels === 0) throw new Error('The thumbnail does not contain enough visible artwork to determine Etsy colours.');
  const ranked = ANALYSIS_COLOURS
    .map((colour) => ({ ...colour, pixelCount: counts.get(colour.value)! }))
    .filter((colour) => colour.pixelCount > 0)
    .sort((first, second) => second.pixelCount - first.pixelCount);
  const primary = ranked[0];
  const secondary = ranked[1] ?? ANALYSIS_COLOURS
    .filter((colour) => colour.value !== primary.value)
    .sort((first, second) => aggregateDistances.get(first.value)! - aggregateDistances.get(second.value)!)[0];

  return [primary, secondary].map((colour) => ({
    value: colour.value,
    label: colour.label,
    pixelCount: colour.pixelCount ?? 0,
    percentage: Math.round(((colour.pixelCount ?? 0) / visiblePixels) * 10_000) / 100,
  })) as [DetectedEtsyColour, DetectedEtsyColour];
}
