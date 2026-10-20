import type { ListingArtworkOrientation } from '@/lib/listing-print-crops';

export type ListingThumbnailRatio = '2x3' | '4x5';

export type ListingThumbnailDimensions = {
  ratio: ListingThumbnailRatio;
  orientation: ListingArtworkOrientation;
  width: number;
  height: number;
  targetWidth: number;
  targetHeight: number;
  resized: boolean;
};

const MAX_ROUNDING_DIFFERENCE_PIXELS = 6;

export function analyseListingThumbnailDimensions(
  width: number,
  height: number,
): ListingThumbnailDimensions {
  if (!Number.isInteger(width) || !Number.isInteger(height) || width < 2 || height < 2) {
    throw new Error('The thumbnail dimensions are invalid.');
  }
  const orientation: ListingArtworkOrientation = width > height ? 'landscape' : 'portrait';
  const candidates = ([
    { ratio: '2x3' as const, portraitWidth: 2, portraitHeight: 3 },
    { ratio: '4x5' as const, portraitWidth: 4, portraitHeight: 5 },
  ]).map((candidate) => {
    const baseWidth = orientation === 'portrait' ? candidate.portraitWidth : candidate.portraitHeight;
    const baseHeight = orientation === 'portrait' ? candidate.portraitHeight : candidate.portraitWidth;
    const scale = Math.max(1, Math.round(
      ((width * baseWidth) + (height * baseHeight)) / ((baseWidth ** 2) + (baseHeight ** 2)),
    ));
    const targetWidth = baseWidth * scale;
    const targetHeight = baseHeight * scale;
    return {
      ratio: candidate.ratio,
      targetWidth,
      targetHeight,
      difference: Math.max(Math.abs(width - targetWidth), Math.abs(height - targetHeight)),
    };
  }).sort((left, right) => left.difference - right.difference);

  const nearest = candidates[0];
  if (!nearest || nearest.difference > MAX_ROUNDING_DIFFERENCE_PIXELS) {
    throw new Error('Choose an image with a 2:3 or 4:5 aspect ratio. A difference of up to 6 pixels is allowed for rounding.');
  }
  return {
    ratio: nearest.ratio,
    orientation,
    width,
    height,
    targetWidth: nearest.targetWidth,
    targetHeight: nearest.targetHeight,
    resized: width !== nearest.targetWidth || height !== nearest.targetHeight,
  };
}

