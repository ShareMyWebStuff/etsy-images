import type { ListingArtworkOrientation } from '@/lib/listing-print-crops';
import type { PrintableDownloadRatio } from '@/lib/printable-download-specs';
import {
  DEFAULT_PRINTSHRIMP_CUSTOM_FONT_ID,
  getPrintShrimpCustomFont,
  type PrintShrimpCustomFontId,
} from '@/lib/printshrimp/custom-fonts';

export const TEMPLATE_GRID_RATIO_OPTIONS: ReadonlyArray<{ value: PrintableDownloadRatio; label: string; width: number; height: number }> = [
  { value: 'iso-a1', label: 'ISO A', width: 1, height: Math.SQRT2 },
  { value: '2x3', label: '2 × 3', width: 2, height: 3 },
  { value: '3x4', label: '3 × 4', width: 3, height: 4 },
  { value: '4x5', label: '4 × 5', width: 4, height: 5 },
  { value: '5x7', label: '5 × 7', width: 5, height: 7 },
  { value: '11x14', label: '11 × 14', width: 11, height: 14 },
];

export const TEMPLATE_GRID_FRAME_OPTIONS = [
  { value: 'unframed', label: 'Unframed' },
  { value: 'black', label: 'Black' },
  { value: 'white', label: 'White' },
  { value: 'oak', label: 'Oak' },
] as const;

export const DEFAULT_TEMPLATE_GRID_BORDER_SIZE_PERCENT = 5;
export const DEFAULT_TEMPLATE_GRID_FRAME_THICKNESS_PERCENT = 4;
export const DEFAULT_TEMPLATE_GRID_FRAME_DEPTH_PERCENT = 1;
export const DEFAULT_TEMPLATE_GRID_SHADOW_STRENGTH = 17;

export type TemplateGridFrameFinish = (typeof TEMPLATE_GRID_FRAME_OPTIONS)[number]['value'];

export type TemplateGridCell = {
  imageItemNumber: number;
  ratio: PrintableDownloadRatio;
  orientation: ListingArtworkOrientation;
  borderEnabled: boolean;
  borderSizePercent: number;
  frameEnabled: boolean;
  frameFinish: TemplateGridFrameFinish;
  frameThicknessPercent: number;
  frameDepthPercent: number;
  shadowStrength: number;
  topText: string;
  bottomText: string;
  fontId: PrintShrimpCustomFontId;
  configured: boolean;
};

export type TemplateGridLayout = {
  version: 1;
  imageCount: number;
  rows: number;
  columns: number;
  horizontalGapPercent: number;
  verticalGapPercent: number;
  cells: TemplateGridCell[];
};

export type TemplateGridCellRect = {
  index: number;
  x: number;
  y: number;
  width: number;
  height: number;
};

const RATIO_KEYS = new Set(TEMPLATE_GRID_RATIO_OPTIONS.map(({ value }) => value));
const FRAME_KEYS = new Set(TEMPLATE_GRID_FRAME_OPTIONS.map(({ value }) => value));

function finiteNumber(value: unknown, label: string) {
  const number = Number(value);
  if (!Number.isFinite(number)) throw new Error(`${label} is invalid.`);
  return number;
}

function wholeNumber(value: unknown, minimum: number, maximum: number, label: string) {
  const number = finiteNumber(value, label);
  if (!Number.isSafeInteger(number) || number < minimum || number > maximum) {
    throw new Error(`${label} must be between ${minimum} and ${maximum}.`);
  }
  return number;
}

export function defaultTemplateGridCell(imageItemNumber = 1): TemplateGridCell {
  return {
    imageItemNumber,
    ratio: 'iso-a1',
    orientation: 'portrait',
    borderEnabled: false,
    borderSizePercent: DEFAULT_TEMPLATE_GRID_BORDER_SIZE_PERCENT,
    frameEnabled: false,
    frameFinish: 'unframed',
    frameThicknessPercent: DEFAULT_TEMPLATE_GRID_FRAME_THICKNESS_PERCENT,
    frameDepthPercent: DEFAULT_TEMPLATE_GRID_FRAME_DEPTH_PERCENT,
    shadowStrength: DEFAULT_TEMPLATE_GRID_SHADOW_STRENGTH,
    topText: '',
    bottomText: '',
    fontId: DEFAULT_PRINTSHRIMP_CUSTOM_FONT_ID,
    configured: false,
  };
}

