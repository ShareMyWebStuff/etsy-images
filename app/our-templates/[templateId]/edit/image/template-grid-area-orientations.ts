import type { TemplateOpeningRegion } from '@/lib/our-category-template-composite';
import type { ListingArtworkOrientation } from '@/lib/listing-print-crops';
import type { TemplateGridLayout } from '@/lib/template-grid-layout';

type ImageSize = { width: number; height: number };

/** Keep the existing orientation's bounds and offer a centered, rotated alternative. */
export function initialiseTemplateGridAreaOrientations(region: TemplateOpeningRegion, imageSize: ImageSize): TemplateOpeningRegion {
  if (!region.grid || region.grid.imageCount !== 1 || region.orientationCorners) return region;
  const { corners } = region;
  const originalWidth = corners.topRight.x - corners.topLeft.x + 1;
  const originalHeight = corners.bottomLeft.y - corners.topLeft.y + 1;
  const scale = Math.min(1, imageSize.width / originalHeight, imageSize.height / originalWidth);
  const width = Math.max(1, Math.round(originalHeight * scale));
  const height = Math.max(1, Math.round(originalWidth * scale));
  // Very shallow templates may not have enough room for a rotated area. Keep
  // their current valid bounds until the user sets a suitable landscape size.
  if ((width - 1) * (height - 1) < Math.max(16, imageSize.width * imageSize.height * 0.0025)) {
    return { ...region, orientationCorners: { portrait: corners, landscape: corners } };
  }
  const centerX = (corners.topLeft.x + corners.topRight.x) / 2;
  const centerY = (corners.topLeft.y + corners.bottomLeft.y) / 2;
  const left = Math.max(0, Math.min(imageSize.width - width, Math.round(centerX - (width - 1) / 2)));
  const top = Math.max(0, Math.min(imageSize.height - height, Math.round(centerY - (height - 1) / 2)));
  const right = left + width - 1;
  const bottom = top + height - 1;
  const rotatedCorners = {
    topLeft: { x: left, y: top },
    topRight: { x: right, y: top },
    bottomRight: { x: right, y: bottom },
    bottomLeft: { x: left, y: bottom },
  };
  const orientationCorners = region.grid.cells[0].orientation === 'landscape'
    ? { portrait: rotatedCorners, landscape: corners }
    : { portrait: corners, landscape: rotatedCorners };
  return {
    ...region,
    corners: orientationCorners.portrait,
    orientationCorners,
  };
}

export function templateGridAreaPreviewLayout(layout: TemplateGridLayout, orientation: ListingArtworkOrientation): TemplateGridLayout {
  return layout.imageCount === 1
    ? { ...layout, cells: layout.cells.map((cell) => ({ ...cell, orientation })) }
    : layout;
}
