import { createHash } from 'node:crypto';
import { Prisma } from '@prisma/client';
import { prisma } from '@/lib/prisma';
import { normalizeListingArtworkOrientation, parseCurrentListingPrintCropSettings } from '@/lib/listing-print-crops';
import { getListingTemplateOrientationPlans } from '@/lib/listing-template-orientation';
import { parseListingTemplateArtworkAssignments, planListingTemplateArtwork,
  type ListingTemplateArtworkAssignments, type ListingTemplateArtworkCandidate,
  type ListingTemplateArtworkPlan } from '@/lib/listing-template-artwork-policy';
import type { TemplateOrientationPlan } from '@/lib/template-orientation';

export type ListingTemplateArtworkContext = { shopId:string;sectionId:string;subSectionId:string;listingId:string };
export type { ListingTemplateArtworkPlan, ListingTemplateArtworkAssignments } from '@/lib/listing-template-artwork-policy';
export class ListingTemplateArtworkError extends Error {
  constructor(message:string,readonly status=400,options?:ErrorOptions){super(message,options);this.name='ListingTemplateArtworkError';}
}
type Reader=Pick<typeof prisma,'$queryRaw'>;
type SourceRow={id:number;shopId:string;subSectionId:number;localSectionId:number;ourCategoryId:number|null;templateType:string|null;
  title:string;localDirectoryName:string|null;thumbnailFileName:string|null;thumbnailUpdatedAt:Date|string|null;
  artworkOrientation:string|null;printCropSettings:unknown;updatedAt:Date|string;listingImagesRevision:number;
  templateArtworkAssignments:unknown};
type GroupRow={position:number;sourceListingId:number};

export function listingTemplateArtworkContext(value:Record<string,unknown>):ListingTemplateArtworkContext{
  const result:Record<string,string>={};
  for(const key of ['shopId','sectionId','subSectionId','listingId'] as const){
    const input=value[key];
    if(typeof input!=='string'||!/^\d+$/.test(input)||BigInt(input)<1n||(key!=='shopId'&&!Number.isSafeInteger(Number(input))))throw new ListingTemplateArtworkError('Missing or invalid listing context.');
    result[key]=BigInt(input).toString();
  }
  return result as ListingTemplateArtworkContext;
}
function stable(value:unknown):string{
  if(Array.isArray(value))return`[${value.map(stable).join(',')}]`;
  if(value instanceof Date)return JSON.stringify(value.toISOString());
  if(value&&typeof value==='object')return`{${Object.entries(value).sort(([a],[b])=>a.localeCompare(b)).map(([key,item])=>`${JSON.stringify(key)}:${stable(item)}`).join(',')}}`;
  return JSON.stringify(value)??'null';
}
function sourceFingerprint(row:SourceRow){return stable({id:row.id,shopId:row.shopId,sectionId:row.localSectionId,subSectionId:row.subSectionId,
  fileName:row.thumbnailFileName,updatedAt:row.thumbnailUpdatedAt,orientation:row.artworkOrientation,crops:row.printCropSettings});}