export function defaultTemplateGridLayout(imageCount = 1, imageItemNumber = 1): TemplateGridLayout {
  const count = Math.max(1, Math.min(12, Math.round(imageCount)));
  const rows = Math.min(4, Math.max(1, Math.ceil(Math.sqrt(count))));
  const columns = Math.ceil(count / rows);
  return {
    version: 1,
    imageCount: count,
    rows,
    columns,
    horizontalGapPercent: 5,
    verticalGapPercent: 5,
    cells: Array.from({ length: count }, () => defaultTemplateGridCell(imageItemNumber)),
  };
}

export function resizeTemplateGridLayout(layout: TemplateGridLayout, imageCount: number): TemplateGridLayout {
  const count = Math.max(1, Math.min(12, Math.round(imageCount)));
  const rows = Math.min(layout.rows, Math.min(4, count));
  const columns = Math.max(Math.min(layout.columns, count), Math.ceil(count / rows));
  return {
    ...layout,
    imageCount: count,
    rows,
    columns,
    cells: Array.from({ length: count }, (_, index) => layout.cells[index] ?? defaultTemplateGridCell()),
  };
}

export function validateTemplateGridLayout(value: unknown, maximumImageItemNumber = 12): TemplateGridLayout {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('The area grid settings are invalid.');
  const record = value as Record<string, unknown>;
  const imageCount = wholeNumber(record.imageCount, 1, 12, 'No of Images');
  const rows = wholeNumber(record.rows, 1, Math.min(4, imageCount), 'Number of rows');
  const columns = wholeNumber(record.columns, 1, imageCount, 'Number of columns');
  if (rows * columns < imageCount) throw new Error('The selected rows and columns do not have enough cells for every image.');
  const horizontalGapPercent = finiteNumber(record.horizontalGapPercent, 'Horizontal gap');
  const verticalGapPercent = finiteNumber(record.verticalGapPercent, 'Vertical gap');
  if (horizontalGapPercent < 0 || horizontalGapPercent > 50 || verticalGapPercent < 0 || verticalGapPercent > 50) {
    throw new Error('Grid gaps must be between 0% and 50%.');
  }
  if (!Array.isArray(record.cells) || record.cells.length !== imageCount) {
    throw new Error(`Configure all ${imageCount} grid images.`);
  }
  const cells = record.cells.map((value, index): TemplateGridCell => {
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error(`Image ${index + 1} settings are invalid.`);
    const cell = value as Record<string, unknown>;
    const imageItemNumber = wholeNumber(cell.imageItemNumber, 1, maximumImageItemNumber, `Image ${index + 1} item number`);
    const ratio = typeof cell.ratio === 'string' && RATIO_KEYS.has(cell.ratio as PrintableDownloadRatio)
      ? cell.ratio as PrintableDownloadRatio
      : null;
    const orientation = cell.orientation === 'portrait' || cell.orientation === 'landscape' ? cell.orientation : null;
    const borderEnabled = cell.borderEnabled === undefined ? false : typeof cell.borderEnabled === 'boolean' ? cell.borderEnabled : null;
    const borderSizePercent = cell.borderSizePercent === undefined
      ? DEFAULT_TEMPLATE_GRID_BORDER_SIZE_PERCENT
      : finiteNumber(cell.borderSizePercent, `Image ${index + 1} Border Size`);
    const suppliedFrameEnabled = cell.frameEnabled === undefined ? null : typeof cell.frameEnabled === 'boolean' ? cell.frameEnabled : null;
    let frameFinish = typeof cell.frameFinish === 'string' && FRAME_KEYS.has(cell.frameFinish as TemplateGridFrameFinish)
      ? cell.frameFinish as TemplateGridFrameFinish
      : null;
    // Legacy grids stored a separate enabled flag and defaulted the finish to
    // oak even when no frame was selected.
    if (suppliedFrameEnabled === false) frameFinish = 'unframed';
    const frameEnabled = frameFinish === null ? null : frameFinish !== 'unframed';
    const frameThicknessPercent = cell.frameThicknessPercent === undefined
      ? DEFAULT_TEMPLATE_GRID_FRAME_THICKNESS_PERCENT
      : finiteNumber(cell.frameThicknessPercent, `Image ${index + 1} Frame Thickness`);
    const frameDepthPercent = cell.frameDepthPercent === undefined
      ? DEFAULT_TEMPLATE_GRID_FRAME_DEPTH_PERCENT
      : finiteNumber(cell.frameDepthPercent, `Image ${index + 1} Frame Depth`);
    const shadowStrength = cell.shadowStrength === undefined
      ? DEFAULT_TEMPLATE_GRID_SHADOW_STRENGTH
      : finiteNumber(cell.shadowStrength, `Image ${index + 1} Shadow Strength`);
    const topText = cell.topText === undefined ? '' : typeof cell.topText === 'string' && cell.topText.length <= 40 ? cell.topText : null;
    const bottomText = cell.bottomText === undefined ? '' : typeof cell.bottomText === 'string' && cell.bottomText.length <= 40 ? cell.bottomText : null;
    const fontId = cell.fontId === undefined
      ? DEFAULT_PRINTSHRIMP_CUSTOM_FONT_ID
      : getPrintShrimpCustomFont(cell.fontId)?.id ?? null;
    // Grid templates saved before per-image editing was introduced already had
    // all of these fields selected in the old second step, so treat a missing
    // flag as complete. Newly-created cells explicitly start incomplete.
    const configured = cell.configured === undefined ? true : typeof cell.configured === 'boolean' ? cell.configured : null;
    if (!ratio) throw new Error(`Choose a print ratio for Image ${index + 1}.`);
    if (!orientation) throw new Error(`Choose an orientation for Image ${index + 1}.`);
    if (borderEnabled === null || borderSizePercent < 2.5 || borderSizePercent > 10) throw new Error(`Border Size for Image ${index + 1} must be between 2.5% and 10%.`);
    if (frameEnabled === null || !frameFinish) throw new Error(`Choose valid frame settings for Image ${index + 1}.`);
    if (frameThicknessPercent < 2 || frameThicknessPercent > 12) throw new Error(`Frame Thickness for Image ${index + 1} must be between 2% and 12%.`);
    if (frameDepthPercent < 0 || frameDepthPercent > 5) throw new Error(`Frame Depth for Image ${index + 1} must be between 0% and 5%.`);
    if (shadowStrength < 0 || shadowStrength > 25) throw new Error(`Shadow Strength for Image ${index + 1} must be between 0% and 25%.`);
    if (topText === null || bottomText === null) throw new Error(`Top Text and Bottom Text for Image ${index + 1} must contain no more than 40 characters.`);
    if (!fontId) throw new Error(`Choose a font for Image ${index + 1}.`);
    if (configured === null) throw new Error(`Image ${index + 1} completion status is invalid.`);
    return {
      imageItemNumber,
      ratio,
      orientation,
      borderEnabled,
      borderSizePercent,
      frameEnabled,
      frameFinish,
      frameThicknessPercent,
      frameDepthPercent,
      shadowStrength,
      topText,
      bottomText,
      fontId,
      configured,
    };
  });
  return {
    version: 1,
    imageCount,
    rows,
    columns,
    horizontalGapPercent,
    verticalGapPercent,
    cells,
  };
}

