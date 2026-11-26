import { beforeEach, describe, expect, it, vi } from 'vitest';
const mocks = vi.hoisted(() => ({ query: vi.fn() }));
vi.mock('@/lib/prisma', () => ({ prisma: { $queryRaw: mocks.query } }));
import { getListingTemplateOrientationPlans } from '@/lib/listing-template-orientation';
import { selectListingTemplateOrientation } from '@/lib/template-orientation';

const sceneId = '11111111-1111-4111-8111-111111111111';
const secondSceneId = '22222222-2222-4222-8222-222222222222';
const opening = (orientation = 'portrait', imageItemNumber = 1) => ({ id: String(imageItemNumber), imageItemNumber, orientation });
const role = (id = 1, extra = {}) => ({ id, categoryId: 25, name: `Role ${id}`, position: id, ourTemplateImageId: null,
  ourTemplateImageItemMapping: null, orientationVariants: null, linkedSourceCategoryId: null, linkedSourceImageTemplateId: null,
  linkedImageItemNumber: null, ...extra });
let categories: unknown[], initial: ReturnType<typeof role>[], linked: ReturnType<typeof role>[], scenes: unknown[],definitions:unknown[];
const querySql = (value: unknown) => Array.isArray(value) ? value.join('') : (value as { sql: string }).sql;
beforeEach(() => {
  categories = [{ id: 25, portraitEnabled: 1, landscapeEnabled: 1 }]; initial = []; linked = []; scenes = [];definitions=[];
  mocks.query.mockReset().mockImplementation(async (query: unknown) => {
    const sql = querySql(query);
    if (sql.includes('FROM our_categories')) return categories;
    if (sql.includes('FROM our_template_image_definitions')) return definitions;
    if (sql.includes('FROM our_template_images')) return scenes;
    return sql.includes('WHERE categoryId IN') ? initial : linked;
  });
});

