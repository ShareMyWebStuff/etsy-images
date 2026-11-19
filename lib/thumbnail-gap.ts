import sharp from 'sharp';

export type ThumbnailArtworkBounds = { left: number; top: number; width: number; height: number };
export type ThumbnailGapAnalysis = {
  eligible: boolean;
  reason: string | null;
  width: number;
  height: number;
  bounds: ThumbnailArtworkBounds | null;
  hasTransparentBackground: boolean;
  hasVisibleArtwork: boolean;
};

function alphaAt(pixels: Buffer, pixelOffset: number, sampleBytes: 1 | 2) {
  return sampleBytes === 1 ? pixels[pixelOffset + 3] : pixels.readUInt16LE(pixelOffset + 6);
}

function rawInput(pixels: Buffer, sampleBytes: 1 | 2) {
  return sampleBytes === 1 ? pixels : new Uint16Array(pixels.buffer, pixels.byteOffset, pixels.length / 2);
}

function analysePixels(pixels: Buffer, width: number, height: number, sampleBytes: 1 | 2): ThumbnailGapAnalysis {
  let left = width;
  let top = height;
  let right = -1;
  let bottom = -1;
  let hasTransparentBackground = false;
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const alpha = alphaAt(pixels, (y * width + x) * 4 * sampleBytes, sampleBytes);
      if (alpha === 0) { hasTransparentBackground = true; continue; }
      left = Math.min(left, x);
      top = Math.min(top, y);
      right = Math.max(right, x);
      bottom = Math.max(bottom, y);
    }
  }
  const hasVisibleArtwork = right >= left && bottom >= top;
  return {
    eligible: hasVisibleArtwork && hasTransparentBackground,
    reason: !hasVisibleArtwork ? 'This thumbnail has no visible artwork.'
      : !hasTransparentBackground ? 'This thumbnail has no fully transparent background.' : null,
    width, height,
    bounds: hasVisibleArtwork ? { left, top, width: right - left + 1, height: bottom - top + 1 } : null,
    hasTransparentBackground,
    hasVisibleArtwork,
  };
}

async function decodeThumbnail(buffer: Buffer) {
  try {
    if (!Buffer.isBuffer(buffer) || buffer.length === 0) throw new Error('Missing image data.');
    const source = sharp(buffer, { failOn: 'error' });
    const metadata = await source.metadata();
    const sampleBytes = metadata.depth === 'ushort' ? 2 : 1;
    const { data, info } = await source.toColourspace(sampleBytes === 2 ? 'rgb16' : 'srgb').ensureAlpha()
      .raw({ depth: sampleBytes === 2 ? 'ushort' : 'uchar' }).toBuffer({ resolveWithObject: true });
    if (info.channels !== 4 || info.width < 1 || info.height < 1) throw new Error('Unsupported image data.');
    return { pixels: data, width: info.width, height: info.height, sampleBytes: sampleBytes as 1 | 2 };
  } catch (error) {
    throw new Error('The thumbnail image could not be read. Upload a valid image and try again.', { cause: error });
  }
}

export async function analyseThumbnailGap(buffer: Buffer): Promise<ThumbnailGapAnalysis> {
  const { pixels, width, height, sampleBytes } = await decodeThumbnail(buffer);
  return analysePixels(pixels, width, height, sampleBytes);
}

function cropPixels(pixels: Buffer, canvasWidth: number, bounds: ThumbnailArtworkBounds, sampleBytes: 1 | 2) {
  const bytesPerPixel = 4 * sampleBytes;
  const cropped = Buffer.alloc(bounds.width * bounds.height * bytesPerPixel);
  for (let y = 0; y < bounds.height; y += 1) {
    const start = ((bounds.top + y) * canvasWidth + bounds.left) * bytesPerPixel;
    pixels.copy(cropped, y * bounds.width * bytesPerPixel, start, start + bounds.width * bytesPerPixel);
  }
  return cropped;
}

