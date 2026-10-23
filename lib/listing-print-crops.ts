import type { PrintableDownloadRatio } from '@/lib/printable-download-specs';
import { analyseListingThumbnailDimensions, type ListingThumbnailRatio } from '@/lib/listing-thumbnail-ratio';

export type ListingArtworkOrientation = 'portrait' | 'landscape';

export function normalizeListingArtworkOrientation(value: unknown): ListingArtworkOrientation {
  return value === 'landscape' ? 'landscape' : 'portrait';
}
export type PrintCropRegion = { x: number; y: number; width: number; height: number };
export type PrintCropRegions = Record<PrintableDownloadRatio, PrintCropRegion>;
export type PrintArtworkPlacement = { x: number; y: number; width: number; height: number };
export type PrintArtworkPlacements = Record<PrintableDownloadRatio, PrintArtworkPlacement>;
export type ListingPrintCropDraft = {
  regions: PrintCropRegions;
  placements?: PrintArtworkPlacements;
};
export type ListingPrintCropSettings = ListingPrintCropDraft & {
  version: 1 | 2 | 3;
  placements: PrintArtworkPlacements;
  orientation: ListingArtworkOrientation;
  sourceRatio?: ListingThumbnailRatio;
  source: {
    fileName: string;
    updatedAt: string;
    width: number;
    height: number;
  };
};

export function listingPrintCropDraftForSave(value: ListingPrintCropDraft): ListingPrintCropDraft {
  return {
    regions: value.regions,
    placements: value.placements,
  };
}

export const PRINT_CROP_RATIOS: ReadonlyArray<{
  key: PrintableDownloadRatio;
  label: string;
  width: number;
  height: number;
  main: boolean;
}> = [
  { key: '2x3', label: '2:3', width: 2, height: 3, main: true },
  { key: 'iso-a1', label: 'A (1:√2)', width: 1, height: Math.SQRT2, main: false },
  { key: '5x7', label: '5:7', width: 5, height: 7, main: false },
  { key: '3x4', label: '3:4', width: 3, height: 4, main: false },
  { key: '4x5', label: '4:5', width: 4, height: 5, main: false },
  { key: '11x14', label: '11:14', width: 11, height: 14, main: false },
];

export const DERIVED_PRINT_CROP_RATIOS = PRINT_CROP_RATIOS.filter((ratio) => !ratio.main);

function ratioSpec(key: PrintableDownloadRatio) {
  const ratio = PRINT_CROP_RATIOS.find((candidate) => candidate.key === key);
  if (!ratio) throw new Error('Choose a supported print crop ratio.');
  return ratio;
}

function orientedRatio(key: PrintableDownloadRatio, orientation: ListingArtworkOrientation) {
  const ratio = ratioSpec(key);
  return orientation === 'landscape'
    ? { width: ratio.height, height: ratio.width }
    : { width: ratio.width, height: ratio.height };
}

function clamp(value: number, minimum: number, maximum: number) {
  return Math.max(minimum, Math.min(maximum, value));
}

function validImageDimensions(width: number, height: number) {
  if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) {
    throw new Error('The source artwork dimensions are invalid.');
  }
}

export function printCropHeightForWidth(
  normalizedWidth: number,
  imageWidth: number,
  imageHeight: number,
  ratio: PrintableDownloadRatio,
  orientation: ListingArtworkOrientation = 'portrait',
) {
  validImageDimensions(imageWidth, imageHeight);
  const spec = orientedRatio(ratio, orientation);
  return normalizedWidth * imageWidth * spec.height / spec.width / imageHeight;
}

export function largestCenteredTwoByThreeCrop(
  imageWidth: number,
  imageHeight: number,
  orientation: ListingArtworkOrientation = 'portrait',
): PrintCropRegion {
  validImageDimensions(imageWidth, imageHeight);
  const ratio = orientedRatio('2x3', orientation);
  const fullWidthHeight = imageWidth * ratio.height / ratio.width;
  if (fullWidthHeight <= imageHeight) {
    const height = fullWidthHeight / imageHeight;
    return { x: 0, y: (1 - height) / 2, width: 1, height };
  }
  const width = (imageHeight * ratio.width / ratio.height) / imageWidth;
  return { x: (1 - width) / 2, y: 0, width, height: 1 };
}

