import { describe, expect, it } from 'vitest';
import { createTemplateOrientationPlan, type TemplateOrientationAsset } from '@/lib/template-orientation';
import { parseListingTemplateArtworkAssignments, planListingTemplateArtwork,
  type ListingTemplateArtworkCandidate } from '@/lib/listing-template-artwork-policy';
const sceneId='11111111-1111-4111-8111-111111111111',key=`200:${sceneId}`;
const candidate=(id:string,orientation:'portrait'|'landscape'='portrait',extra:Partial<ListingTemplateArtworkCandidate>={}):ListingTemplateArtworkCandidate=>({
  id,name:`Art ${id}`,orientation,sectionId:'30',subSectionId:'42',hasThumbnail:true,hasCurrentSizes:true,...extra});
const asset=(items:Array<[number,'portrait'|'landscape']>,extra:Partial<TemplateOrientationAsset>={}):TemplateOrientationAsset=>({sceneId,itemMapping:null,
  mode:'both',openings:items.map(([imageItemNumber,orientation])=>({imageItemNumber,orientation})),...extra});
function plan(image:TemplateOrientationAsset,assignments={},extra:Record<string,unknown>={}){
  return planListingTemplateArtwork({orientationPlan:createTemplateOrientationPlan(25,{},[{id:200,name:'Room',neutral:image.mode==='no-areas',portrait:image,landscape:image}]),
    currentListingId:'10',sectionId:'30',orientation:'portrait',candidates:[candidate('10'),candidate('11'),candidate('12','landscape')],assignments,...extra});
}
describe('listing artwork selection policy',()=>{
  it('counts distinct item numbers rather than areas and automatically uses current artwork for a single repeated item',()=>{
    const selected=plan(asset([[7,'portrait'],[7,'portrait'],[7,'portrait']]));
    expect(selected.valid).toBe(true);expect(selected.roles[0].requiresSelection).toBe(false);
    expect(selected.roles[0].items).toEqual([{itemNumber:7,orientation:'portrait',sourceListingId:'10',automatic:true}]);
  });
  it('uses actual noncontiguous item numbers and allows repeated source listings of the correct orientation',()=>{
    const selected=plan(asset([[1,'portrait'],[4,'portrait'],[4,'portrait']]),{[key]:{1:'10',4:'10'}});
    expect(selected.valid).toBe(true);expect(selected.roles[0].items.map(item=>item.itemNumber)).toEqual([1,4]);
    expect(selected.roles[0].requiresSelection).toBe(true);
  });
  it('requires the current listing at least once for each manually configured multi-item image',()=>{
    const selected=plan(asset([[1,'portrait'],[2,'portrait']]),{[key]:{1:'11',2:'11'}});
    expect(selected.valid).toBe(false);expect(selected.errors.join(' ')).toMatch(/current listing/);
  });
  it('permits mixed-orientation Combined scenes only with matching artwork and distinct IDs across orientations',()=>{
    expect(plan(asset([[1,'portrait'],[2,'landscape']],{mode:'combined'}),{[key]:{1:'10',2:'12'}}).valid).toBe(true);
    expect(plan(asset([[1,'portrait'],[1,'landscape']],{mode:'combined'})).errors.join(' ')).toMatch(/different artwork item numbers/);
    expect(plan(asset([[1,'portrait'],[2,'landscape']],{mode:'combined'}),{[key]:{1:'10',2:'11'}}).errors.join(' ')).toMatch(/needs landscape/);
  });
  it('does not require a thumbnail or crops when No areas just uses the saved image',()=>{
    const selected=plan(asset([],{mode:'no-areas'}),{}, {candidates:[candidate('10','portrait',{hasThumbnail:false,hasCurrentSizes:false})]});
    expect(selected.valid).toBe(true);expect(selected.roles[0].items).toEqual([]);expect(selected.roles[0].sceneId).toBe(sceneId);
  });
  it('blocks the entire listing for an incomplete room even when another generic image could render',()=>{
    const image=asset([[1,'portrait'],[2,'portrait']]);
    const orientationPlan=createTemplateOrientationPlan(25,{},[{id:199,name:'Infographic',neutral:true},{id:200,name:'Room',neutral:false,portrait:image}]);
    const selected=plan(image,{}, {orientationPlan});
    expect(selected.roles[0].valid).toBe(true);expect(selected.roles[1].valid).toBe(false);expect(selected.valid).toBe(false);
  });
  it.each([
    {source:candidate('11','portrait',{sectionId:'99'}),message:/this section/},
    {source:candidate('11','portrait',{hasThumbnail:false}),message:/Upload artwork/},
    {source:candidate('11','portrait',{hasCurrentSizes:false}),message:/Complete Set Size/},
  ])('rejects invalid source metadata without silently replacing a chosen source: $message',({source,message})=>{
    expect(plan(asset([[1,'portrait'],[2,'portrait']]),{[key]:{1:'10',2:'11'}},{candidates:[candidate('10'),source]}).errors.join(' ')).toMatch(message);
  });
  it('retains legacy grouped mappings including cross-section sources and linked single-item overrides',()=>{
    const selected=plan(asset([[1,'portrait']],{legacy:true,itemMapping:{1:3}}),{}, {candidates:[candidate('10','portrait',{hasThumbnail:false,hasCurrentSizes:false})],
      legacyGroupSources:{3:'90'},legacyCandidates:[candidate('90','portrait',{sectionId:'55',subSectionId:'91'})]});
    expect(selected.valid).toBe(true);expect(selected.roles[0].items[0]).toMatchObject({itemNumber:1,sourceListingId:'90',automatic:true});
    expect(selected.candidates.map(value=>value.id)).toEqual(['10']);
  });
  it('does not grant cross-section legacy access to a new manual image role',()=>{
    const selected=plan(asset([[1,'portrait'],[2,'portrait']]),{[key]:{1:'10',2:'90'}},{legacyGroupSources:{2:'90'},legacyCandidates:[candidate('90','portrait',{sectionId:'55'})]});
    expect(selected.valid).toBe(false);expect(selected.errors.join(' ')).toMatch(/this section/);
  });
  it('preserves inactive orientation selections and does not mutate input dictionaries',()=>{
    const inactive=`200:22222222-2222-4222-8222-222222222222`;
    const assignments={[inactive]:{1:'11'},[key]:{1:'10',2:'11'}},before=structuredClone(assignments);
    const selected=plan(asset([[1,'portrait'],[2,'portrait']]),assignments);
    expect(selected.assignments[inactive]).toEqual({1:'11'});expect(assignments).toEqual(before);
  });
  it.each([[],true,{'bad':{}},{[key]:{0:'10'}},{[key]:{1:'bad'}},{[key]:{1:10}}])('rejects malformed persisted selections: %j',value=>{
    expect(()=>parseListingTemplateArtworkAssignments(value)).toThrow();
  });
});
