import sharp from 'sharp';

export type Point = { x: number; y: number };
export type TemplateOpeningCorners = { topLeft: Point; topRight: Point; bottomRight: Point; bottomLeft: Point };
export type TemplateOpeningRegion = {
  id: string;
  name: string;
  corners: TemplateOpeningCorners;
  imageItemNumber?: number;
  topText?: string;
  bottomText?: string;
  fontId?: string;
};
export type TemplateOpening = {
  bounds: { left: number; top: number; width: number; height: number };
  corners: TemplateOpeningCorners;
  mask: Uint8Array;
  axisAligned: boolean;
};
export type TemplateArtworkPresentation = {
  borderEnabled?: boolean;
  borderSizePercent?: number;
};

type Component = {
  pixels: Int32Array;
  count: number;
  minX: number;
  maxX: number;
  minY: number;
  maxY: number;
};

function openingError(message: string): never {
  throw new Error(`The S3 template image ${message}`);
}

function polygonArea(points: Point[]) {
  let sum = 0;
  for (let index = 0; index < points.length; index += 1) {
    const current = points[index];
    const next = points[(index + 1) % points.length];
    sum += current.x * next.y - next.x * current.y;
  }
  return Math.abs(sum) / 2;
}

function distance(first: Point, second: Point) {
  return Math.hypot(second.x - first.x, second.y - first.y);
}

export function validateTemplateOpeningCorners(value: unknown, width: number, height: number): TemplateOpeningCorners {
  if (!value || typeof value !== 'object' || Array.isArray(value)) openingError('does not have four configured opening corners.');
  const record = value as Record<string, unknown>;
  const readPoint = (key: keyof TemplateOpeningCorners) => {
    const point = record[key];
    if (!point || typeof point !== 'object' || Array.isArray(point)) openingError('does not have four valid opening corners.');
    const { x, y } = point as Record<string, unknown>;
    if (!Number.isInteger(x) || !Number.isInteger(y) || (x as number) < 0 || (y as number) < 0 || (x as number) >= width || (y as number) >= height) {
      openingError('has opening coordinates outside its original dimensions.');
    }
    return { x: x as number, y: y as number };
  };
  const corners = {
    topLeft: readPoint('topLeft'),
    topRight: readPoint('topRight'),
    bottomRight: readPoint('bottomRight'),
    bottomLeft: readPoint('bottomLeft'),
  };
  const points = [corners.topLeft, corners.topRight, corners.bottomRight, corners.bottomLeft];
  const crosses = points.map((point, index) => {
    const next = points[(index + 1) % points.length];
    const following = points[(index + 2) % points.length];
    return (next.x - point.x) * (following.y - next.y) - (next.y - point.y) * (following.x - next.x);
  });
  const hasPositive = crosses.some((cross) => cross > 0);
  const hasNegative = crosses.some((cross) => cross < 0);
  const area = polygonArea(points);
  if (hasPositive && hasNegative || crosses.some((cross) => cross === 0) || area < Math.max(16, width * height * 0.0025)) {
    openingError('has opening corners that do not form a valid four-sided print area.');
  }
  const leftAverage = (corners.topLeft.x + corners.bottomLeft.x) / 2;
  const rightAverage = (corners.topRight.x + corners.bottomRight.x) / 2;
  const topAverage = (corners.topLeft.y + corners.topRight.y) / 2;
  const bottomAverage = (corners.bottomLeft.y + corners.bottomRight.y) / 2;
  if (leftAverage >= rightAverage || topAverage >= bottomAverage) {
    openingError('has opening corners in the wrong order. Select top-left, top-right, bottom-right, then bottom-left.');
  }
  return corners;
}