export function centredDerivedCrop(
  main: PrintCropRegion,
  ratio: Exclude<PrintableDownloadRatio, '2x3'>,
  imageWidth: number,
  imageHeight: number,
  orientation: ListingArtworkOrientation = 'portrait',
): PrintCropRegion {
  if (orientation === 'landscape') {
    const spec = orientedRatio(ratio, orientation);
    const width = main.height * imageHeight * spec.width / spec.height / imageWidth;
    if (width > main.width + 0.000001) throw new Error('The derived print crop cannot fit inside the 3:2 crop.');
    return { x: main.x + ((main.width - width) / 2), y: main.y, width, height: main.height };
  }
  const height = printCropHeightForWidth(main.width, imageWidth, imageHeight, ratio, orientation);
  if (height > main.height + 0.000001) throw new Error('The derived print crop cannot fit inside the 2:3 crop.');
  return { x: main.x, y: main.y + ((main.height - height) / 2), width: main.width, height };
}

export function cropDraftForMain(
  main: PrintCropRegion,
  imageWidth: number,
  imageHeight: number,
  orientation: ListingArtworkOrientation = 'portrait',
): ListingPrintCropDraft {
  return {
    regions: Object.fromEntries(PRINT_CROP_RATIOS.map((ratio) => [
      ratio.key,
      ratio.main
        ? main
        : centredDerivedCrop(main, ratio.key as Exclude<PrintableDownloadRatio, '2x3'>, imageWidth, imageHeight, orientation),
    ])) as unknown as PrintCropRegions,
  };
}

export function defaultListingPrintCropDraft(
  imageWidth: number,
  imageHeight: number,
  orientation: ListingArtworkOrientation = 'portrait',
) {
  return cropDraftForMain(largestCenteredTwoByThreeCrop(imageWidth, imageHeight, orientation), imageWidth, imageHeight, orientation);
}

function largestCenteredCropForRatio(
  imageWidth: number,
  imageHeight: number,
  ratio: PrintableDownloadRatio,
  orientation: ListingArtworkOrientation,
): PrintCropRegion {
  const spec = orientedRatio(ratio, orientation);
  const targetAspect = spec.width / spec.height;
  const sourceAspect = imageWidth / imageHeight;
  if (targetAspect > sourceAspect) {
    const height = sourceAspect / targetAspect;
    return { x: 0, y: (1 - height) / 2, width: 1, height };
  }
  const width = targetAspect / sourceAspect;
  return { x: (1 - width) / 2, y: 0, width, height: 1 };
}

/**
 * Positions the complete thumbnail on the selected paper. Portrait artwork
 * always uses the complete paper width; landscape artwork always uses its
 * complete height. A placement larger than the paper is clipped by the paper,
 * while a smaller placement leaves visible paper around the artwork.
 */
export function centredArtworkPlacementForRatio(
  imageWidth: number,
  imageHeight: number,
  ratio: PrintableDownloadRatio,
  orientation: ListingArtworkOrientation = 'portrait',
): PrintArtworkPlacement {
  validImageDimensions(imageWidth, imageHeight);
  const paper = orientedRatio(ratio, orientation);
  if (orientation === 'landscape') {
    const width = (imageWidth / imageHeight) / (paper.width / paper.height);
    return { x: (1 - width) / 2, y: 0, width, height: 1 };
  }
  const height = (imageHeight / imageWidth) / (paper.height / paper.width);
  return { x: 0, y: (1 - height) / 2, width: 1, height };
}

export function cropRegionToArtworkPlacement(crop: PrintCropRegion): PrintArtworkPlacement {
  return {
    x: -crop.x / crop.width,
    y: -crop.y / crop.height,
    width: 1 / crop.width,
    height: 1 / crop.height,
  };
}

