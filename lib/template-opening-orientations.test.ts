import { describe, expect, it } from 'vitest';
import { templateOpeningCornersForOrientation, updateTemplateOpeningCorners } from './template-opening-orientations';
import { defaultTemplateGridLayout } from './template-grid-layout';
import type { TemplateOpeningRegion } from './our-category-template-composite';

const portrait = { topLeft: { x: 10, y: 10 }, topRight: { x: 50, y: 10 }, bottomRight: { x: 50, y: 80 }, bottomLeft: { x: 10, y: 80 } };
const landscape = { topLeft: { x: 5, y: 20 }, topRight: { x: 75, y: 20 }, bottomRight: { x: 75, y: 60 }, bottomLeft: { x: 5, y: 60 } };
const region: TemplateOpeningRegion = { id: 'area-1', name: 'Area 1', corners: portrait };

describe('independent artwork-area orientations', () => {
  it('preserves legacy bounds for either orientation until a separate size is set', () => {
    expect(templateOpeningCornersForOrientation(region, 'portrait')).toEqual(portrait);
    expect(templateOpeningCornersForOrientation(region, 'landscape')).toEqual(portrait);
  });
  it('saves landscape independently and retains canonical portrait bounds', () => {
    const updated = updateTemplateOpeningCorners(region, 'landscape', landscape);
    expect(updated.corners).toEqual(portrait);
    expect(templateOpeningCornersForOrientation(updated, 'portrait')).toEqual(portrait);
    expect(templateOpeningCornersForOrientation(updated, 'landscape')).toEqual(landscape);
    const resizedPortrait = { ...portrait, topLeft: { x: 11, y: 10 } };
    const resized = updateTemplateOpeningCorners(updated, 'portrait', resizedPortrait);
    expect(resized.corners).toEqual(resizedPortrait);
    expect(templateOpeningCornersForOrientation(resized, 'landscape')).toEqual(landscape);
  });
  it('uses one area boundary for a multi-image grid even if an earlier single-image layout had two', () => {
    const gridRegion = { ...region, grid: defaultTemplateGridLayout(2), orientationCorners: { portrait, landscape } };
    expect(templateOpeningCornersForOrientation(gridRegion, 'landscape')).toEqual(portrait);
    const moved = updateTemplateOpeningCorners(gridRegion, 'landscape', landscape);
    expect(templateOpeningCornersForOrientation(moved, 'portrait')).toEqual(landscape);
    expect(templateOpeningCornersForOrientation(moved, 'landscape')).toEqual(landscape);
  });
});