export function validateTemplateOpeningRegions(value: unknown, width: number, height: number): TemplateOpeningRegion[] {
  if (!Array.isArray(value)) openingError('does not have a valid list of artwork regions.');
  if (value.length > 50) openingError('has more than 50 artwork regions.');
  const identifiers = new Set<string>();
  return value.map((item, index) => {
    if (!item || typeof item !== 'object' || Array.isArray(item)) openingError(`has an invalid artwork region at position ${index + 1}.`);
    const record = item as Record<string, unknown>;
    const id = typeof record.id === 'string' ? record.id.trim() : '';
    const name = typeof record.name === 'string' ? record.name.trim() : '';
    if (!id || id.length > 100 || identifiers.has(id)) openingError(`has an invalid or duplicate artwork region at position ${index + 1}.`);
    if (!name || name.length > 100) openingError(`has an invalid artwork region name at position ${index + 1}.`);
    const imageItemNumber = record.imageItemNumber === undefined ? undefined : Number(record.imageItemNumber);
    if (imageItemNumber !== undefined && (!Number.isSafeInteger(imageItemNumber) || imageItemNumber < 1 || imageItemNumber > 100)) {
      openingError(`has an invalid image item number for artwork region ${index + 1}.`);
    }
    const topText = record.topText === undefined ? undefined : typeof record.topText === 'string' ? record.topText : null;
    const bottomText = record.bottomText === undefined ? undefined : typeof record.bottomText === 'string' ? record.bottomText : null;
    const fontId = record.fontId === undefined ? undefined : typeof record.fontId === 'string' ? record.fontId : null;
    if (topText === null || topText !== undefined && topText.length > 40) openingError(`has invalid top text for artwork region ${index + 1}.`);
    if (bottomText === null || bottomText !== undefined && bottomText.length > 40) openingError(`has invalid bottom text for artwork region ${index + 1}.`);
    if (fontId === null || fontId !== undefined && (!fontId.trim() || fontId.length > 50)) openingError(`has an invalid font for artwork region ${index + 1}.`);
    identifiers.add(id);
    return {
      id,
      name,
      corners: validateTemplateOpeningCorners(record.corners, width, height),
      ...(imageItemNumber === undefined ? {} : { imageItemNumber }),
      ...(topText === undefined ? {} : { topText }),
      ...(bottomText === undefined ? {} : { bottomText }),
      ...(fontId === undefined ? {} : { fontId }),
    };
  });
}

function pointInsideQuad(x: number, y: number, corners: TemplateOpeningCorners) {
  const points = [corners.topLeft, corners.topRight, corners.bottomRight, corners.bottomLeft];
  let positive = false;
  let negative = false;
  for (let index = 0; index < points.length; index += 1) {
    const first = points[index];
    const second = points[(index + 1) % points.length];
    const cross = (second.x - first.x) * (y - first.y) - (second.y - first.y) * (x - first.x);
    positive ||= cross > 0;
    negative ||= cross < 0;
  }
  return !(positive && negative);
}

function configuredOpening(value: unknown, width: number, height: number): TemplateOpening {
  const corners = validateTemplateOpeningCorners(value, width, height);
  const points = [corners.topLeft, corners.topRight, corners.bottomRight, corners.bottomLeft];
  const left = Math.max(0, Math.floor(Math.min(...points.map((point) => point.x))));
  const right = Math.min(width - 1, Math.ceil(Math.max(...points.map((point) => point.x))));
  const top = Math.max(0, Math.floor(Math.min(...points.map((point) => point.y))));
  const bottom = Math.min(height - 1, Math.ceil(Math.max(...points.map((point) => point.y))));
  const mask = new Uint8Array(width * height);
  for (let y = top; y <= bottom; y += 1) {
    for (let x = left; x <= right; x += 1) {
      if (pointInsideQuad(x, y, corners)) mask[y * width + x] = 255;
    }
  }
  const tolerance = 1;
  const axisAligned = Math.abs(corners.topLeft.y - corners.topRight.y) <= tolerance
    && Math.abs(corners.bottomLeft.y - corners.bottomRight.y) <= tolerance
    && Math.abs(corners.topLeft.x - corners.bottomLeft.x) <= tolerance
    && Math.abs(corners.topRight.x - corners.bottomRight.x) <= tolerance;
  return { bounds: { left, top, width: right - left + 1, height: bottom - top + 1 }, corners, mask, axisAligned };
}

