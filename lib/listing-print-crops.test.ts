import { describe, expect, it } from 'vitest';

import {
  createListingPrintCropSettings,
  defaultListingPrintCropDraft,
  defaultNativeListingPrintCropDraft,
  listingPrintCropDraftForSave,
  movePrintArtworkPlacement,
  moveDerivedPrintCrop,
  moveMainPrintCrop,
  parseCurrentListingPrintCropSettings,
  resizeMainPrintCrop,
  scalePrintArtworkPlacement,
  validateListingPrintCropDraft,
} from '@/lib/listing-print-crops';

describe('listing print crop geometry', () => {
  it('includes saved paper placements in the API value', () => {
    const draft = defaultNativeListingPrintCropDraft(4000, 5000);
    const payload = listingPrintCropDraftForSave(draft);
    expect(payload.regions).toBe(draft.regions);
    expect(payload.placements).toBe(draft.placements);
  });

  it('creates the largest centred 2:3 crop and centres every derived ratio inside it', () => {
    const draft = defaultListingPrintCropDraft(7200, 10800);
    expect(draft.regions['2x3']).toEqual({ x: 0, y: 0, width: 1, height: 1 });
    for (const key of ['iso-a1', '5x7', '3x4', '4x5', '11x14'] as const) {
      expect(draft.regions[key].x).toBe(0);
      expect(draft.regions[key].width).toBe(1);
      expect(draft.regions[key].y).toBeGreaterThanOrEqual(0);
      expect(draft.regions[key].y + draft.regions[key].height).toBeLessThanOrEqual(1);
    }
    expect(() => validateListingPrintCropDraft(draft, 7200, 10800)).not.toThrow();
  });

  it('keeps main movement and ratio-preserving resizing inside the source image', () => {
    const initial = defaultListingPrintCropDraft(1000, 1000).regions['2x3'];
    const moved = moveMainPrintCrop(initial, 10, -10);
    expect(moved.x + moved.width).toBeCloseTo(1);
    expect(moved.y).toBe(0);
    const expanded = resizeMainPrintCrop(moved, 'w', -1, 0, 1000, 1000);
    expect(expanded.x).toBeGreaterThanOrEqual(0);
    expect(expanded.y).toBeGreaterThanOrEqual(0);
    expect(expanded.x + expanded.width).toBeLessThanOrEqual(1);
    expect(expanded.y + expanded.height).toBeLessThanOrEqual(1);
    expect((expanded.width * 1000) / (expanded.height * 1000)).toBeCloseTo(2 / 3, 8);
  });

  it('moves a derived crop vertically only and clamps it within the main crop', () => {
    const draft = defaultListingPrintCropDraft(7200, 10800);
    const main = draft.regions['2x3'];
    const source = draft.regions['4x5'];
    const moved = moveDerivedPrintCrop(main, source, 10);
    expect(moved.x).toBe(main.x);
    expect(moved.width).toBe(main.width);
    expect(moved.y + moved.height).toBeCloseTo(main.y + main.height);
  });

  it('creates and validates landscape crops with derived ratios moving horizontally', () => {
    const draft = defaultListingPrintCropDraft(10800, 7200, 'landscape');
    const main = draft.regions['2x3'];
    expect(main).toEqual({ x: 0, y: 0, width: 1, height: 1 });
    for (const key of ['iso-a1', '5x7', '3x4', '4x5', '11x14'] as const) {
      expect(draft.regions[key].y).toBe(0);
      expect(draft.regions[key].height).toBe(1);
      expect(draft.regions[key].x).toBeGreaterThanOrEqual(0);
      expect(draft.regions[key].x + draft.regions[key].width).toBeLessThanOrEqual(1);
    }
    const moved = moveDerivedPrintCrop(main, draft.regions['4x5'], 10, 'landscape');
    expect(moved.x + moved.width).toBeCloseTo(main.x + main.width);
    expect(moved.y).toBe(main.y);
    expect(moved.height).toBe(main.height);
    expect(() => validateListingPrintCropDraft(draft, 10800, 7200, 'landscape')).not.toThrow();
  });

  it('invalidates saved regions when the source artwork version changes', () => {
    const source = { fileName: 'thumbnail.png', updatedAt: '2026-10-16T12:00:00.000Z', width: 7200, height: 10800 };
    const settings = createListingPrintCropSettings(defaultListingPrintCropDraft(source.width, source.height), source);
    expect(parseCurrentListingPrintCropSettings(settings, source)).toEqual(settings);
    expect(parseCurrentListingPrintCropSettings(settings, {
      fileName: source.fileName,
      updatedAt: '2026-10-16T12:01:00.000Z',
    })).toBeNull();
  });

  it('places a complete portrait 4:5 source at full paper width and moves it vertically', () => {
    const draft = defaultNativeListingPrintCropDraft(4000, 5000);
    expect(draft.sourceRatio).toBe('4x5');
    expect(draft.regions['4x5']).toEqual({ x: 0, y: 0, width: 1, height: 1 });
    expect(draft.placements?.['2x3']).toMatchObject({ x: 0, width: 1, height: 5 / 6 });
    const moved = movePrintArtworkPlacement(draft.placements!['2x3'], 10, 10, 'portrait');
    expect(moved.x).toBe(0);
    expect(moved.width).toBe(1);
    expect(moved.y + moved.height).toBeCloseTo(1);
    const source = { fileName: 'thumbnail.png', updatedAt: '2026-10-18T10:00:00.000Z', width: 4000, height: 5000 };
    const settings = createListingPrintCropSettings(draft, source);
    expect(settings.version).toBe(3);
    expect(settings.sourceRatio).toBe('4x5');
  });

  it('scales a 4:5 artwork proportionally and saves a free position inside each paper', () => {
    const draft = defaultNativeListingPrintCropDraft(4000, 5000);
    const fullSize = draft.placements!['4x5'];
    const scaled = scalePrintArtworkPlacement(fullSize, fullSize, 0.6);
    const moved = movePrintArtworkPlacement(scaled, 0.3, 0.2, 'portrait', true);
    draft.placements!['4x5'] = moved;

    const source = { fileName: 'thumbnail.png', updatedAt: '2026-10-18T11:00:00.000Z', width: 4000, height: 5000 };
    const settings = createListingPrintCropSettings(draft, source);
    expect(settings.placements['4x5']).toEqual(moved);
    expect(moved).toMatchObject({ x: 0.4, y: 0.4, width: 0.6, height: 0.6 });
  });
});
