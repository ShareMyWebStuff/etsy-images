import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createTemplateOrientationPlan } from '@/lib/template-orientation';
import { createListingPrintCropSettings,defaultNativeListingPrintCropDraft } from '@/lib/listing-print-crops';
const mocks=vi.hoisted(()=>({query:vi.fn(),execute:vi.fn(),transaction:vi.fn(),context:vi.fn(),plans:vi.fn()}));
vi.mock('@/lib/prisma',()=>({prisma:{$queryRaw:mocks.query,$transaction:mocks.transaction}}));
vi.mock('@/lib/local-listings',()=>({getListingContext:mocks.context}));
vi.mock('@/lib/listing-template-orientation',()=>({getListingTemplateOrientationPlans:mocks.plans}));
import {getListingTemplateArtworkPlan,getListingTemplateArtworkPlans,saveListingTemplateArtworkAssignments} from '@/lib/listing-template-artwork';
const context={shopId:'66',sectionId:'30',subSectionId:'42',listingId:'10'};
const sceneId='11111111-1111-4111-8111-111111111111',key=`200:${sceneId}`;
const updatedAt=new Date('2026-11-24T09:00:00.000Z');
function source(id:number,orientation:'portrait'|'landscape'='portrait',extra={}){
  const width=orientation==='portrait'?80:100,height=orientation==='portrait'?100:80,fileName=`${id}.png`;
  return{id,shopId:'66',subSectionId:id===10?42:43,localSectionId:30,ourCategoryId:25,templateType:'single',title:`Art ${id}`,localDirectoryName:`Art ${id}`,
    thumbnailFileName:fileName,thumbnailUpdatedAt:updatedAt,artworkOrientation:orientation,updatedAt,listingImagesRevision:7,templateArtworkAssignments:null,
    printCropSettings:createListingPrintCropSettings(defaultNativeListingPrintCropDraft(width,height,orientation),{fileName,updatedAt:updatedAt.toISOString(),width,height},orientation),...extra};
}
let rows:Array<ReturnType<typeof source>>,groups:Array<{position:number;sourceListingId:number}>;
beforeEach(()=>{
  vi.resetAllMocks();rows=[source(10),source(11,'landscape')];groups=[];
  mocks.context.mockResolvedValue({});
  mocks.plans.mockResolvedValue(new Map([[25,createTemplateOrientationPlan(25,{},[{id:200,name:'Combined room',neutral:false,
    portrait:{sceneId,mode:'combined',itemMapping:null,openings:[{imageItemNumber:1,orientation:'portrait'},{imageItemNumber:2,orientation:'landscape'}]},
    landscape:null}])]]));
  mocks.query.mockImplementation(async(strings:TemplateStringsArray)=>{
    const sql=strings.join('');
    if(sql.includes('FROM etsy_listing_group_items'))return groups;
    if(sql.includes('JOIN etsy_shop_sub_sections'))return structuredClone(rows);
    return rows.map(row=>({id:row.id}));
  });
  mocks.execute.mockImplementation(async(_strings,...values)=>{rows[0].templateArtworkAssignments=JSON.parse(values[0]);rows[0].listingImagesRevision++;return 1;});
  mocks.transaction.mockImplementation(async operation=>operation({$queryRaw:mocks.query,$executeRaw:mocks.execute}));
});
describe('listing artwork assignment service',()=>{
  it('reads same-section candidates across subsections and reports every missing choice without writes',async()=>{
    const plan=await getListingTemplateArtworkPlan(context);
    expect(plan.valid).toBe(false);expect(plan.roles[0].items).toHaveLength(2);expect(plan.candidates.map(candidate=>candidate.subSectionId)).toEqual(['42','43']);
    expect(mocks.transaction).not.toHaveBeenCalled();expect(mocks.execute).not.toHaveBeenCalled();
    const sql=mocks.query.mock.calls.map(([query])=>query.join('')).join('\n');
    expect(sql).toMatch(/listing\.shopId=/);expect(sql).toMatch(/subsection\.shopSectionId=/);
  });
  it('batches section candidates, group references and orientation metadata instead of querying per listing',async()=>{
    const plans=await getListingTemplateArtworkPlans([context,{...context,listingId:'11',subSectionId:'43'}],{includeCandidates:false});
    expect([...plans.keys()]).toEqual([10,11]);
    expect(plans.get(10)!.candidates).toEqual([]);expect(plans.get(10)!.valid).toBe(false);
    expect(mocks.query).toHaveBeenCalledTimes(2);expect(mocks.plans).toHaveBeenCalledTimes(1);
    expect(mocks.context).toHaveBeenCalledTimes(2);expect(mocks.transaction).not.toHaveBeenCalled();
  });
  it('atomically saves valid choices and invalidates images/fingerprint without touching source crops or files',async()=>{
    const crops=structuredClone(rows.map(row=>row.printCropSettings));
    const saved=await saveListingTemplateArtworkAssignments(context,{[key]:{1:'10',2:'11'}});
    expect(saved.valid).toBe(true);expect(saved.fingerprint).toMatch(/^[a-f0-9]{64}$/);
    expect(rows[0].templateArtworkAssignments).toEqual({[key]:{1:'10',2:'11'}});
    expect(rows.map(row=>row.printCropSettings)).toEqual(crops);
    expect(mocks.transaction).toHaveBeenCalledWith(expect.any(Function),{isolationLevel:'Serializable',timeout:30000});
    const sql=mocks.execute.mock.calls[0][0].join('');
    expect(sql).toMatch(/listingImagesRevision=listingImagesRevision\+1/);expect(sql).toMatch(/overviewGenerationFingerprint=/);
    expect(sql).not.toMatch(/DELETE|thumbnailFileName=|printCropSettings=|downloadsRevision/);
    expect(mocks.query.mock.calls.some(([query])=>query.join('').includes('ORDER BY id FOR UPDATE'))).toBe(true);
  });
  it('retains selections for the other orientation and makes an identical save idempotent',async()=>{
    const inactive=`200:22222222-2222-4222-8222-222222222222`;
    rows[0].templateArtworkAssignments={[inactive]:{1:'10'}} as never;
    await saveListingTemplateArtworkAssignments(context,{[key]:{1:'10',2:'11'}});
    expect(rows[0].templateArtworkAssignments).toHaveProperty(inactive);
    mocks.execute.mockClear();mocks.transaction.mockClear();
    await saveListingTemplateArtworkAssignments(context,{[key]:{1:'10',2:'11'}});
    expect(mocks.transaction).not.toHaveBeenCalled();expect(mocks.execute).not.toHaveBeenCalled();
  });
  it.each([{1:'11',2:'11'},{1:'10',2:'999'},{1:'10',2:'10'}])('rejects incomplete/wrong-section or mismatched choices before the transaction: %j',async assignments=>{
    await expect(saveListingTemplateArtworkAssignments(context,{[key]:assignments})).rejects.toMatchObject({status:400});
    expect(mocks.transaction).not.toHaveBeenCalled();
  });
  it('rejects a listing outside the exact subsection even if its section is otherwise accessible',async()=>{
    rows[0].subSectionId=99;
    await expect(getListingTemplateArtworkPlan(context)).rejects.toMatchObject({status:404});
    expect(mocks.plans).not.toHaveBeenCalled();
  });
  it('preserves an existing grouped source from another local section without exposing it as a new manual choice',async()=>{
    rows[0]=source(10,'portrait',{templateType:'multiple',thumbnailFileName:null,printCropSettings:null});
    rows.push(source(90,'portrait',{localSectionId:55,subSectionId:91}));groups=[{position:3,sourceListingId:90}];
    mocks.plans.mockResolvedValue(new Map([[25,createTemplateOrientationPlan(25,{},[{id:200,name:'Legacy linked room',neutral:false,
      portrait:{sceneId,legacy:true,itemMapping:{1:3},openings:[{imageItemNumber:1,orientation:'portrait'}]}}])]]));
    const plan=await getListingTemplateArtworkPlan(context);
    expect(plan.valid).toBe(true);expect(plan.roles[0].requiresSelection).toBe(false);
    expect(plan.roles[0].items).toEqual([{itemNumber:1,orientation:'portrait',sourceListingId:'90',automatic:true}]);
    expect(plan.candidates.some(candidate=>candidate.id==='90')).toBe(false);
    expect(mocks.transaction).not.toHaveBeenCalled();
  });
  it('blocks a concurrent crop change or stale listing claim instead of saving invalid selections',async()=>{
    mocks.transaction.mockImplementationOnce(async operation=>{
      rows[1].thumbnailFileName='replacement.png';
      return operation({$queryRaw:mocks.query,$executeRaw:mocks.execute});
    });
    await expect(saveListingTemplateArtworkAssignments(context,{[key]:{1:'10',2:'11'}})).rejects.toMatchObject({status:409});
    expect(mocks.execute).not.toHaveBeenCalled();
    rows[1]=source(11,'landscape');mocks.execute.mockResolvedValueOnce(0);
    await expect(saveListingTemplateArtworkAssignments(context,{[key]:{1:'10',2:'11'}})).rejects.toMatchObject({status:409});
  });
  it('changes its generation fingerprint for source crops/configuration, while metadata labels remain neutral',async()=>{
    rows[0].templateArtworkAssignments={[key]:{1:'10',2:'11'}} as never;
    const first=await getListingTemplateArtworkPlan(context);
    rows[1].title='Renamed metadata';rows[1].localDirectoryName='Renamed metadata';
    expect((await getListingTemplateArtworkPlan(context)).fingerprint).toBe(first.fingerprint);
    rows[1].printCropSettings.regions['2x3'].x-=0.02;
    expect((await getListingTemplateArtworkPlan(context)).fingerprint).not.toBe(first.fingerprint);
    const beforeSceneChange=await getListingTemplateArtworkPlan(context);
    const plans=await mocks.plans();
    plans.get(25).rows[0].portrait.asset.renderSignature='a'.repeat(64);
    expect((await getListingTemplateArtworkPlan(context)).fingerprint).not.toBe(beforeSceneChange.fingerprint);
    const renderChanged=await getListingTemplateArtworkPlan(context);
    plans.get(25).rows[0].portrait.asset.updatedAt=new Date('2026-11-25T10:00:00.000Z').toISOString();
    plans.get(25).rows[0].portrait.asset.definitionUpdatedAt=new Date('2026-11-25T10:00:00.000Z').toISOString();
    expect((await getListingTemplateArtworkPlan(context)).fingerprint).toBe(renderChanged.fingerprint);
  });
});