/** Detects the largest enclosed non-opaque region using only the template alpha channel. */
export function detectTemplateOpening(rgba: Buffer, width: number, height: number): TemplateOpening {
  const pixelCount = width * height;
  if (width <= 0 || height <= 0 || rgba.length < pixelCount * 4) openingError('has invalid RGBA pixel data.');

  // Only fully transparent pixels define the opening. Some exported PNGs apply
  // a low-level alpha value across the whole photograph; including those
  // partially transparent pixels would connect the opening to the canvas edge.
  const candidate = new Uint8Array(pixelCount);
  for (let index = 0; index < pixelCount; index += 1) {
    candidate[index] = rgba[index * 4 + 3] === 0 ? 1 : 0;
  }

  const visited = new Uint8Array(pixelCount);
  const queue = new Int32Array(pixelCount);
  let best: Component | null = null;

  const enqueue = (position: number, tail: number) => {
    if (position < 0 || position >= pixelCount || visited[position] || !candidate[position]) return tail;
    visited[position] = 1;
    queue[tail] = position;
    return tail + 1;
  };

  for (let start = 0; start < pixelCount; start += 1) {
    if (!candidate[start] || visited[start]) continue;
    let head = 0;
    let tail = 0;
    let minX = width;
    let maxX = -1;
    let minY = height;
    let maxY = -1;
    let touchesEdge = false;
    let fullyTransparentPixels = 0;
    visited[start] = 1;
    queue[tail++] = start;

    while (head < tail) {
      const position = queue[head++];
      const x = position % width;
      const y = Math.floor(position / width);
      minX = Math.min(minX, x);
      maxX = Math.max(maxX, x);
      minY = Math.min(minY, y);
      maxY = Math.max(maxY, y);
      touchesEdge ||= x === 0 || y === 0 || x === width - 1 || y === height - 1;
      fullyTransparentPixels += 1;
      if (x > 0) tail = enqueue(position - 1, tail);
      if (x + 1 < width) tail = enqueue(position + 1, tail);
      if (y > 0) tail = enqueue(position - width, tail);
      if (y + 1 < height) tail = enqueue(position + width, tail);
    }

    if (!touchesEdge && fullyTransparentPixels > 0 && (!best || tail > best.count)) {
      best = { pixels: queue.slice(0, tail), count: tail, minX, maxX, minY, maxY };
    }
  }

  const minimumOpeningPixels = Math.max(16, Math.ceil(pixelCount * 0.0025));
  if (!best || best.count < minimumOpeningPixels) {
    openingError('does not contain a reliable enclosed transparent artwork opening.');
  }

  const bounds = {
    left: best.minX,
    top: best.minY,
    width: best.maxX - best.minX + 1,
    height: best.maxY - best.minY + 1,
  };
  if (bounds.width < 4 || bounds.height < 4) openingError('has a transparent opening that is too small.');

  let topLeft = { x: width, y: height };
  let topRight = { x: -1, y: height };
  let bottomRight = { x: -1, y: -1 };
  let bottomLeft = { x: width, y: -1 };
  let minimumSum = Number.POSITIVE_INFINITY;
  let maximumSum = Number.NEGATIVE_INFINITY;
  let maximumDifference = Number.NEGATIVE_INFINITY;
  let minimumDifference = Number.POSITIVE_INFINITY;
  const mask = new Uint8Array(pixelCount);

  for (const position of best.pixels) {
    mask[position] = 255;
    const x = position % width;
    const y = Math.floor(position / width);
    const sum = x + y;
    const difference = x - y;
    if (sum < minimumSum) { minimumSum = sum; topLeft = { x, y }; }
    if (sum > maximumSum) { maximumSum = sum; bottomRight = { x, y }; }
    if (difference > maximumDifference) { maximumDifference = difference; topRight = { x, y }; }
    if (difference < minimumDifference) { minimumDifference = difference; bottomLeft = { x, y }; }
  }

  const tolerance = 1;
  const axisAligned =
    Math.abs(topLeft.x - best.minX) <= tolerance && Math.abs(topLeft.y - best.minY) <= tolerance
    && Math.abs(topRight.x - best.maxX) <= tolerance && Math.abs(topRight.y - best.minY) <= tolerance
    && Math.abs(bottomRight.x - best.maxX) <= tolerance && Math.abs(bottomRight.y - best.maxY) <= tolerance
    && Math.abs(bottomLeft.x - best.minX) <= tolerance && Math.abs(bottomLeft.y - best.maxY) <= tolerance;

  if (axisAligned) {
    topLeft = { x: best.minX, y: best.minY };
    topRight = { x: best.maxX, y: best.minY };
    bottomRight = { x: best.maxX, y: best.maxY };
    bottomLeft = { x: best.minX, y: best.maxY };
  } else {
    const area = polygonArea([topLeft, topRight, bottomRight, bottomLeft]);
    const componentToPlaneRatio = best.count / Math.max(1, area);
    if (area < minimumOpeningPixels || componentToPlaneRatio < 0.8 || componentToPlaneRatio > 1.25) {
      openingError('contains an irregular transparent region whose print plane cannot be identified reliably.');
    }
  }

  return {
    bounds,
    corners: { topLeft, topRight, bottomRight, bottomLeft },
    mask,
    axisAligned,
  };
}