function candidate(row:SourceRow):ListingTemplateArtworkCandidate{
  const orientation=normalizeListingArtworkOrientation(row.artworkOrientation);
  const updatedAt=row.thumbnailUpdatedAt?new Date(row.thumbnailUpdatedAt).toISOString():null;
  return{id:String(row.id),name:row.localDirectoryName??row.title??`Listing ${row.id}`,orientation,
    sectionId:String(row.localSectionId),subSectionId:String(row.subSectionId),hasThumbnail:Boolean(row.thumbnailFileName?.trim()),
    hasCurrentSizes:parseCurrentListingPrintCropSettings(row.printCropSettings,{fileName:row.thumbnailFileName,updatedAt,orientation})!==null};
}
async function sourceRows(context:ListingTemplateArtworkContext,extraIds:number[],reader:Reader=prisma,allAssignments=false){
  const extra=extraIds.length?Prisma.sql`OR listing.id IN (${Prisma.join(extraIds)})`:Prisma.empty;
  const assignments=allAssignments?Prisma.sql`listing.templateArtworkAssignments`:Prisma.sql`CASE WHEN listing.id=${Number(context.listingId)} THEN listing.templateArtworkAssignments ELSE NULL END`;
  return reader.$queryRaw<SourceRow[]>`
    SELECT listing.id,listing.shopId,listing.subSectionId,subsection.shopSectionId AS localSectionId,
      listing.ourCategoryId,category.templateType,listing.title,listing.localDirectoryName,
      listing.thumbnailFileName,listing.thumbnailUpdatedAt,listing.artworkOrientation,listing.printCropSettings,
      listing.updatedAt,listing.listingImagesRevision,
      ${assignments} AS templateArtworkAssignments
    FROM etsy_listings listing
    JOIN etsy_shop_sub_sections subsection ON subsection.id=listing.subSectionId
    LEFT JOIN our_categories category ON category.id=listing.ourCategoryId
    WHERE listing.shopId=${context.shopId} AND (subsection.shopSectionId=${Number(context.sectionId)} ${extra})
    ORDER BY listing.localDirectoryName,listing.title,listing.id
  `;
}
async function load(input:ListingTemplateArtworkContext){
  const context=listingTemplateArtworkContext(input);
  const {getListingContext}=await import('@/lib/local-listings');
  try{await getListingContext(context.shopId,context.sectionId,context.subSectionId);}
  catch(error){if(error instanceof Error&&/not found\.$/.test(error.message))throw new ListingTemplateArtworkError(error.message,404);throw error;}
  const [local,groups]=await Promise.all([sourceRows(context,[]),prisma.$queryRaw<GroupRow[]>`
    SELECT position,sourceListingId FROM etsy_listing_group_items WHERE groupListingId=${Number(context.listingId)} ORDER BY position`]);
  const current=local.find(row=>row.id===Number(context.listingId)&&row.subSectionId===Number(context.subSectionId));
  if(!current)throw new ListingTemplateArtworkError('Listing not found in this shop and subsection.',404);
  if(!current.ourCategoryId)throw new ListingTemplateArtworkError('Choose a listing template before selecting artwork.');
  const [plans,allSources]=await Promise.all([getListingTemplateOrientationPlans([current.ourCategoryId]),
    groups.length?sourceRows(context,groups.map(group=>group.sourceListingId)):Promise.resolve(local)]);
  const orientationPlan=plans.get(current.ourCategoryId);
  if(!orientationPlan)throw new ListingTemplateArtworkError('The assigned listing template could not be loaded.',409);
  return{context,current,groups,allSources,orientationPlan};
}
function planFrom(loaded:Awaited<ReturnType<typeof load>>,assignments:ListingTemplateArtworkAssignments):ListingTemplateArtworkPlan&{fingerprint:string}{
  const {context,current,groups,allSources,orientationPlan}=loaded;
  const local=allSources.filter(row=>row.localSectionId===Number(context.sectionId));
  const external=allSources.filter(row=>row.localSectionId!==Number(context.sectionId));
  const plan=planListingTemplateArtwork({orientationPlan,currentListingId:context.listingId,sectionId:context.sectionId,
    orientation:normalizeListingArtworkOrientation(current.artworkOrientation),candidates:local.map(candidate),legacyCandidates:external.map(candidate),assignments,
    legacyGroupSources:current.templateType==='multiple'?Object.fromEntries(groups.map(group=>[String(group.position),String(group.sourceListingId)])):undefined});
  const selected=new Set(plan.roles.flatMap(role=>role.items.flatMap(item=>item.sourceListingId?[item.sourceListingId]:[])));
  const policy={portraitEnabled:orientationPlan.portraitEnabled,landscapeEnabled:orientationPlan.landscapeEnabled,
    roles:orientationPlan.rows.map(role=>({id:role.id,orientationSpecific:role.orientationSpecific,
      slots:['portrait','landscape'].map(orientation=>{const slot=role[orientation as 'portrait'|'landscape'];return{
        sceneId:slot.sceneId,mode:slot.asset?.mode,definitionId:slot.asset?.definitionId,renderSignature:slot.asset?.renderSignature,itemMapping:slot.itemMapping,
        openings:slot.asset?.openings.map(({imageItemNumber,orientation})=>({imageItemNumber,orientation}))};})}))};
  const fingerprint=createHash('sha256').update(stable({orientation:plan.orientation,policy,revision:Number(current.listingImagesRevision),assignments:plan.assignments,
    sources:allSources.filter(row=>selected.has(String(row.id))).map(sourceFingerprint)})).digest('hex');
  return{...plan,fingerprint};
}
export async function getListingTemplateArtworkPlan(input:ListingTemplateArtworkContext,options:{includeCandidates?:boolean}={}){
  const loaded=await load(input);
  let assignments:ListingTemplateArtworkAssignments;
  try{assignments=parseListingTemplateArtworkAssignments(loaded.current.templateArtworkAssignments);}
  catch{const plan=planFrom(loaded,{});return{...plan,valid:false,errors:['The saved artwork selections are invalid. Choose the artwork again.',...plan.errors],candidates:options.includeCandidates===false?[]:plan.candidates};}
  const plan=planFrom(loaded,assignments);
  return options.includeCandidates===false?{...plan,candidates:[]}:plan;
}

