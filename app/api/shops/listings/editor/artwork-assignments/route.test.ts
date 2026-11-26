import {beforeEach,describe,expect,it,vi} from 'vitest';
const mocks=vi.hoisted(()=>({plan:vi.fn(),save:vi.fn(),editor:vi.fn(),context:vi.fn()}));
vi.mock('@/lib/listing-template-artwork',()=>({
  getListingTemplateArtworkPlan:mocks.plan,saveListingTemplateArtworkAssignments:mocks.save,listingTemplateArtworkContext:mocks.context,
  ListingTemplateArtworkError:class extends Error{constructor(message:string,public status=400){super(message);}},
}));
vi.mock('@/lib/listing-editor',()=>({getListingEditorData:mocks.editor}));
import {GET,PUT} from './route';
import {ListingTemplateArtworkError} from '@/lib/listing-template-artwork';
const context={shopId:'66',sectionId:'30',subSectionId:'42',listingId:'10'};
const plan={valid:true,roles:[],errors:[],assignments:{},fingerprint:'a'.repeat(64)};
const request=(body:unknown)=>new Request('http://localhost/api/shops/listings/editor/artwork-assignments',{method:'PUT',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});
beforeEach(()=>{vi.resetAllMocks();mocks.context.mockImplementation(value=>({shopId:value.shopId,sectionId:value.sectionId,subSectionId:value.subSectionId,listingId:value.listingId}));
  mocks.plan.mockResolvedValue(plan);mocks.save.mockResolvedValue(plan);mocks.editor.mockResolvedValue({context});});
describe('listing artwork assignments API',()=>{
  it('returns a scoped private metadata plan without saving anything',async()=>{
    const response=await GET(new Request(`http://localhost/api/shops/listings/editor/artwork-assignments?${new URLSearchParams(context)}`));
    expect(response.status).toBe(200);expect(await response.json()).toEqual({plan});expect(response.headers.get('Cache-Control')).toBe('private, no-store');
    expect(mocks.plan).toHaveBeenCalledWith(context);expect(mocks.save).not.toHaveBeenCalled();
  });
  it('saves the whole selection dictionary and returns fresh listing data only after persistence',async()=>{
    const assignments={'200:11111111-1111-4111-8111-111111111111':{1:'10',2:'11'}};
    const response=await PUT(request({...context,assignments}));
    expect(response.status).toBe(200);expect(await response.json()).toEqual({plan,data:{context}});
    expect(mocks.save).toHaveBeenCalledExactlyOnceWith(context,assignments);expect(mocks.editor).toHaveBeenCalledWith(context);
    expect(mocks.save.mock.invocationCallOrder[0]).toBeLessThan(mocks.editor.mock.invocationCallOrder[0]);
  });
  it('rejects a missing assignment payload and malformed JSON before saving',async()=>{
    expect((await PUT(request(context))).status).toBe(400);
    expect((await PUT(new Request('http://localhost',{method:'PUT',body:'{invalid'}))).status).toBe(400);
    expect(mocks.save).not.toHaveBeenCalled();expect(mocks.editor).not.toHaveBeenCalled();
  });
  it('preserves validation/conflict status and does not reload after a failed save',async()=>{
    mocks.save.mockRejectedValueOnce(new ListingTemplateArtworkError('The selected artwork changed.',409));
    const response=await PUT(request({...context,assignments:{}}));
    expect(response.status).toBe(409);expect(await response.json()).toEqual({error:'The selected artwork changed.'});expect(mocks.editor).not.toHaveBeenCalled();
  });
  it.each(['missing','failed'])('reports an acknowledged save truthfully when refreshing is %s',async(kind)=>{
    if(kind==='missing')mocks.editor.mockResolvedValueOnce(null);else mocks.editor.mockRejectedValueOnce(new Error('Database read failed'));
    const response=await PUT(request({...context,assignments:{}}));
    expect(response.status).toBe(200);expect(await response.json()).toEqual({plan,data:null,
      refreshError:'Artwork selections were saved, but the listing could not be refreshed. Reload this listing.'});expect(mocks.save).toHaveBeenCalledOnce();
  });
});