export function movePrintArtworkPlacement(
  placement: PrintArtworkPlacement,
  deltaX: number,
  deltaY: number,
  orientation: ListingArtworkOrientation,
  freely = false,
): PrintArtworkPlacement {
  if (freely) {
    return {
      ...placement,
      x: clamp(placement.x + deltaX, 0, 1 - placement.width),
      y: clamp(placement.y + deltaY, 0, 1 - placement.height),
    };
  }
  if (orientation === 'landscape') {
    const minimum = Math.min(0, 1 - placement.width);
    const maximum = Math.max(0, 1 - placement.width);
    return { ...placement, x: clamp(placement.x + deltaX, minimum, maximum), y: 0, height: 1 };
  }
  const minimum = Math.min(0, 1 - placement.height);
  const maximum = Math.max(0, 1 - placement.height);
  return { ...placement, x: 0, width: 1, y: clamp(placement.y + deltaY, minimum, maximum) };
}

export function scalePrintArtworkPlacement(
  placement: PrintArtworkPlacement,
  fullSizePlacement: PrintArtworkPlacement,
  scale: number,
): PrintArtworkPlacement {
  const resolvedScale = clamp(scale, 0.1, 1);
  const width = fullSizePlacement.width * resolvedScale;
  const height = fullSizePlacement.height * resolvedScale;
  const centreX = placement.x + (placement.width / 2);
  const centreY = placement.y + (placement.height / 2);
  return {
    x: clamp(centreX - (width / 2), 0, 1 - width),
    y: clamp(centreY - (height / 2), 0, 1 - height),
    width,
    height,
  };
}

export function printArtworkPlacementScale(
  placement: PrintArtworkPlacement,
  fullSizePlacement: PrintArtworkPlacement,
) {
  return placement.width / fullSizePlacement.width;
}

export const DEFAULT_FOUR_BY_FIVE_ARTWORK_SCALE_BY_RATIO: Readonly<Record<PrintableDownloadRatio, number>> = {
  '11x14': 0.82,
  '4x5': 0.80,
  '3x4': 0.86,
  '5x7': 0.92,
  'iso-a1': 0.93,
  '2x3': 0.98,
};

/** Crops every paper ratio directly from the complete 2:3 or 4:5 thumbnail. */
export function defaultNativeListingPrintCropDraft(
  imageWidth: number,
  imageHeight: number,
  orientation: ListingArtworkOrientation = 'portrait',
) {
  const sourceRatio = analyseListingThumbnailDimensions(imageWidth, imageHeight).ratio;
  return {
    sourceRatio,
    regions: Object.fromEntries(PRINT_CROP_RATIOS.map((ratio) => [
      ratio.key,
      ratio.key === sourceRatio
        ? { x: 0, y: 0, width: 1, height: 1 }
        : largestCenteredCropForRatio(imageWidth, imageHeight, ratio.key, orientation),
    ])) as unknown as PrintCropRegions,
    placements: Object.fromEntries(PRINT_CROP_RATIOS.map((ratio) => {
      const fullSizePlacement = centredArtworkPlacementForRatio(imageWidth, imageHeight, ratio.key, orientation);
      return [
        ratio.key,
        sourceRatio === '4x5'
          ? scalePrintArtworkPlacement(
              fullSizePlacement,
              fullSizePlacement,
              DEFAULT_FOUR_BY_FIVE_ARTWORK_SCALE_BY_RATIO[ratio.key],
            )
          : fullSizePlacement,
      ];
    })) as unknown as PrintArtworkPlacements,
  };
}

export function moveNativePrintCrop(crop: PrintCropRegion, deltaX: number, deltaY: number): PrintCropRegion {
  if (crop.width < 1 - 0.000001) {
    return { ...crop, x: clamp(crop.x + deltaX, 0, 1 - crop.width), y: 0, height: 1 };
  }
  if (crop.height < 1 - 0.000001) {
    return { ...crop, x: 0, width: 1, y: clamp(crop.y + deltaY, 0, 1 - crop.height) };
  }
  return crop;
}