/** Reuse section candidates and role metadata across a table/sync request, without a per-listing query loop. */
export async function getListingTemplateArtworkPlans(inputs:ListingTemplateArtworkContext[],options:{includeCandidates?:boolean;orientationPlans?:ReadonlyMap<number,TemplateOrientationPlan>}={}){
  const contexts=inputs.map(input=>listingTemplateArtworkContext(input));
  const result=new Map<number,ListingTemplateArtworkPlan&{fingerprint:string}>();
  if(!contexts.length||typeof prisma.$queryRaw!=='function')return result;
  const {getListingContext}=await import('@/lib/local-listings');
  const sections=new Map<string,ListingTemplateArtworkContext[]>();
  for(const context of contexts){const key=`${context.shopId}:${context.sectionId}`;sections.set(key,[...(sections.get(key)??[]),context]);}
  for(const grouped of sections.values()){
    const context=grouped[0];
    const uniqueSubsections=[...new Map(grouped.map(value=>[value.subSectionId,value])).values()];
    await Promise.all(uniqueSubsections.map(value=>getListingContext(value.shopId,value.sectionId,value.subSectionId)));
    const listingIds=[...new Set(grouped.map(value=>Number(value.listingId)))];
    const [local,groups]=await Promise.all([sourceRows(context,[],prisma,true),prisma.$queryRaw<Array<GroupRow&{groupListingId:number}>>`
      SELECT groupListingId,position,sourceListingId FROM etsy_listing_group_items WHERE groupListingId IN (${Prisma.join(listingIds)}) ORDER BY groupListingId,position`]);
    const extraIds=[...new Set(groups.map(group=>group.sourceListingId))];
    const allSources=extraIds.length?await sourceRows(context,extraIds,prisma,true):local;
    const categoryIds=[...new Set(local.filter(row=>listingIds.includes(row.id)).flatMap(row=>row.ourCategoryId?[row.ourCategoryId]:[]))];
    const plans=options.orientationPlans??await getListingTemplateOrientationPlans(categoryIds);
    for(const item of grouped){
      const current=local.find(row=>row.id===Number(item.listingId)&&row.subSectionId===Number(item.subSectionId));
      if(!current)continue;
      const orientationPlan=current.ourCategoryId?plans.get(current.ourCategoryId):undefined;
      if(!orientationPlan)continue;
      let assignments:ListingTemplateArtworkAssignments={},invalid=false;
      try{assignments=parseListingTemplateArtworkAssignments(current.templateArtworkAssignments);}catch{invalid=true;}
      const plan=planFrom({context:item,current,groups:groups.filter(group=>group.groupListingId===current.id),allSources,orientationPlan},assignments);
      if(invalid){plan.valid=false;plan.errors.unshift('The saved artwork selections are invalid. Choose the artwork again.');}
      if(options.includeCandidates===false)plan.candidates=[];
      result.set(current.id,plan);
    }
  }
  return result;
}

/** Validate the entire listing before any mutation; storage and source artwork remain untouched. */
export async function saveListingTemplateArtworkAssignments(input:ListingTemplateArtworkContext,value:unknown){
  const loaded=await load(input);
  let submitted:ListingTemplateArtworkAssignments;
  try{submitted=parseListingTemplateArtworkAssignments(value);}
  catch(error){throw new ListingTemplateArtworkError(error instanceof Error?error.message:'The artwork selections are invalid.');}
  let previous:ListingTemplateArtworkAssignments={};
  try{previous=parseListingTemplateArtworkAssignments(loaded.current.templateArtworkAssignments);}catch{/* A complete valid replacement can repair malformed saved selections. */}
  const combined={...previous,...submitted};
  const plan=planFrom(loaded,combined);
  if(!plan.valid)throw new ListingTemplateArtworkError(plan.errors.join(' '));
  const canonical=plan.assignments;
  if(stable(previous)===stable(canonical))return plan;
  const selectedIds=[...new Set([Number(loaded.context.listingId),...plan.roles.flatMap(role=>role.items.flatMap(item=>item.sourceListingId?[Number(item.sourceListingId)]:[]))])].sort((a,b)=>a-b);
  await prisma.$transaction(async transaction=>{
    await transaction.$queryRaw`SELECT id FROM etsy_listings WHERE id IN (${Prisma.join(selectedIds)}) ORDER BY id FOR UPDATE`;
    const fresh=await sourceRows(loaded.context,loaded.groups.map(group=>group.sourceListingId),transaction);
    const byId=new Map(fresh.map(row=>[row.id,row]));
    for(const id of selectedIds){
      const before=loaded.allSources.find(row=>row.id===id),after=byId.get(id);
      if(!before||!after||sourceFingerprint(before)!==sourceFingerprint(after))throw new ListingTemplateArtworkError('Selected source artwork changed. Reload the listing and choose its artwork again.',409);
    }
    const now=new Date();
    const changed=await transaction.$executeRaw`
      UPDATE etsy_listings SET templateArtworkAssignments=${JSON.stringify(canonical)},
        listingImagesRevision=listingImagesRevision+1,imagesChanged=1,lastLocalChangeAt=${now},updatedAt=${now},
        overviewGenerationFingerprint=${'0'.repeat(64)}
      WHERE id=${Number(loaded.context.listingId)} AND shopId=${loaded.context.shopId}
        AND subSectionId=${Number(loaded.context.subSectionId)} AND ourCategoryId=${loaded.current.ourCategoryId}
        AND updatedAt=${new Date(loaded.current.updatedAt)} AND listingImagesRevision=${Number(loaded.current.listingImagesRevision)}
    `;
    if(Number(changed)!==1)throw new ListingTemplateArtworkError('The listing or its template changed. Reload it before saving artwork selections.',409);
  },{isolationLevel:Prisma.TransactionIsolationLevel.Serializable,timeout:30_000});
  return getListingTemplateArtworkPlan(loaded.context);
}