describe('batched template orientation metadata', () => {
  it('avoids queries for no categories and rejects invalid IDs', async () => {
    expect(await getListingTemplateOrientationPlans([])).toEqual(new Map());
    for (const ids of [[0], [-1], [NaN], [1.2]]) await expect(getListingTemplateOrientationPlans(ids)).rejects.toThrow(/Invalid/);
    expect(mocks.query).not.toHaveBeenCalled();
  });

  it('keeps generic legacy rows neutral despite category exclusions and reads both raw flags in a batch', async () => {
    categories = [{ id: 25, portraitEnabled: false, landscapeEnabled: true }, { id: 26, portraitEnabled: null, landscapeEnabled: null }];
    initial = [role(), role(2, { categoryId: 26 })];
    const plans = await getListingTemplateOrientationPlans([25, 26, 25]);
    expect(selectListingTemplateOrientation(plans.get(25)!, 'portrait').expectedIds).toEqual([1]);
    expect(plans.get(25)!.portraitEnabled).toBe(false);
    expect(plans.get(26)!.landscapeEnabled).toBe(true);
    expect(mocks.query).toHaveBeenCalledTimes(2);
  });

  it('classifies a legacy saved scene from paper openings, using only opening JSON rather than masks or image bytes', async () => {
    initial = [role(1, { ourTemplateImageId: sceneId, ourTemplateImageItemMapping: '{"1":2}' })];
    scenes = [{ id: sceneId, openings: JSON.stringify([opening()]),renderSignature:'a'.repeat(64) }];
    const plan = (await getListingTemplateOrientationPlans([25])).get(25)!;
    expect(plan.rows[0].portrait.asset?.renderSignature).toBe('a'.repeat(64));
    expect(selectListingTemplateOrientation(plan, 'portrait', { 2: 'portrait' }).expectedIds).toEqual([1]);
    expect(selectListingTemplateOrientation(plan, 'landscape').skippedIds).toEqual([1]);
    const sql = mocks.query.mock.calls.map(([value]) => querySql(value)).join('\n');
    expect(sql).toContain("JSON_EXTRACT(definition, '$.openings')");
    expect(sql).not.toContain('SELECT *'); expect(sql).not.toContain('foregroundMask');
    expect(sql).toContain('SHA2(CONCAT(CAST(definition AS CHAR)');
  });

  it('uses explicit slots without falling back to an old single saved scene', async () => {
    initial = [role(1, { ourTemplateImageId: sceneId, orientationVariants: JSON.stringify({ portrait: null, landscape: { ourTemplateImageId: secondSceneId } }) })];
    scenes = [{ id: secondSceneId, openings: [opening('landscape')] }];
    const plan = (await getListingTemplateOrientationPlans([25])).get(25)!;
    expect(selectListingTemplateOrientation(plan, 'portrait').expectedIds).toEqual([]);
    expect(selectListingTemplateOrientation(plan, 'landscape').rows[0]).toMatchObject({ enabled: true, sceneId: secondSceneId });
  });

  it('resolves linked source variants and applies the outer artwork item override to every opening', async () => {
    initial = [role(1, { linkedSourceCategoryId: 26, linkedSourceImageTemplateId: 20, linkedImageItemNumber: 3 })];
    linked = [role(20, { categoryId: 26, orientationVariants: { portrait: { ourTemplateImageId: sceneId, itemMapping: { 1: 2, 2: 4 } }, landscape: null } })];
    scenes = [{ id: sceneId, openings: [opening('portrait', 1), opening('portrait', 2)] }];
    const plan = (await getListingTemplateOrientationPlans([25])).get(25)!;
    const selected = selectListingTemplateOrientation(plan, 'portrait', { 3: 'portrait' });
    expect(selected.rows[0]).toMatchObject({ id: 1, sceneId, itemMapping: { 1: 3, 2: 3 }, enabled: true });
    expect(selected.expectedIds).toEqual([1]);
    expect(mocks.query).toHaveBeenCalledTimes(4);
  });

  it.each(['missing', 'cycle', 'wrong-category'])('disables a %s source link without breaking other image roles', async (kind) => {
    initial = [role(), role(2, { linkedSourceCategoryId: 26, linkedSourceImageTemplateId: 20, linkedImageItemNumber: 1 })];
    linked = kind === 'missing' ? [] : [role(20, { categoryId: kind === 'wrong-category' ? 99 : 26,
      ...(kind === 'cycle' ? { linkedSourceCategoryId: 25, linkedSourceImageTemplateId: 2, linkedImageItemNumber: 1 } : {}) })];
    const plan = (await getListingTemplateOrientationPlans([25])).get(25)!;
    expect(selectListingTemplateOrientation(plan, 'portrait').expectedIds).toEqual([1]);
    expect(selectListingTemplateOrientation(plan, 'portrait').rows[1].disabledReason).toMatch(/unavailable|circular/);
  });

  it('skips missing scenes and corrupt slot JSON without hiding a valid neutral row', async () => {
    initial = [role(), role(2, { ourTemplateImageId: sceneId }), role(3, { orientationVariants: '{bad JSON' })];
    const selected = selectListingTemplateOrientation((await getListingTemplateOrientationPlans([25])).get(25)!, 'portrait');
    expect(selected.expectedIds).toEqual([1]); expect(selected.skippedIds).toEqual([2, 3]);
  });

  it('does not cache flags or scene changes across calls, and propagates database errors', async () => {
    initial = [role(1, { ourTemplateImageId: sceneId })]; scenes = [{ id: sceneId, openings: [opening()] }];
    expect(selectListingTemplateOrientation((await getListingTemplateOrientationPlans([25])).get(25)!, 'portrait').expectedIds).toEqual([1]);
    categories = [{ id: 25, portraitEnabled: false, landscapeEnabled: true }];
    expect(selectListingTemplateOrientation((await getListingTemplateOrientationPlans([25])).get(25)!, 'portrait').expectedIds).toEqual([]);
    mocks.query.mockRejectedValueOnce(new Error('Database unavailable'));
    await expect(getListingTemplateOrientationPlans([25])).rejects.toThrow('Database unavailable');
  });

  it('selects Both children from the new parent associations and preserves legacy mapping metadata',async()=>{
    initial=[role(1,{templateImageDefinitionId:'parent',ourTemplateImageId:sceneId,ourTemplateImageItemMapping:{1:3}})];
    definitions=[{id:'parent',mode:'both',variantSlot:'portrait',sceneId},{id:'parent',mode:'both',variantSlot:'landscape',sceneId:secondSceneId}];
    scenes=[{id:sceneId,openings:[opening()]},{id:secondSceneId,openings:[opening('landscape')]}];
    const plan=(await getListingTemplateOrientationPlans([25])).get(25)!;
    expect(plan.rows[0].portrait.asset).toMatchObject({definitionId:'parent',mode:'both',sceneId,itemMapping:{1:3},legacy:true});
    expect(selectListingTemplateOrientation(plan,'landscape').rows[0].sceneId).toBe(secondSceneId);
  });

  it('uses a No areas child as a neutral saved asset even with no source or enabled artwork orientation',async()=>{
    categories=[{id:25,portraitEnabled:false,landscapeEnabled:false}];
    initial=[role(1,{templateImageDefinitionId:'parent'})];
    definitions=[{id:'parent',mode:'no-areas',variantSlot:'single',sceneId}];scenes=[{id:sceneId,openings:[]}];
    const plan=(await getListingTemplateOrientationPlans([25])).get(25)!;
    expect(plan.rows[0].orientationSpecific).toBe(false);
    expect(selectListingTemplateOrientation(plan,'portrait',new Map()).rows[0]).toMatchObject({sceneId,enabled:true});
    expect(plan.rows[0].landscape.asset).toMatchObject({mode:'no-areas',legacy:false});
  });

  it('preserves mixed Combined openings for actual per-artwork orientation checks and fails closed for empty parents',async()=>{
    initial=[role(1,{templateImageDefinitionId:'parent'}),role(2,{templateImageDefinitionId:'empty'})];
    definitions=[{id:'parent',mode:'combined',variantSlot:'single',sceneId},{id:'empty',mode:'both',variantSlot:null,sceneId:null}];
    scenes=[{id:sceneId,openings:[opening('portrait',1),opening('landscape',2)]}];
    const plan=(await getListingTemplateOrientationPlans([25])).get(25)!;
    expect(selectListingTemplateOrientation(plan,'portrait',{1:'portrait',2:'landscape'}).expectedIds).toEqual([1]);
    expect(plan.rows[0].portrait.asset?.mode).toBe('combined');
    expect(selectListingTemplateOrientation(plan,'portrait').skippedIds).toContain(2);
  });
});
