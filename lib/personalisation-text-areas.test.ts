import { describe, expect, it } from 'vitest';
import {
  DEFAULT_LISTING_PERSONALISATION_TEXT_AREAS,
  defaultListingPersonalisationTextAreaSettings,
  effectiveListingPersonalisationTextAreas,
  validateListingPersonalisationTextAreas,
} from '@/lib/personalisation-text-areas';

describe('listing personalisation text areas', () => {
  it('uses the existing top and bottom placement until settings are saved', () => {
    expect(effectiveListingPersonalisationTextAreas(null, {
      customisePrints: true,
      customTop: true,
      customBottom: true,
    })).toMatchObject({
      saved: null,
      showTop: true,
      showBottom: true,
      top: DEFAULT_LISTING_PERSONALISATION_TEXT_AREAS.top,
      bottom: DEFAULT_LISTING_PERSONALISATION_TEXT_AREAS.bottom,
    });
  });

  it('applies template permissions ahead of saved visibility choices', () => {
    expect(effectiveListingPersonalisationTextAreas({
      ...DEFAULT_LISTING_PERSONALISATION_TEXT_AREAS,
      showTop: true,
      showBottom: true,
    }, {
      customisePrints: true,
      customTop: false,
      customBottom: true,
    })).toMatchObject({ showTop: false, showBottom: true });
  });

  it('uses the saved layout for the requested print aspect ratio', () => {
    const settings = defaultListingPersonalisationTextAreaSettings();
    settings.areasByRatio['4x5'].top = { x: 0.1, y: 0.2, width: 0.8, height: 0.12 };

    expect(effectiveListingPersonalisationTextAreas(settings, {
      customisePrints: true,
      customTop: true,
      customBottom: true,
    }, '4x5').top).toEqual({ x: 0.1, y: 0.2, width: 0.8, height: 0.12 });
    expect(effectiveListingPersonalisationTextAreas(settings, {
      customisePrints: true,
      customTop: true,
      customBottom: true,
    }, '2x3').top).toEqual(DEFAULT_LISTING_PERSONALISATION_TEXT_AREAS.top);
  });

  it('expands a legacy shared layout across every aspect ratio', () => {
    const legacy = {
      ...DEFAULT_LISTING_PERSONALISATION_TEXT_AREAS,
      top: { x: 0.1, y: 0.08, width: 0.8, height: 0.1 },
    };
    const parsed = validateListingPersonalisationTextAreas(legacy);

    expect(parsed.version).toBe(2);
    expect(parsed.areasByRatio['2x3'].top).toEqual(legacy.top);
    expect(parsed.areasByRatio['11x14'].top).toEqual(legacy.top);
  });

  it('rejects an area extending beyond the artwork', () => {
    expect(() => validateListingPersonalisationTextAreas({
      ...DEFAULT_LISTING_PERSONALISATION_TEXT_AREAS,
      top: { x: 0.2, y: 0.05, width: 0.9, height: 0.1 },
    })).toThrow(/remain inside/);
  });
});