function invert3x3(matrix: number[]) {
  const [a, b, c, d, e, f, g, h, i] = matrix;
  const determinant = a * (e * i - f * h) - b * (d * i - f * g) + c * (d * h - e * g);
  if (Math.abs(determinant) < 1e-10) openingError('contains a transparent opening with an invalid print plane.');
  return [
    (e * i - f * h) / determinant,
    (c * h - b * i) / determinant,
    (b * f - c * e) / determinant,
    (f * g - d * i) / determinant,
    (a * i - c * g) / determinant,
    (c * d - a * f) / determinant,
    (d * h - e * g) / determinant,
    (b * g - a * h) / determinant,
    (a * e - b * d) / determinant,
  ];
}

function inversePrintPlane(corners: TemplateOpening['corners']) {
  const { topLeft: p0, topRight: p1, bottomRight: p2, bottomLeft: p3 } = corners;
  const dx1 = p1.x - p2.x;
  const dx2 = p3.x - p2.x;
  const dx3 = p0.x - p1.x + p2.x - p3.x;
  const dy1 = p1.y - p2.y;
  const dy2 = p3.y - p2.y;
  const dy3 = p0.y - p1.y + p2.y - p3.y;
  let projectiveX = 0;
  let projectiveY = 0;
  if (Math.abs(dx3) > 1e-10 || Math.abs(dy3) > 1e-10) {
    const denominator = dx1 * dy2 - dx2 * dy1;
    if (Math.abs(denominator) < 1e-10) openingError('contains a transparent opening with an invalid perspective.');
    projectiveX = (dx3 * dy2 - dx2 * dy3) / denominator;
    projectiveY = (dx1 * dy3 - dx3 * dy1) / denominator;
  }
  return invert3x3([
    p1.x - p0.x + projectiveX * p1.x,
    p3.x - p0.x + projectiveY * p3.x,
    p0.x,
    p1.y - p0.y + projectiveX * p1.y,
    p3.y - p0.y + projectiveY * p3.y,
    p0.y,
    projectiveX,
    projectiveY,
    1,
  ]);
}

function mapToPlane(inverse: number[], x: number, y: number) {
  const denominator = inverse[6] * x + inverse[7] * y + inverse[8];
  if (Math.abs(denominator) < 1e-10) return null;
  return {
    x: (inverse[0] * x + inverse[1] * y + inverse[2]) / denominator,
    y: (inverse[3] * x + inverse[4] * y + inverse[5]) / denominator,
  };
}

function samplePlane(plane: Buffer, width: number, height: number, x: number, y: number, output: Buffer, offset: number) {
  const clampedX = Math.max(0, Math.min(width - 1, x));
  const clampedY = Math.max(0, Math.min(height - 1, y));
  const left = Math.floor(clampedX);
  const top = Math.floor(clampedY);
  const right = Math.min(width - 1, left + 1);
  const bottom = Math.min(height - 1, top + 1);
  const xWeight = clampedX - left;
  const yWeight = clampedY - top;
  for (let channel = 0; channel < 4; channel += 1) {
    const topValue = plane[(top * width + left) * 4 + channel] * (1 - xWeight)
      + plane[(top * width + right) * 4 + channel] * xWeight;
    const bottomValue = plane[(bottom * width + left) * 4 + channel] * (1 - xWeight)
      + plane[(bottom * width + right) * 4 + channel] * xWeight;
    output[offset + channel] = Math.round(topValue * (1 - yWeight) + bottomValue * yWeight);
  }
}

async function createPrintPlane(
  artwork: Buffer,
  width: number,
  height: number,
  presentation: TemplateArtworkPresentation,
) {
  const borderSizePercent = presentation.borderSizePercent ?? 5;
  if (presentation.borderEnabled && (!Number.isFinite(borderSizePercent) || borderSizePercent < 2.5 || borderSizePercent > 10)) {
    throw new Error('The image-template border size must be between 2.5% and 10%.');
  }
  const requestedBorder = presentation.borderEnabled
    ? Math.max(1, Math.round(Math.min(width, height) * borderSizePercent / 100))
    : 0;
  const border = Math.min(requestedBorder, Math.floor((width - 1) / 2), Math.floor((height - 1) / 2));
  const artworkWidth = width - border * 2;
  const artworkHeight = height - border * 2;
  const resized = await sharp(artwork)
    .resize({
      width: artworkWidth,
      height: artworkHeight,
      fit: 'cover',
      position: 'centre',
      kernel: sharp.kernel.lanczos3,
      withoutEnlargement: false,
    })
    .ensureAlpha()
    .png()
    .toBuffer({ resolveWithObject: true });
  if (resized.info.width !== artworkWidth || resized.info.height !== artworkHeight) throw new Error('The attached image has invalid dimensions.');

  const plane = await sharp({ create: { width, height, channels: 4, background: '#ffffff' } })
    .composite([{ input: resized.data, left: border, top: border }])
    .ensureAlpha()
    .raw()
    .toBuffer();
  return plane;
}

