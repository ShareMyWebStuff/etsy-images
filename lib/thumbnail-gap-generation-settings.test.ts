import { describe, expect, it } from 'vitest';
import {
  centredArtworkPlacementForRatio, createListingPrintCropSettings, cropDraftForMain,
  DEFAULT_FOUR_BY_FIVE_ARTWORK_SCALE_BY_RATIO, defaultNativeListingPrintCropDraft,
  fourByFivePrintCropDraft, moveNativePrintCrop, parseCurrentListingPrintCropSettings,
  PRINT_CROP_RATIOS, scalePrintArtworkPlacement, type ListingArtworkOrientation,
} from '@/lib/listing-print-crops';
import { defaultListingPersonalisationTextAreaSettings, parseListingPersonalisationTextAreas } from '@/lib/personalisation-text-areas';
import { prepareThumbnailGapGenerationSettings } from './thumbnail-gap-generation-settings';

const previousSource = { fileName: 'thumbnail.png', updatedAt: '2026-11-17T08:00:00.000Z' };
const identity = { fileName: 'thumbnail-gap-new.png', updatedAt: '2026-11-17T09:00:00.000Z' };
const customisation = { customisePrints: true, customTop: true, customBottom: true };
function stored(value: unknown) { return JSON.parse(JSON.stringify(value)); }
function input(width = 80, height = 100, orientation: ListingArtworkOrientation = 'portrait') {
  return { printCropSettings: null as unknown, personalisationTextAreas: null as unknown, previousSource, source: { ...identity, width, height }, orientation, customisation };
}

describe('generation settings after a thumbnail gap change', () => {
  it.each([
    { width: 80, height: 100, orientation: 'portrait' as const, version: 4 },
    { width: 100, height: 80, orientation: 'landscape' as const, version: 4 },
    { width: 80, height: 120, orientation: 'portrait' as const, version: 3 },
    { width: 120, height: 80, orientation: 'landscape' as const, version: 3 },
  ])('initializes valid canonical defaults for $orientation $width x $height', ({ width, height, orientation, version }) => {
    const value = input(width, height, orientation);
    const result = prepareThumbnailGapGenerationSettings(value);
    const expected = createListingPrintCropSettings(defaultNativeListingPrintCropDraft(width, height, orientation), value.source, orientation);
    expect(result.printCropSettings).toEqual(stored(expected));
    expect(parseCurrentListingPrintCropSettings(result.printCropSettings, { ...identity, orientation })).toEqual(expected);
    expect((result.printCropSettings as { version: number }).version).toBe(version);
    expect(result.personalisationTextAreas).toEqual(defaultListingPersonalisationTextAreaSettings());
  });

  it('rebinds version 4 selections without changing their horizontal position or geometry', () => {
    const value = input();
    const oldSource = { ...previousSource, width: 80, height: 100 };
    const draft = fourByFivePrintCropDraft(80, 100);
    draft.regions['2x3'] = moveNativePrintCrop(draft.regions['2x3'], 0.05, 0);
    const saved = createListingPrintCropSettings(draft, oldSource);
    const result = prepareThumbnailGapGenerationSettings({ ...value, printCropSettings: saved });
    expect(result.printCropSettings).toEqual(stored({ ...saved, source: value.source }));
    expect(saved.source).toEqual(oldSource);
  });

  it('preserves legacy version 3 4:5 scaled placements rather than converting them to version 4', () => {
    const value = input();
    const oldSource = { ...previousSource, width: 80, height: 100 };
    const draft = fourByFivePrintCropDraft(80, 100);
    draft.regions['2x3'] = moveNativePrintCrop(draft.regions['2x3'], 0.05, 0);
    const saved = {
      version: 3, orientation: 'portrait', sourceRatio: '4x5', source: oldSource, regions: draft.regions,
      placements: Object.fromEntries(PRINT_CROP_RATIOS.map(({ key }) => {
        const full = centredArtworkPlacementForRatio(80, 100, key);
        return [key, scalePrintArtworkPlacement(full, full, DEFAULT_FOUR_BY_FIVE_ARTWORK_SCALE_BY_RATIO[key])];
      })),
    };
    expect(parseCurrentListingPrintCropSettings(saved, previousSource)).not.toBeNull();
    const result = prepareThumbnailGapGenerationSettings({ ...value, printCropSettings: JSON.stringify(saved) });
    expect(result.printCropSettings).toEqual(stored({ ...saved, source: value.source }));
    expect(parseCurrentListingPrintCropSettings(result.printCropSettings, identity)?.placements).toEqual(saved.placements);
  });

  it('preserves a valid legacy version 1 zoomed main crop without applying modern native-crop validation', () => {
    const value = input(80, 120);
    const saved = { version: 1, orientation: 'portrait', source: { ...previousSource, width: 80, height: 120 }, ...cropDraftForMain({ x: 0.1, y: 0.1, width: 0.8, height: 0.8 }, 80, 120) };
    const before = parseCurrentListingPrintCropSettings(saved, previousSource);
    expect(before).not.toBeNull();
    const result = prepareThumbnailGapGenerationSettings({ ...value, printCropSettings: saved });
    expect(result.printCropSettings).toEqual(stored({ ...saved, source: value.source }));
    const after = parseCurrentListingPrintCropSettings(result.printCropSettings, identity);
    expect(after?.regions).toEqual(before?.regions);
    expect(after?.placements).toEqual(before?.placements);
  });

  it.each(['stale identity', 'different dimensions', 'invalid geometry'])('initializes defaults rather than retaining %s', (condition) => {
    const value = input();
    const saved = createListingPrintCropSettings(fourByFivePrintCropDraft(80, 100), { ...previousSource, width: 80, height: 100 });
    if (condition === 'stale identity') saved.source.updatedAt = '2026-01-01T00:00:00.000Z';
    if (condition === 'different dimensions') { saved.source.width = 160; saved.source.height = 200; }
    if (condition === 'invalid geometry') saved.regions['2x3'].x = 50;
    const result = prepareThumbnailGapGenerationSettings({ ...value, printCropSettings: saved });
    expect(result.printCropSettings).toEqual(stored(createListingPrintCropSettings(defaultNativeListingPrintCropDraft(80, 100), value.source)));
  });

  it('preserves valid per-ratio text positions and visibility, even when customisation is currently off', () => {
    const value = input();
    const saved = defaultListingPersonalisationTextAreaSettings();
    saved.areasByRatio['4x5'].top = { x: 0.2, y: 0.1, width: 0.6, height: 0.2 };
    saved.areasByRatio['2x3'].showBottom = false;
    const result = prepareThumbnailGapGenerationSettings({ ...value, personalisationTextAreas: saved, customisation: { customisePrints: false, customTop: false, customBottom: false } });
    expect(result.personalisationTextAreas).toEqual(saved);
  });

  it('defaults only the permitted text positions for applicable customisation', () => {
    const result = prepareThumbnailGapGenerationSettings({ ...input(), personalisationTextAreas: { broken: true }, customisation: { customisePrints: true, customTop: true, customBottom: false } });
    const settings = parseListingPersonalisationTextAreas(result.personalisationTextAreas)!;
    expect(Object.values(settings.areasByRatio).every((areas) => areas.showTop && !areas.showBottom)).toBe(true);
  });

  it('keeps missing personalisation settings null when customisation is off', () => {
    const result = prepareThumbnailGapGenerationSettings({ ...input(), customisation: { customisePrints: false, customTop: false, customBottom: false } });
    expect(result.personalisationTextAreas).toBeNull();
  });
});
