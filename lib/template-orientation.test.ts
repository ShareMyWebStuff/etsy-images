import { describe, expect, it } from 'vitest';
import {
  createTemplateOrientationPlan, getSceneOrientationCompatibility, parseTemplateOrientationVariants,
  selectListingTemplateOrientation, templateOrientationFlags, type TemplateOrientationAsset, type TemplateSceneOpening,
} from '@/lib/template-orientation';

const portraitId = '11111111-1111-4111-8111-111111111111';
const landscapeId = '22222222-2222-4222-8222-222222222222';
const portrait = { id: 'p', name: 'Portrait frame', imageItemNumber: 1, orientation: 'portrait' as const };
const landscape = { id: 'l', name: 'Landscape frame', imageItemNumber: 2, orientation: 'landscape' as const };
const asset = (openings: TemplateSceneOpening[] = [portrait], sceneId = portraitId, itemMapping: Record<string, number> | null = null): TemplateOrientationAsset => ({ sceneId, openings, itemMapping });

describe('template orientation policy', () => {
  it('defaults missing legacy flags to both orientations and respects raw database false values', () => {
    expect(templateOrientationFlags(undefined)).toEqual({ portraitEnabled: true, landscapeEnabled: true });
    expect(templateOrientationFlags({ portraitEnabled: null, landscapeEnabled: 0 })).toEqual({ portraitEnabled: true, landscapeEnabled: false });
    expect(templateOrientationFlags({ portraitEnabled: false, landscapeEnabled: true })).toEqual({ portraitEnabled: false, landscapeEnabled: true });
  });

  it('accepts explicit empty slots without confusing them with the legacy resolver', () => {
    expect(parseTemplateOrientationVariants(null)).toBeNull();
    expect(parseTemplateOrientationVariants('{}')).toEqual({ portrait: null, landscape: null });
    expect(parseTemplateOrientationVariants({ portrait: { ourTemplateImageId: portraitId, itemMapping: { 1: 3 } }, landscape: null }))
      .toEqual({ portrait: { ourTemplateImageId: portraitId, itemMapping: { 1: 3 } }, landscape: null });
  });

  it.each([[], false, { unknown: null }, { portrait: 'image' }, { portrait: { ourTemplateImageId: 'not-an-id' } },
    { portrait: { ourTemplateImageId: portraitId, itemMapping: { 1: 0 } } },
    { portrait: { ourTemplateImageId: portraitId, itemMapping: { bad: 1 } } },
  ])('rejects malformed slot references: %j', (value) => {
    expect(() => parseTemplateOrientationVariants(value)).toThrow();
  });

  it('uses every opening paper orientation, independently of room image shape or tags', () => {
    expect(getSceneOrientationCompatibility([portrait], 'portrait')).toEqual({ compatible: true, reason: null });
    expect(getSceneOrientationCompatibility([portrait], 'landscape')).toMatchObject({ compatible: false, reason: expect.stringMatching(/portrait paper.*landscape/) });
    expect(getSceneOrientationCompatibility([portrait, landscape], 'portrait').compatible).toBe(false);
    expect(getSceneOrientationCompatibility([], 'portrait').compatible).toBe(false);
  });

  it('checks actual grouped sources after item mapping and refuses missing referenced artwork', () => {
    const sources = new Map([[3, 'portrait' as const], [4, 'landscape' as const]]);
    expect(getSceneOrientationCompatibility([portrait, landscape], 'portrait', sources, { 1: 3, 2: 4 }).compatible).toBe(true);
    expect(getSceneOrientationCompatibility([portrait, landscape], 'portrait', sources, { 1: 4, 2: 3 }).compatible).toBe(false);
    expect(getSceneOrientationCompatibility([portrait], 'portrait', { 2: 'portrait' }, { 1: 3 }))
      .toMatchObject({ compatible: false, reason: expect.stringMatching(/item 3.*not available/) });
  });

  it('selects exact asset slots while keeping one output role ID for both orientations', () => {
    const plan = createTemplateOrientationPlan(25, {}, [{ id: 100, name: 'Room', neutral: false,
      portrait: asset(), landscape: asset([{ ...landscape, imageItemNumber: 1 }], landscapeId) }]);
    expect(selectListingTemplateOrientation(plan, 'portrait').rows[0]).toMatchObject({ id: 100, enabled: true, sceneId: portraitId });
    expect(selectListingTemplateOrientation(plan, 'landscape').rows[0]).toMatchObject({ id: 100, enabled: true, sceneId: landscapeId });
    expect(selectListingTemplateOrientation(plan, 'landscape').expectedIds).toEqual([100]);
  });

  it('leaves general legacy uploads, grids, font samples and infographic rows enabled on a mismatched category', () => {
    const plan = createTemplateOrientationPlan(25, { portraitEnabled: false, landscapeEnabled: false }, [
      { id: 1, name: 'Generic upload', neutral: true }, { id: 2, name: 'Grid', neutral: true },
      { id: 3, name: 'Fonts', neutral: true }, { id: 4, name: 'Infographic', neutral: true },
      { id: 5, name: 'Room', neutral: false, portrait: asset() },
    ]);
    const selected = selectListingTemplateOrientation(plan, 'portrait');
    expect(selected.expectedIds).toEqual([1, 2, 3, 4]);
    expect(selected.skippedIds).toEqual([5]);
    expect(selected.warning).toMatch(/does not support portrait/);
    expect(selected.rows[0]).toMatchObject({ sceneId: null, disabledReason: null });
  });

  it('skips a missing counterpart and a wrong-orientation scene rather than choosing another slot', () => {
    const plan = createTemplateOrientationPlan(25, {}, [
      { id: 10, name: 'Portrait only', neutral: false, portrait: asset() },
      { id: 11, name: 'Wrong slot', neutral: false, landscape: asset() },
    ]);
    const selected = selectListingTemplateOrientation(plan, 'landscape');
    expect(selected.expectedIds).toEqual([]);
    expect(selected.skippedIds).toEqual([10, 11]);
    expect(selected.rows[0].disabledReason).toMatch(/No landscape image/);
    expect(selected.rows[1].disabledReason).toMatch(/portrait paper/);
    expect(selected.warning).toMatch(/2 image roles/);
  });

  it('reevaluates mixed scenes with real group orientation maps even if the default category preview is incompatible', () => {
    const mixed = asset([portrait, landscape]);
    const plan = createTemplateOrientationPlan(25, {}, [{ id: 10, name: 'Mixed room', neutral: false, portrait: mixed, landscape: mixed }]);
    expect(plan.rows[0].portrait.enabled).toBe(false);
    const selected = selectListingTemplateOrientation(plan, 'portrait', { 1: 'portrait', 2: 'landscape' });
    expect(selected.expectedIds).toEqual([10]);
    expect(selected.warning).toBeNull();
    expect(selectListingTemplateOrientation(plan, 'portrait', { 1: 'portrait', 2: 'portrait' }).skippedIds).toEqual([10]);
  });

  it('does not recover missing/corrupt assets or persistent role errors merely because a source map matches', () => {
    const bad = createTemplateOrientationPlan(25, {}, [{ id: 10, name: 'Broken', neutral: false, error: 'The linked role is invalid.', portrait: asset() },
      { id: 11, name: 'Missing scene', neutral: false, portrait: { ...asset(), error: 'The saved scene is unavailable.' } }]);
    const selected = selectListingTemplateOrientation(bad, 'portrait', { 1: 'portrait' });
    expect(selected.expectedIds).toEqual([]);
    expect(selected.rows.map((row) => row.disabledReason)).toEqual(['The linked role is invalid.', 'The saved scene is unavailable.']);
  });

  it('preserves the caller inputs and deduplicates required output IDs', () => {
    const roles = [{ id: 10, name: 'Room', neutral: false, portrait: asset() }, { id: 10, name: 'Duplicate', neutral: true }];
    const before = structuredClone(roles);
    const plan = createTemplateOrientationPlan(25, {}, roles);
    expect(selectListingTemplateOrientation(plan, 'portrait').expectedIds).toEqual([10]);
    expect(roles).toEqual(before);
  });
});