export async function composeOurCategoryTemplate(
  template: Buffer,
  attachedImage: Buffer,
  configuredRegions: TemplateOpeningRegion[] | TemplateOpeningCorners,
  presentation: TemplateArtworkPresentation = {},
) {
  const regions = Array.isArray(configuredRegions)
    ? configuredRegions
    : [{ id: 'area-1', name: 'Area 1', corners: configuredRegions }];
  return composeOurCategoryTemplateWithArtworks(
    template,
    regions.map((region) => ({ region, artwork: attachedImage })),
    presentation,
  );
}

export async function composeOurCategoryTemplateWithArtworks(
  template: Buffer,
  regionArtworks: Array<{ region: TemplateOpeningRegion; artwork: Buffer }>,
  presentation: TemplateArtworkPresentation = {},
) {
  const decodedTemplate = await sharp(template, { failOn: 'error' })
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  const width = decodedTemplate.info.width;
  const height = decodedTemplate.info.height;
  if (!width || !height) openingError('has invalid dimensions.');

  const regions = validateTemplateOpeningRegions(
    regionArtworks.map(({ region }) => region),
    width,
    height,
  );
  const openingLayer = Buffer.alloc(width * height * 4);
  const templateOverlay = Buffer.from(decodedTemplate.data);

  for (const [regionIndex, region] of regions.entries()) {
    const artwork = await sharp(regionArtworks[regionIndex].artwork, { failOn: 'error' })
      .rotate()
      .ensureAlpha()
      .png()
      .toBuffer();
    const opening = configuredOpening(region.corners, width, height);
    const planeWidth = opening.axisAligned
      ? opening.bounds.width
      : Math.max(2, Math.round((distance(opening.corners.topLeft, opening.corners.topRight) + distance(opening.corners.bottomLeft, opening.corners.bottomRight)) / 2) + 1);
    const planeHeight = opening.axisAligned
      ? opening.bounds.height
      : Math.max(2, Math.round((distance(opening.corners.topLeft, opening.corners.bottomLeft) + distance(opening.corners.topRight, opening.corners.bottomRight)) / 2) + 1);
    const plane = await createPrintPlane(artwork, planeWidth, planeHeight, presentation);

    // Each saved polygon is cut out of the in-memory overlay. The S3 template
    // buffer itself is never changed.
    for (let position = 0; position < opening.mask.length; position += 1) {
      if (opening.mask[position]) templateOverlay[position * 4 + 3] = 0;
    }

    if (opening.axisAligned) {
      for (let y = opening.bounds.top; y < opening.bounds.top + opening.bounds.height; y += 1) {
        for (let x = opening.bounds.left; x < opening.bounds.left + opening.bounds.width; x += 1) {
          const canvasPosition = y * width + x;
          if (!opening.mask[canvasPosition]) continue;
          const sourcePosition = ((y - opening.bounds.top) * planeWidth + (x - opening.bounds.left)) * 4;
          plane.copy(openingLayer, canvasPosition * 4, sourcePosition, sourcePosition + 4);
        }
      }
    } else {
      const inverse = inversePrintPlane(opening.corners);
      for (let y = opening.bounds.top; y < opening.bounds.top + opening.bounds.height; y += 1) {
        for (let x = opening.bounds.left; x < opening.bounds.left + opening.bounds.width; x += 1) {
          const canvasPosition = y * width + x;
          if (!opening.mask[canvasPosition]) continue;
          const mapped = mapToPlane(inverse, x, y);
          if (!mapped || mapped.x < -0.02 || mapped.x > 1.02 || mapped.y < -0.02 || mapped.y > 1.02) {
            openingLayer.fill(255, canvasPosition * 4, canvasPosition * 4 + 4);
            continue;
          }
          samplePlane(
            plane,
            planeWidth,
            planeHeight,
            mapped.x * (planeWidth - 1),
            mapped.y * (planeHeight - 1),
            openingLayer,
            canvasPosition * 4,
          );
        }
      }
    }
  }

  return sharp({ create: { width, height, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } } })
    .composite([
      { input: openingLayer, raw: { width, height, channels: 4 } },
      { input: templateOverlay, raw: { width, height, channels: 4 } },
    ])
    .png()
    .toBuffer();
}