/** Preserve visible support that interpolation can otherwise round from alpha 1 to alpha 0. */
function preserveFaintArtwork(source: Buffer, width: number, height: number, resized: Buffer, targetWidth: number, targetHeight: number, sampleBytes: 1 | 2) {
  const bytesPerPixel = 4 * sampleBytes;
  for (let y = 0; y < height; y += 1) {
    const top = Math.floor(y * targetHeight / height);
    const bottom = Math.min(targetHeight, Math.ceil((y + 1) * targetHeight / height));
    for (let x = 0; x < width; x += 1) {
      const sourceIndex = (y * width + x) * bytesPerPixel;
      if (alphaAt(source, sourceIndex, sampleBytes) === 0) continue;
      const left = Math.floor(x * targetWidth / width);
      const right = Math.min(targetWidth, Math.ceil((x + 1) * targetWidth / width));
      for (let targetY = top; targetY < bottom; targetY += 1) {
        for (let targetX = left; targetX < right; targetX += 1) {
          const targetIndex = (targetY * targetWidth + targetX) * bytesPerPixel;
          if (alphaAt(resized, targetIndex, sampleBytes) !== 0) continue;
          source.copy(resized, targetIndex, sourceIndex, sourceIndex + 3 * sampleBytes);
          if (sampleBytes === 1) resized[targetIndex + 3] = 1;
          else resized.writeUInt16LE(1, targetIndex + 6);
        }
      }
    }
  }
}

export async function adjustThumbnailGap(buffer: Buffer, percent: number): Promise<{ changed: boolean; buffer: Buffer; analysis: ThumbnailGapAnalysis }> {
  if (typeof percent !== 'number' || !Number.isFinite(percent) || percent < 0 || percent > 20) {
    throw new Error('Gap must be a number between 0 and 20 percent.');
  }
  const { pixels, width, height, sampleBytes } = await decodeThumbnail(buffer);
  const analysis = analysePixels(pixels, width, height, sampleBytes);
  if (!analysis.eligible || !analysis.bounds) return { changed: false, buffer, analysis };
  const bounds = analysis.bounds;
  const availableWidth = width - 2 * Math.ceil(width * percent / 100);
  const availableHeight = height - 2 * Math.ceil(height * percent / 100);
  if (availableWidth < 1 || availableHeight < 1) throw new Error('This gap is too large for the thumbnail dimensions.');
  const widthLimited = availableWidth * bounds.height <= availableHeight * bounds.width;
  const targetWidth = widthLimited ? availableWidth : Math.max(1, Math.floor(bounds.width * availableHeight / bounds.height));
  const targetHeight = widthLimited ? Math.max(1, Math.floor(bounds.height * availableWidth / bounds.width)) : availableHeight;
  const left = Math.floor((width - targetWidth) / 2);
  const top = Math.floor((height - targetHeight) / 2);
  if (bounds.width === targetWidth && bounds.height === targetHeight && bounds.left === left && bounds.top === top) {
    return { changed: false, buffer, analysis };
  }
  const cropped = cropPixels(pixels, width, bounds, sampleBytes);
  let artwork = cropped;
  if (bounds.width !== targetWidth || bounds.height !== targetHeight) {
    artwork = await sharp(rawInput(cropped, sampleBytes), { raw: { width: bounds.width, height: bounds.height, channels: 4 } })
      .toColourspace(sampleBytes === 2 ? 'rgb16' : 'srgb')
      .resize(targetWidth, targetHeight, { fit: 'fill', kernel: sharp.kernel.lanczos3 })
      .raw({ depth: sampleBytes === 2 ? 'ushort' : 'uchar' }).toBuffer();
    preserveFaintArtwork(cropped, bounds.width, bounds.height, artwork, targetWidth, targetHeight, sampleBytes);
  }
  const bytesPerPixel = 4 * sampleBytes;
  const canvas = Buffer.alloc(width * height * bytesPerPixel);
  for (let y = 0; y < targetHeight; y += 1) {
    artwork.copy(canvas, ((top + y) * width + left) * bytesPerPixel, y * targetWidth * bytesPerPixel, (y + 1) * targetWidth * bytesPerPixel);
  }
  const changedBuffer = await sharp(rawInput(canvas, sampleBytes), { raw: { width, height, channels: 4 } })
    .toColourspace(sampleBytes === 2 ? 'rgb16' : 'srgb').png().toBuffer();
  return { changed: true, buffer: changedBuffer, analysis: analysePixels(canvas, width, height, sampleBytes) };
}