export function moveMainPrintCrop(crop: PrintCropRegion, deltaX: number, deltaY: number): PrintCropRegion {
  return {
    ...crop,
    x: clamp(crop.x + deltaX, 0, 1 - crop.width),
    y: clamp(crop.y + deltaY, 0, 1 - crop.height),
  };
}

export function moveDerivedPrintCrop(
  main: PrintCropRegion,
  crop: PrintCropRegion,
  delta: number,
  orientation: ListingArtworkOrientation = 'portrait',
): PrintCropRegion {
  if (orientation === 'landscape') {
    return {
      ...crop,
      x: clamp(crop.x + delta, main.x, main.x + main.width - crop.width),
      y: main.y,
      height: main.height,
    };
  }
  return {
    ...crop,
    x: main.x,
    width: main.width,
    y: clamp(crop.y + delta, main.y, main.y + main.height - crop.height),
  };
}

export type PrintCropResizeHandle = 'n' | 's' | 'e' | 'w' | 'ne' | 'nw' | 'se' | 'sw';

export function resizeMainPrintCrop(
  crop: PrintCropRegion,
  handle: PrintCropResizeHandle,
  deltaX: number,
  deltaY: number,
  imageWidth: number,
  imageHeight: number,
  orientation: ListingArtworkOrientation = 'portrait',
): PrintCropRegion {
  validImageDimensions(imageWidth, imageHeight);
  const left = crop.x * imageWidth;
  const top = crop.y * imageHeight;
  const right = (crop.x + crop.width) * imageWidth;
  const bottom = (crop.y + crop.height) * imageHeight;
  const startWidth = right - left;
  const startHeight = bottom - top;
  const mainRatio = orientedRatio('2x3', orientation);
  const heightPerWidth = mainRatio.height / mainRatio.width;
  const minimumWidth = Math.min(startWidth, Math.max(1, Math.min(imageWidth, imageHeight) * 0.03));
  const dx = deltaX * imageWidth;
  const dy = deltaY * imageHeight;
  let nextLeft = left;
  let nextTop = top;
  let nextWidth = startWidth;

  if (handle.length === 2) {
    const west = handle.includes('w');
    const north = handle.includes('n');
    const anchorX = west ? right : left;
    const anchorY = north ? bottom : top;
    const desiredWidth = Math.max(1, west ? anchorX - (left + dx) : (right + dx) - anchorX);
    const desiredHeight = Math.max(1, north ? anchorY - (top + dy) : (bottom + dy) - anchorY);
    const projectedWidth = (desiredWidth + (heightPerWidth * desiredHeight)) / (1 + (heightPerWidth * heightPerWidth));
    const maximumWidth = Math.min(
      west ? anchorX : imageWidth - anchorX,
      (north ? anchorY : imageHeight - anchorY) / heightPerWidth,
    );
    nextWidth = clamp(projectedWidth, Math.min(minimumWidth, maximumWidth), maximumWidth);
    nextLeft = west ? anchorX - nextWidth : anchorX;
    nextTop = north ? anchorY - (nextWidth * heightPerWidth) : anchorY;
  } else if (handle === 'e' || handle === 'w') {
    const west = handle === 'w';
    const anchorX = west ? right : left;
    const centreY = (top + bottom) / 2;
    const desiredWidth = west ? startWidth - dx : startWidth + dx;
    const maximumWidth = Math.min(
      west ? anchorX : imageWidth - anchorX,
      (2 * Math.min(centreY, imageHeight - centreY)) / heightPerWidth,
    );
    nextWidth = clamp(desiredWidth, Math.min(minimumWidth, maximumWidth), maximumWidth);
    nextLeft = west ? anchorX - nextWidth : anchorX;
    nextTop = centreY - ((nextWidth * heightPerWidth) / 2);
  } else {
    const north = handle === 'n';
    const anchorY = north ? bottom : top;
    const centreX = (left + right) / 2;
    const desiredHeight = north ? startHeight - dy : startHeight + dy;
    const maximumWidth = Math.min(
      (north ? anchorY : imageHeight - anchorY) / heightPerWidth,
      2 * Math.min(centreX, imageWidth - centreX),
    );
    nextWidth = clamp(desiredHeight / heightPerWidth, Math.min(minimumWidth, maximumWidth), maximumWidth);
    nextLeft = centreX - (nextWidth / 2);
    nextTop = north ? anchorY - (nextWidth * heightPerWidth) : anchorY;
  }

  return {
    x: clamp(nextLeft / imageWidth, 0, 1),
    y: clamp(nextTop / imageHeight, 0, 1),
    width: nextWidth / imageWidth,
    height: (nextWidth * heightPerWidth) / imageHeight,
  };
}

