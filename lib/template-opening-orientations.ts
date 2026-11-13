import type { ListingArtworkOrientation } from '@/lib/listing-print-crops';
import type { TemplateOpeningCorners, TemplateOpeningRegion } from '@/lib/our-category-template-composite';

/** Multi-image areas have one set of bounds; single-image areas can have two. */
export function templateOpeningCornersForOrientation(region: TemplateOpeningRegion, orientation: ListingArtworkOrientation): TemplateOpeningCorners {
  return (region.grid?.imageCount ?? 1) === 1 ? region.orientationCorners?.[orientation] ?? region.corners : region.corners;
}

export function updateTemplateOpeningCorners(region: TemplateOpeningRegion, orientation: ListingArtworkOrientation, corners: TemplateOpeningCorners): TemplateOpeningRegion {
  if ((region.grid?.imageCount ?? 1) > 1) return { ...region, corners };
  const orientationCorners = {
    portrait: templateOpeningCornersForOrientation(region, 'portrait'),
    landscape: templateOpeningCornersForOrientation(region, 'landscape'),
    [orientation]: corners,
  };
  return { ...region, corners: orientationCorners.portrait, orientationCorners };
}
