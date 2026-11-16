import { describe, expect, it } from 'vitest';

import {
  centredArtworkPlacementForRatio,
  createListingPrintCropSettings,
  cropRegionToArtworkPlacement,
  DEFAULT_FOUR_BY_FIVE_ARTWORK_SCALE_BY_RATIO,
  defaultListingPrintCropDraft,
  defaultNativeListingPrintCropDraft,
  fourByFivePrintCropDraft,
  listingPrintCropDraftForSave,
  moveNativePrintCrop,
  moveDerivedPrintCrop,
  moveMainPrintCrop,
  parseCurrentListingPrintCropSettings,
  PRINT_CROP_RATIOS,
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

  it('uses full-height portrait selections and derives matching placements for every paper ratio', () => {
    const draft = defaultNativeListingPrintCropDraft(4000, 5000);
    expect(draft.sourceRatio).toBe('4x5');
    expect(draft.regions['4x5']).toEqual({ x: 0, y: 0, width: 1, height: 1 });
    for (const ratio of PRINT_CROP_RATIOS) {
      const crop = draft.regions[ratio.key];
      expect(crop.y).toBe(0);
      expect(crop.height).toBe(1);
      expect(crop.width * 4000 / 5000).toBeCloseTo(ratio.width / ratio.height);
      expect(crop.x).toBeCloseTo((1 - crop.width) / 2);
      expect(draft.placements![ratio.key]).toEqual(cropRegionToArtworkPlacement(crop));
    }
    expect(draft.regions['2x3'].width).toBeCloseTo(5 / 6);
    expect(draft.placements?.['2x3'].height).toBe(1);
    const source = { fileName: 'thumbnail.png', updatedAt: '2026-10-18T10:00:00.000Z', width: 4000, height: 5000 };
    const settings = createListingPrintCropSettings(draft, source);
    expect(settings.version).toBe(4);
    expect(settings.sourceRatio).toBe('4x5');
    expect(parseCurrentListingPrintCropSettings(settings, source)).toEqual(settings);
  });

  it('keeps full height for landscape outputs and allows the wider paper frame to include side margins', () => {
    const draft = defaultNativeListingPrintCropDraft(5000, 4000, 'landscape');
    expect(draft.sourceRatio).toBe('4x5');
    for (const ratio of PRINT_CROP_RATIOS) {
      const crop = draft.regions[ratio.key];
      expect(crop.y).toBe(0);
      expect(crop.height).toBe(1);
      expect(crop.width * 5000 / 4000).toBeCloseTo(ratio.height / ratio.width);
      expect(crop.width).toBeGreaterThanOrEqual(1);
      expect(draft.placements![ratio.key]).toEqual(cropRegionToArtworkPlacement(crop));
    }
    expect(draft.regions['2x3'].width).toBeCloseTo(1.2);
    expect(draft.regions['2x3'].x).toBeCloseTo(-0.1);
    const source = { fileName: 'landscape.png', updatedAt: '2026-11-13T10:00:00.000Z', width: 5000, height: 4000 };
    const settings = createListingPrintCropSettings(draft, source, 'landscape');
    expect(parseCurrentListingPrintCropSettings(settings, source)).toEqual(settings);
  });

  it.each(['portrait', 'landscape'] as const)('moves %s selections horizontally and clamps both ends', (orientation) => {
    const draft = fourByFivePrintCropDraft(orientation === 'portrait' ? 4000 : 5000, orientation === 'portrait' ? 5000 : 4000, orientation);
    for (const ratio of PRINT_CROP_RATIOS) {
      const crop = draft.regions[ratio.key];
      const left = moveNativePrintCrop(crop, -10, 10);
      const right = moveNativePrintCrop(crop, 10, -10);
      expect(left.x).toBeCloseTo(Math.min(0, 1 - crop.width));
      expect(right.x).toBeCloseTo(Math.max(0, 1 - crop.width));
      expect(left.y).toBe(0);
      expect(right.y).toBe(0);
      expect(left.height).toBe(1);
      expect(right.width).toBe(crop.width);
    }
  });

  it('makes the selected region authoritative when a stale paper placement is submitted', () => {
    const draft = defaultNativeListingPrintCropDraft(4000, 5000);
    draft.regions['2x3'] = moveNativePrintCrop(draft.regions['2x3'], 10, 0);
    draft.placements!['2x3'] = { x: 0.2, y: 0.2, width: 0.6, height: 0.5 };
    const source = { fileName: 'thumbnail.png', updatedAt: '2026-10-18T11:00:00.000Z', width: 4000, height: 5000 };
    const settings = createListingPrintCropSettings(draft, source);
    expect(settings.placements['2x3']).toEqual(cropRegionToArtworkPlacement(draft.regions['2x3']));
    expect(settings.regions['4x5']).toEqual({ x: 0, y: 0, width: 1, height: 1 });
  });

  it('retains old 4:5 paper placements until the new selections are saved', () => {
    const source = { fileName: 'thumbnail.png', updatedAt: '2026-10-18T11:00:00.000Z', width: 4000, height: 5000 };
    const draft = fourByFivePrintCropDraft(source.width, source.height);
    draft.regions['2x3'] = moveNativePrintCrop(draft.regions['2x3'], 10, 0);
    const legacy = {
      version: 3 as const, orientation: 'portrait' as const, sourceRatio: '4x5' as const, source,
      regions: draft.regions,
      placements: Object.fromEntries(PRINT_CROP_RATIOS.map(({ key }) => {
        const full = centredArtworkPlacementForRatio(source.width, source.height, key);
        return [key, scalePrintArtworkPlacement(full, full, DEFAULT_FOUR_BY_FIVE_ARTWORK_SCALE_BY_RATIO[key])];
      })) as typeof draft.placements,
    };
    expect(parseCurrentListingPrintCropSettings(legacy, source)).toEqual(legacy);
    const reopened = fourByFivePrintCropDraft(source.width, source.height, 'portrait', legacy.regions);
    expect(reopened.regions['2x3'].x).toBeCloseTo(draft.regions['2x3'].x);
    const settings = createListingPrintCropSettings(reopened, source);
    expect(settings.version).toBe(4);
    expect(settings.placements['2x3']).not.toEqual(legacy.placements['2x3']);
  });

  it('rejects resized, vertically shifted, and out-of-range 4:5 crop frames', () => {
    const source = { fileName: 'thumbnail.png', updatedAt: '2026-10-18T11:00:00.000Z', width: 4000, height: 5000 };
    for (const changes of [{ y: 0.1 }, { height: 0.9 }, { width: 0.7 }, { x: -0.2 }]) {
      const draft = fourByFivePrintCropDraft(source.width, source.height);
      Object.assign(draft.regions['2x3'], changes);
      expect(() => createListingPrintCropSettings(draft, source)).toThrow(/complete thumbnail height|horizontal range/);
    }
  });
});
