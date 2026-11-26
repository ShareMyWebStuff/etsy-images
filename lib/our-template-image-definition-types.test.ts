import { describe, expect, it } from 'vitest';
import { getDefinitionArtworkItems, validateDefinitionChildMode } from '@/lib/our-template-image-definition-types';
import type { OurTemplateImageDefinition } from '@/lib/our-template-image-types';

function areas(items: Array<[number, 'portrait' | 'landscape']>) {
  return { openings: items.map(([imageItemNumber, orientation]) => ({ imageItemNumber, orientation })) } as Pick<OurTemplateImageDefinition, 'openings'>;
}
describe('definition mode and distinct artwork items', () => {
  it('counts distinct artwork item numbers instead of openings', () => {
    expect(getDefinitionArtworkItems(areas([[3, 'portrait'], [1, 'landscape'], [3, 'portrait']]))).toEqual([
      { imageItemNumber: 1, orientation: 'landscape' }, { imageItemNumber: 3, orientation: 'portrait' },
    ]);
  });
  it('rejects reusing an item across portrait and landscape areas', () => {
    expect(() => validateDefinitionChildMode('combined', 'single', areas([[1, 'portrait'], [1, 'landscape']]))).toThrow(/cannot be used for both/);
  });
  it('requires no areas only for a No areas single image', () => {
    expect(() => validateDefinitionChildMode('no-areas', 'single', areas([]))).not.toThrow();
    expect(() => validateDefinitionChildMode('no-areas', 'single', areas([[1, 'portrait']]))).toThrow(/without artwork areas/);
    expect(() => validateDefinitionChildMode('both', 'portrait', areas([]))).toThrow(/at least one artwork area/);
  });
  it('validates the paper orientation of every Both opening, independent of canvas shape', () => {
    expect(() => validateDefinitionChildMode('both', 'portrait', areas([[1, 'portrait'], [1, 'portrait']]))).not.toThrow();
    expect(() => validateDefinitionChildMode('both', 'landscape', areas([[1, 'landscape'], [2, 'portrait']]))).toThrow(/landscape orientation/);
  });
  it('requires both orientations with separate items for a Combined image', () => {
    expect(() => validateDefinitionChildMode('combined', 'single', areas([[1, 'portrait'], [3, 'landscape'], [1, 'portrait']]))).not.toThrow();
    expect(() => validateDefinitionChildMode('combined', 'single', areas([[1, 'portrait']]))).toThrow(/portrait area and one landscape area/);
    expect(() => validateDefinitionChildMode('combined', 'portrait', areas([[1, 'portrait'], [3, 'landscape']]))).toThrow(/Combined/);
  });
});