function numericRegion(value: unknown, label: string): PrintCropRegion {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error(`${label} is invalid.`);
  const record = value as Record<string, unknown>;
  for (const key of ['x', 'y', 'width', 'height'] as const) {
    if (typeof record[key] !== 'number' || !Number.isFinite(record[key])) throw new Error(`${label} is invalid.`);
  }
  return { x: record.x as number, y: record.y as number, width: record.width as number, height: record.height as number };
}

export function validatePrintArtworkPlacements(
  value: unknown,
  imageWidth: number,
  imageHeight: number,
  orientation: ListingArtworkOrientation = 'portrait',
): PrintArtworkPlacements {
  validImageDimensions(imageWidth, imageHeight);
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('The artwork paper placements are invalid.');
  }
  const input = value as Record<string, unknown>;
  const placements = Object.fromEntries(PRINT_CROP_RATIOS.map((ratio) => [
    ratio.key,
    numericRegion(input[ratio.key], `${ratio.label} artwork placement`),
  ])) as unknown as PrintArtworkPlacements;
  const tolerance = 0.00001;
  const sourceRatio = analyseListingThumbnailDimensions(imageWidth, imageHeight).ratio;
  for (const ratio of PRINT_CROP_RATIOS) {
    const placement = placements[ratio.key];
    const expected = centredArtworkPlacementForRatio(imageWidth, imageHeight, ratio.key, orientation);
    const scaleX = placement.width / expected.width;
    const scaleY = placement.height / expected.height;
    if (Math.abs(scaleX - scaleY) > tolerance || scaleX < 0.1 - tolerance || scaleX > 1 + tolerance) {
      throw new Error(`${ratio.label} artwork must retain its aspect ratio and paper-relative size.`);
    }
    if (sourceRatio === '4x5') {
      if (placement.x < -tolerance || placement.y < -tolerance
        || placement.x + placement.width > 1 + tolerance
        || placement.y + placement.height > 1 + tolerance) {
        throw new Error(`${ratio.label} artwork must remain inside the paper.`);
      }
      continue;
    }
    if (Math.abs(scaleX - 1) > tolerance) {
      throw new Error(`${ratio.label} artwork scale cannot be changed for a 2:3 thumbnail.`);
    }
    if (orientation === 'landscape') {
      const minimum = Math.min(0, 1 - placement.width);
      const maximum = Math.max(0, 1 - placement.width);
      if (Math.abs(placement.y) > tolerance || Math.abs(placement.height - 1) > tolerance
        || placement.x < minimum - tolerance || placement.x > maximum + tolerance) {
        throw new Error(`${ratio.label} artwork must use the paper height and remain horizontally within the paper.`);
      }
    } else {
      const minimum = Math.min(0, 1 - placement.height);
      const maximum = Math.max(0, 1 - placement.height);
      if (Math.abs(placement.x) > tolerance || Math.abs(placement.width - 1) > tolerance
        || placement.y < minimum - tolerance || placement.y > maximum + tolerance) {
        throw new Error(`${ratio.label} artwork must use the paper width and remain vertically within the paper.`);
      }
    }
  }
  return placements;
}