function cellAspect(ratio: PrintableDownloadRatio, orientation: ListingArtworkOrientation) {
  const option = TEMPLATE_GRID_RATIO_OPTIONS.find((candidate) => candidate.value === ratio)!;
  const portrait = option.width / option.height;
  return orientation === 'landscape' ? 1 / portrait : portrait;
}

export function templateGridCellRects(width: number, height: number, layout: TemplateGridLayout): TemplateGridCellRect[] {
  if (!(width > 0) || !(height > 0)) return [];
  const columnSlotWidth = width / layout.columns;
  const rowSlotHeight = height / layout.rows;
  const horizontalGap = columnSlotWidth * layout.horizontalGapPercent / 100;
  const verticalGap = rowSlotHeight * layout.verticalGapPercent / 100;
  const cellSlotWidth = (width - horizontalGap * (layout.columns - 1)) / layout.columns;
  const cellSlotHeight = (height - verticalGap * (layout.rows - 1)) / layout.rows;
  return layout.cells.map((cell, index) => {
    const row = Math.floor(index / layout.columns);
    const itemsInRow = Math.min(layout.columns, layout.imageCount - row * layout.columns);
    const rowWidth = itemsInRow * cellSlotWidth + Math.max(0, itemsInRow - 1) * horizontalGap;
    const rowLeft = (width - rowWidth) / 2;
    const column = index % layout.columns;
    const slotX = rowLeft + column * (cellSlotWidth + horizontalGap);
    const slotY = row * (cellSlotHeight + verticalGap);
    const aspect = cellAspect(cell.ratio, cell.orientation);
    const slotAspect = cellSlotWidth / cellSlotHeight;
    const cellWidth = aspect >= slotAspect ? cellSlotWidth : cellSlotHeight * aspect;
    const cellHeight = aspect >= slotAspect ? cellSlotWidth / aspect : cellSlotHeight;
    return {
      index,
      x: slotX + (cellSlotWidth - cellWidth) / 2,
      y: slotY + (cellSlotHeight - cellHeight) / 2,
      width: cellWidth,
      height: cellHeight,
    };
  });
}
