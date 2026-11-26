import { NextResponse } from 'next/server';
import { getListingTemplateArtworkPlan, listingTemplateArtworkContext, ListingTemplateArtworkError,
  saveListingTemplateArtworkAssignments } from '@/lib/listing-template-artwork';

export const dynamic='force-dynamic';
function failure(error:unknown){return NextResponse.json({error:error instanceof Error?error.message:'Unable to save artwork selections.'},
  {status:error instanceof ListingTemplateArtworkError?error.status:500,headers:{'Cache-Control':'private, no-store'}});}
export async function GET(request:Request){
  try{return NextResponse.json({plan:await getListingTemplateArtworkPlan(listingTemplateArtworkContext(Object.fromEntries(new URL(request.url).searchParams)))},
    {headers:{'Cache-Control':'private, no-store'}});}catch(error){return failure(error);}
}
export async function PUT(request:Request){
  try{
    const text=await request.text();
    if(text.length>4*1024*1024)throw new ListingTemplateArtworkError('The artwork selections are too large.');
    let body:unknown;try{body=JSON.parse(text);}catch{throw new ListingTemplateArtworkError('Send valid artwork selections.');}
    if(!body||typeof body!=='object'||Array.isArray(body))throw new ListingTemplateArtworkError('Send valid artwork selections.');
    const value=body as Record<string,unknown>,context=listingTemplateArtworkContext(value);
    if(!Object.prototype.hasOwnProperty.call(value,'assignments'))throw new ListingTemplateArtworkError('Choose artwork for every required item.');
    const plan=await saveListingTemplateArtworkAssignments(context,value.assignments);
    try{
      const {getListingEditorData}=await import('@/lib/listing-editor');
      const data=await getListingEditorData(context);
      if(!data)throw new Error('The listing could not be reloaded.');
      return NextResponse.json({plan,data},{headers:{'Cache-Control':'private, no-store'}});
    }catch{return NextResponse.json({plan,data:null,refreshError:'Artwork selections were saved, but the listing could not be refreshed. Reload this listing.'},
      {headers:{'Cache-Control':'private, no-store'}});}
  }catch(error){return failure(error);}
}