export function validateListingPrintCropDraft(
  value: unknown,
  imageWidth: number,
  imageHeight: number,
  orientation: ListingArtworkOrientation = 'portrait',
): ListingPrintCropDraft {
  validImageDimensions(imageWidth, imageHeight);
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('The print crop settings are invalid.');
  const regionsValue = (value as Record<string, unknown>).regions;
  if (!regionsValue || typeof regionsValue !== 'object' || Array.isArray(regionsValue)) throw new Error('The print crop regions are invalid.');
  const input = regionsValue as Record<string, unknown>;
  const regions = Object.fromEntries(PRINT_CROP_RATIOS.map((ratio) => [ratio.key, numericRegion(input[ratio.key], `${ratio.label} crop`)])) as unknown as PrintCropRegions;
  const tolerance = 0.00001;
  for (const ratio of PRINT_CROP_RATIOS) {
    const crop = regions[ratio.key];
    if (crop.x < -tolerance || crop.y < -tolerance || crop.width <= 0 || crop.height <= 0
      || crop.x + crop.width > 1 + tolerance || crop.y + crop.height > 1 + tolerance) {
      throw new Error(`${ratio.label} crop must remain inside the source artwork.`);
    }
    const expectedHeight = printCropHeightForWidth(crop.width, imageWidth, imageHeight, ratio.key, orientation);
    if (Math.abs(crop.height - expectedHeight) > tolerance) throw new Error(`${ratio.label} crop does not have the required aspect ratio.`);
  }
  const main = regions['2x3'];
  for (const ratio of DERIVED_PRINT_CROP_RATIOS) {
    const crop = regions[ratio.key];
    if (orientation === 'landscape') {
      if (Math.abs(crop.y - main.y) > tolerance || Math.abs(crop.height - main.height) > tolerance) {
        throw new Error(`${ratio.label} crop must use the same top, bottom and height as the 3:2 crop.`);
      }
      if (crop.x < main.x - tolerance || crop.x + crop.width > main.x + main.width + tolerance) {
        throw new Error(`${ratio.label} crop must remain inside the 3:2 crop.`);
      }
    } else {
      if (Math.abs(crop.x - main.x) > tolerance || Math.abs(crop.width - main.width) > tolerance) {
        throw new Error(`${ratio.label} crop must use the same left, right and width as the 2:3 crop.`);
      }
      if (crop.y < main.y - tolerance || crop.y + crop.height > main.y + main.height + tolerance) {
        throw new Error(`${ratio.label} crop must remain inside the 2:3 crop.`);
      }
    }
  }
  return { regions };
}

export function validateNativeListingPrintCropDraft(
  value: unknown,
  imageWidth: number,
  imageHeight: number,
  orientation: ListingArtworkOrientation = 'portrait',
): ListingPrintCropDraft {
  validImageDimensions(imageWidth, imageHeight);
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('The print crop settings are invalid.');
  const regionsValue = (value as Record<string, unknown>).regions;
  if (!regionsValue || typeof regionsValue !== 'object' || Array.isArray(regionsValue)) throw new Error('The print crop regions are invalid.');
  const input = regionsValue as Record<string, unknown>;
  const regions = Object.fromEntries(PRINT_CROP_RATIOS.map((ratio) => [
    ratio.key,
    numericRegion(input[ratio.key], `${ratio.label} crop`),
  ])) as unknown as PrintCropRegions;
  const tolerance = 0.00001;
  for (const ratio of PRINT_CROP_RATIOS) {
    const crop = regions[ratio.key];
    if (crop.x < -tolerance || crop.y < -tolerance || crop.width <= 0 || crop.height <= 0
      || crop.x + crop.width > 1 + tolerance || crop.y + crop.height > 1 + tolerance) {
      throw new Error(`${ratio.label} crop must remain inside the source artwork.`);
    }
    const expectedHeight = printCropHeightForWidth(crop.width, imageWidth, imageHeight, ratio.key, orientation);
    if (Math.abs(crop.height - expectedHeight) > tolerance) throw new Error(`${ratio.label} crop does not have the required aspect ratio.`);
    const usesFullWidth = Math.abs(crop.x) <= tolerance && Math.abs(crop.width - 1) <= tolerance;
    const usesFullHeight = Math.abs(crop.y) <= tolerance && Math.abs(crop.height - 1) <= tolerance;
    if (!usesFullWidth && !usesFullHeight) throw new Error(`${ratio.label} must crop on one axis only.`);
  }
  return { regions };
}

