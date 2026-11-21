import type { ListingArtworkOrientation } from '@/lib/listing-print-crops';
import type { TemplateOpeningCorners } from '@/lib/our-category-template-composite';
import type { PrintableDownloadRatio } from '@/lib/printable-download-specs';

/** Paper placement in the opening's rectified unit plane, independent of preview scale. */
export type PaperPlacement = { x: number; y: number; width: number };
export type PaperPlacementKey = `${PrintableDownloadRatio}:${ListingArtworkOrientation}`;
/** Nonzero alpha runs on a reduced grid spanning the complete original scene. */
export type ForegroundMaskRegion = { width: number; height: number; runs: Array<[start: number, length: number, alpha: number]> };
export type ForegroundMaskStroke = {
  mode: 'paint' | 'erase';
  /** Brush diameter in original scene pixels. */
  size: number;
  softness: number;
  points: Array<{ x: number; y: number }>;
  region?: ForegroundMaskRegion;
};
export type OurTemplateImageForegroundMask = { version: 1; strokes: ForegroundMaskStroke[] };
export type OurTemplateImageOpening = {
  id: string;
  name: string;
  corners: TemplateOpeningCorners;
  imageItemNumber: number;
  ratio: PrintableDownloadRatio;
  orientation: ListingArtworkOrientation;
  placements: Partial<Record<PaperPlacementKey, PaperPlacement>>;
};
export type OurTemplateImageDefinition = {
  width: number;
  height: number;
  openings: OurTemplateImageOpening[];
  lightingMode: 'auto' | 'opaque' | 'paired';
  foregroundMask?: OurTemplateImageForegroundMask;
};