export function createListingPrintCropSettings(
  draft: unknown,
  source: ListingPrintCropSettings['source'],
  orientation: ListingArtworkOrientation = 'portrait',
): ListingPrintCropSettings {
  const native = defaultNativeListingPrintCropDraft(source.width, source.height, orientation);
  const validated = validateNativeListingPrintCropDraft(draft, source.width, source.height, orientation);
  const tolerance = 0.00001;
  const nativeCrop = validated.regions[native.sourceRatio];
  if (Math.abs(nativeCrop.x) > tolerance || Math.abs(nativeCrop.y) > tolerance
    || Math.abs(nativeCrop.width - 1) > tolerance || Math.abs(nativeCrop.height - 1) > tolerance) {
    throw new Error(`The native ${native.sourceRatio === '2x3' ? '2:3' : '4:5'} crop must use the complete thumbnail.`);
  }
  const draftRecord = draft && typeof draft === 'object' && !Array.isArray(draft)
    ? draft as Record<string, unknown>
    : null;
  const placements = draftRecord?.placements
    ? validatePrintArtworkPlacements(draftRecord.placements, source.width, source.height, orientation)
    : native.sourceRatio === '4x5'
      ? native.placements!
      : Object.fromEntries(PRINT_CROP_RATIOS.map(({ key }) => [
          key,
          cropRegionToArtworkPlacement(validated.regions[key]),
        ])) as PrintArtworkPlacements;
  return {
    version: 3,
    orientation,
    sourceRatio: native.sourceRatio,
    source,
    regions: validated.regions,
    placements,
  };
}

export function parseCurrentListingPrintCropSettings(
  value: unknown,
  source: { fileName: string | null; updatedAt: string | null; orientation?: ListingArtworkOrientation },
) {
  try {
    const parsed = typeof value === 'string' ? JSON.parse(value) as unknown : value;
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return null;
    const settings = parsed as Partial<ListingPrintCropSettings>;
    const savedOrientation = settings.orientation ?? 'portrait';
    const currentOrientation = source.orientation;
    if ((settings.version !== 1 && settings.version !== 2 && settings.version !== 3) || !settings.source || !settings.regions
      || !source.fileName || !source.updatedAt
      || (currentOrientation !== undefined && savedOrientation !== currentOrientation)
      || settings.source.fileName !== source.fileName
      || settings.source.updatedAt !== source.updatedAt) return null;
    if (settings.version === 1) {
      const legacy = validateListingPrintCropDraft(settings, settings.source.width, settings.source.height, savedOrientation);
      const native = defaultNativeListingPrintCropDraft(settings.source.width, settings.source.height, savedOrientation);
      return {
        version: 3 as const,
        orientation: savedOrientation,
        sourceRatio: native.sourceRatio,
        source: settings.source,
        regions: legacy.regions,
        placements: native.sourceRatio === '4x5'
          ? native.placements!
          : Object.fromEntries(PRINT_CROP_RATIOS.map(({ key }) => [
              key,
              cropRegionToArtworkPlacement(legacy.regions[key]),
            ])) as PrintArtworkPlacements,
      };
    }
    return createListingPrintCropSettings(settings, settings.source, savedOrientation);
  } catch {
    return null;
  }
}

export function printCropPixelBounds(crop: PrintCropRegion, imageWidth: number, imageHeight: number) {
  validImageDimensions(imageWidth, imageHeight);
  const left = clamp(Math.round(crop.x * imageWidth), 0, imageWidth - 1);
  const top = clamp(Math.round(crop.y * imageHeight), 0, imageHeight - 1);
  const right = clamp(Math.round((crop.x + crop.width) * imageWidth), left + 1, imageWidth);
  const bottom = clamp(Math.round((crop.y + crop.height) * imageHeight), top + 1, imageHeight);
  return { left, top, width: right - left, height: bottom - top };
}
