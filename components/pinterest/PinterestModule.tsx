'use client';
import { useCallback, useEffect, useState } from 'react'; import Link from 'next/link'; import { Button } from '@/components/ui/button'; import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'; import { Input } from '@/components/ui/input'; import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { ChevronDown, ChevronRight, Eraser, Plus, Trash2 } from 'lucide-react';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { PINTEREST_DESCRIPTION_MAX_LENGTH, pinDescriptionLength, validatePinDescription } from '@/lib/pinterest/description';
type Json = Record<string, any>;
type PinPagination = { page:number;pageSize:number;total:number;totalPages:number };
type BoardPinPage = { pins:Json[];pagination:PinPagination;loading:boolean;error:string;selectedIds:number[];requestedPage?:number };
const PIN_PAGE_SIZE=100;
function pinPagination(value:Json|undefined,total:number):PinPagination{return {page:Number(value?.page)||1,pageSize:Number(value?.pageSize)||PIN_PAGE_SIZE,total:Number(value?.total??total),totalPages:Math.max(1,Number(value?.totalPages)||1)}}
function canSchedulePin(pin:Json){return ['DRAFT','PAUSED','FAILED'].includes(pin.status)&&!pin.pinterestPinId&&!pin.publishedAt}
function tomorrowLondonDate(){
  const parts=new Intl.DateTimeFormat('en-GB',{timeZone:'Europe/London',year:'numeric',month:'2-digit',day:'2-digit'}).formatToParts(new Date());
  const part=(type:string)=>Number(parts.find(value=>value.type===type)!.value);
  return new Date(Date.UTC(part('year'),part('month')-1,part('day')+1)).toISOString().slice(0,10);
}
async function api(path: string, init?: RequestInit) { const response = await fetch(path, { ...init, headers: { 'Content-Type':'application/json', ...init?.headers } }); const body = await response.json(); if (!response.ok) throw new Error(body.error ?? 'Request failed.'); return body; }
function Notice({ value }: { value: string }) { return value ? <p className="rounded-lg border bg-muted p-3 text-sm">{value}</p> : null; }
export function PinterestModule({ mode }: { mode: string }) {
  const [data,setData]=useState<any>(null), [aux,setAux]=useState<any>(null), [message,setMessage]=useState(''), [loading,setLoading]=useState(true);
  const load=useCallback(async()=>{
    setLoading(true);setMessage('');
    try {
      if(mode==='connection')setData((await api('/api/pinterest/connection')).data);
      else if(mode==='boards'){setData((await api('/api/pinterest/boards')).data);setAux((await api('/api/pinterest/boards?suggestions=1')).data)}
      else if(mode==='pins'){
        const result=await api(`/api/pinterest/pins?page=1&pageSize=${PIN_PAGE_SIZE}`);
        setData(result.data);
        const [listings,boards]=await Promise.all([api('/api/pinterest/pins?mode=listings'),api('/api/pinterest/boards')]);
        setAux({listings:listings.data,boards:boards.data,pagination:result.pagination,boardCounts:result.boardCounts});
      }
      else if(mode==='campaigns'){setData((await api('/api/pinterest/campaigns')).data);const [listings,boards]=await Promise.all([api('/api/pinterest/pins?mode=listings'),api('/api/pinterest/boards')]);setAux({listings:listings.data,boards:boards.data})}
      else if(mode==='queue'){const result=await api(`/api/pinterest/pins?page=1&pageSize=${PIN_PAGE_SIZE}`);setData(result.data);setAux({pagination:result.pagination})}
      else if(mode==='analytics')setData(await api('/api/pinterest/analytics'));
      else if(mode==='trends')setData(await api('/api/pinterest/trends?region=GB&type=growing'));
      else {const [connection,boards,pins,campaigns]=await Promise.all([api('/api/pinterest/connection'),api('/api/pinterest/boards'),api(`/api/pinterest/pins?page=1&pageSize=${PIN_PAGE_SIZE}`),api('/api/pinterest/campaigns')]);setData({connection:connection.data,boards:boards.data,pins:pins.data,boardCounts:pins.boardCounts,campaigns:campaigns.data})}
    }catch(e){setMessage(e instanceof Error?e.message:'Unable to load Pinterest data.')}
    finally{setLoading(false)}
  },[mode]);
  useEffect(()=>{void load()},[load]);
  async function act(path:string,init?:RequestInit){try{setMessage('Working…');await api(path,init);setMessage('Done.');await load()}catch(e){setMessage(e instanceof Error?e.message:'Action failed.')}}
  function onPinSaved(updated:Json){setData((current:Json[])=>current.map(pin=>Number(pin.id)===Number(updated.id)?{...pin,...updated}:pin))}
  if(loading)return <Card><CardContent className="p-6">Loading Pinterest…</CardContent></Card>;
  if(mode==='connection')return <><Card><CardHeader><CardTitle>Pinterest connection</CardTitle><CardDescription>OAuth credentials remain encrypted on the server.</CardDescription></CardHeader><CardContent className="space-y-4"><Notice value={message}/>{data?<><p>Connected as <strong>{data.username??data.accountId}</strong> ({data.environment})</p><p className="text-sm text-muted-foreground">Scopes: {(data.scopes??[]).join(', ')}</p><div className="flex gap-2"><Button onClick={()=>act('/api/pinterest/connection',{method:'POST'})}>Test connection</Button><Button variant="outline" asChild><a href="/api/pinterest/connect">Reconnect</a></Button><Button variant="destructive" onClick={()=>act('/api/pinterest/connection',{method:'DELETE'})}>Disconnect</Button></div></>:<Button asChild><a href="/api/pinterest/connect">Connect Pinterest</a></Button>}</CardContent></Card></>;
  if(mode==='boards')return <Boards data={data??[]} suggestions={aux??[]} message={message} act={act}/>;
  if(mode==='pins')return <PinsBoardWorkflow pins={data??[]} listings={aux?.listings??[]} boards={aux?.boards??[]} initialBoardCounts={aux?.boardCounts??[]} paginated={Boolean(aux?.pagination)} message={message} act={act} reload={load} onPinSaved={onPinSaved}/>;
  if(mode==='campaigns')return <CampaignBoardScheduler data={data??[]} boards={aux?.boards??[]} message={message} act={act}/>;
  if(mode==='queue')return <Queue data={data??[]} pagination={aux?.pagination} message={message} act={act}/>;
  if(mode==='analytics')return <JsonPanel title="Pinterest analytics" description={data?.cached?'Showing a cached Pinterest snapshot.':'Latest Pinterest account and top-pin metrics.'} data={data?.data} message={message}/>;
  if(mode==='trends')return <JsonPanel title="Pinterest trends" description={data?.note??`Current keyword trends for ${data?.region??'GB'}.`} data={data?.data} message={message}/>;
  const counts=data?.boardCounts?data.boardCounts.reduce((sum:Json,board:Json)=>({scheduled:sum.scheduled+board.scheduled,published:sum.published+board.published,failed:sum.failed+board.failed}),{scheduled:0,published:0,failed:0}):{scheduled:data?.pins?.filter((x:Json)=>x.status==='SCHEDULED').length??0,published:data?.pins?.filter((x:Json)=>x.status==='PUBLISHED').length??0,failed:data?.pins?.filter((x:Json)=>x.status==='FAILED').length??0};
  return <><div><h1 className="text-3xl font-semibold">Pinterest marketing</h1><p className="text-muted-foreground">Manage organic Pinterest publishing from your existing Etsy listings.</p></div><Notice value={message}/><div className="grid gap-4 md:grid-cols-4">{[['Connection',data?.connection?`@${data.connection.username??'connected'}`:'Not connected'],['Boards',String(data?.boards?.length??0)],['Scheduled',String(counts.scheduled)],['Published',String(counts.published)]].map(([a,b])=><Card key={a}><CardHeader><CardDescription>{a}</CardDescription><CardTitle>{b}</CardTitle></CardHeader></Card>)}</div><Card><CardHeader><CardTitle>Quick start</CardTitle></CardHeader><CardContent className="flex flex-wrap gap-2"><Button asChild><Link href="/pinterest/connection">Connect account</Link></Button><Button variant="outline" asChild><Link href="/pinterest/boards">Sync boards</Link></Button><Button variant="outline" asChild><Link href="/pinterest/pins">Create a pin</Link></Button></CardContent></Card></>;
}
function Boards({data,suggestions,message,act}:{data:Json[];suggestions:Json[];message:string;act:(p:string,i?:RequestInit)=>void}){const [name,setName]=useState(''),[description,setDescription]=useState('');return <Card><CardHeader><CardTitle>Boards</CardTitle><CardDescription>Sync existing boards or create curated boards.</CardDescription></CardHeader><CardContent className="space-y-4"><Notice value={message}/><div className="flex flex-wrap gap-2"><Input value={name} onChange={e=>setName(e.target.value)} placeholder="Board name" className="max-w-xs"/><Input value={description} onChange={e=>setDescription(e.target.value)} placeholder="Description" className="max-w-md"/><Button onClick={()=>act('/api/pinterest/boards',{method:'POST',body:JSON.stringify({name,description})})}>Create</Button><Button variant="outline" onClick={()=>act('/api/pinterest/boards',{method:'POST',body:JSON.stringify({action:'sync'})})}>Sync boards</Button></div><Table><TableHeader><TableRow><TableHead>Name</TableHead><TableHead>Privacy</TableHead><TableHead>Pins</TableHead><TableHead className="text-right">Actions</TableHead></TableRow></TableHeader><TableBody>{data.map(x=>{const localPinCount=Number(x._count?.pins??0);const hasPins=Number(x.pinCount??0)>0||localPinCount>0;const isEmpty=x.pinCount===0&&localPinCount===0;return <TableRow key={x.id}><TableCell>{x.name}</TableCell><TableCell>{x.privacy}</TableCell><TableCell>{x.pinCount??'—'}</TableCell><TableCell><div className="flex justify-end gap-2"><Button type="button" size="icon" variant="outline" disabled={!hasPins} aria-label={`Clear ${x.name}`} title={hasPins?'Clear all Pins from board':'Board is already empty'} onClick={()=>{if(window.confirm(`Remove every Pin from “${x.name}”? This deletes the Pins from Pinterest and cannot be undone.`))void act('/api/pinterest/boards',{method:'POST',body:JSON.stringify({action:'clear',id:x.id})})}}><Eraser className="h-4 w-4" aria-hidden="true"/></Button><Button type="button" size="icon" variant="destructive" disabled={!isEmpty} aria-label={`Delete ${x.name}`} title={isEmpty?'Delete board':'Only empty boards can be deleted'} onClick={()=>{if(window.confirm(`Delete the empty Pinterest board “${x.name}”? This cannot be undone.`))void act(`/api/pinterest/boards?id=${encodeURIComponent(x.id)}`,{method:'DELETE'})}}><Trash2 className="h-4 w-4" aria-hidden="true"/></Button></div></TableCell></TableRow>})}</TableBody></Table><div><h3 className="font-medium">Suggested boards</h3><div className="mt-2 flex flex-wrap gap-2">{suggestions.slice(0,12).map(x=><Button key={x.name} size="sm" variant="outline" onClick={()=>act('/api/pinterest/boards',{method:'POST',body:JSON.stringify(x)})}>+ {x.name}</Button>)}</div></div></CardContent></Card>}
function Pins({pins,listings,boards,message,act}:{pins:Json[];listings:Json[];boards:Json[];message:string;act:(p:string,i?:RequestInit)=>void}){const [listingId,setListing]=useState(''),[boardId,setBoard]=useState(''),[when,setWhen]=useState('');const chosen=listings.find(x=>x.id===Number(listingId));return <Card><CardHeader><CardTitle>Pins</CardTitle><CardDescription>Choose an Etsy listing and Pinterest board. Drafts may lack a URL; publishing may not.</CardDescription></CardHeader><CardContent className="space-y-4"><Notice value={message}/><div className="grid gap-2 md:grid-cols-4"><select className="rounded-md border bg-background px-3" value={listingId} onChange={e=>setListing(e.target.value)}><option value="">Choose listing</option>{listings.map(x=><option key={x.id} value={x.id}>{x.section?`${x.section} — `:''}{x.title}</option>)}</select><select className="rounded-md border bg-background px-3" value={boardId} onChange={e=>setBoard(e.target.value)}><option value="">Choose board</option>{boards.map(x=><option key={x.id} value={x.id}>{x.name}</option>)}</select><Input type="datetime-local" value={when} onChange={e=>setWhen(e.target.value)}/><Button onClick={()=>act('/api/pinterest/pins',{method:'POST',body:JSON.stringify({listingId:Number(listingId),imageId:chosen?.images?.[0]?.id,boardId:Number(boardId),scheduledAt:when||null})})}>{when?'Schedule':'Save draft'}</Button></div><PinTable pins={pins} act={act}/></CardContent></Card>}
function PinTable({pins,act}:{pins:Json[];act:(p:string,i?:RequestInit)=>void}){return <Table><TableHeader><TableRow><TableHead>Listing</TableHead><TableHead>Board</TableHead><TableHead>Status</TableHead><TableHead>Scheduled</TableHead><TableHead>Action</TableHead></TableRow></TableHeader><TableBody>{pins.map(x=><TableRow key={x.id}><TableCell>{x.listing?.title}</TableCell><TableCell>{x.board?.name}</TableCell><TableCell>{x.status}{x.error?<span className="block text-xs text-destructive">{x.error}</span>:null}</TableCell><TableCell>{x.scheduledAt?new Date(x.scheduledAt).toLocaleString():'—'}</TableCell><TableCell>{x.status!=='PUBLISHED'?<Button size="sm" onClick={()=>act('/api/pinterest/pins',{method:'POST',body:JSON.stringify({action:'publish',id:x.id})})}>Publish</Button>:null}</TableCell></TableRow>)}</TableBody></Table>}
function PinsBoardWorkflow({pins,listings,boards,initialBoardCounts,paginated,message,act,reload,onPinSaved}:{pins:Json[];listings:Json[];boards:Json[];initialBoardCounts:Json[];paginated:boolean;message:string;act:(p:string,i?:RequestInit)=>void;reload:()=>Promise<void>;onPinSaved:(pin:Json)=>void}) {
  const [expandedBoards,setExpandedBoards]=useState<Set<number>>(()=>new Set());
  const [boardPages,setBoardPages]=useState<Record<number,BoardPinPage>>({});
  const [boardCounts,setBoardCounts]=useState(initialBoardCounts);
  const [scheduleBoard,setScheduleBoard]=useState<Json|null>(null);
  const [scheduleIds,setScheduleIds]=useState<number[]>([]);
  const [scheduleName,setScheduleName]=useState('');
  const [scheduleStart,setScheduleStart]=useState(tomorrowLondonDate);
  const [scheduleRate,setScheduleRate]=useState('2');
  const [scheduling,setScheduling]=useState(false);
  const [scheduleError,setScheduleError]=useState('');
  const [scheduleNotice,setScheduleNotice]=useState('');
  const [activeBoard,setActiveBoard]=useState<Json|null>(null);
  const [section,setSection]=useState('');
  const [selectedIds,setSelectedIds]=useState<Set<number>>(()=>new Set());
  const [timing,setTiming]=useState<'campaign'|'now'|'later'>('campaign');
  const [when,setWhen]=useState('');
  const [submitting,setSubmitting]=useState(false);
  const [progress,setProgress]=useState('');
  const [dialogError,setDialogError]=useState('');
  const sections=[...new Set(listings.map(listing=>listing.section as string))].sort((a,b)=>a.localeCompare(b,undefined,{sensitivity:'base'}));
  const sectionListings=(section?listings.filter(listing=>listing.section===section):[]).sort((first,second)=>
    first.showSubject&&second.showSubject
      ? first.subject.localeCompare(second.subject,undefined,{sensitivity:'base'})||first.title.localeCompare(second.title,undefined,{sensitivity:'base'})
      : first.title.localeCompare(second.title,undefined,{sensitivity:'base'})
  );
  const showSubject=sectionListings.some(listing=>listing.showSubject);
  const allSelected=sectionListings.length>0&&sectionListings.every(listing=>selectedIds.has(Number(listing.id)));
  const scheduleRateNumber=Number(scheduleRate);
  const canCreateSchedule=Boolean(scheduleBoard&&scheduleIds.length&&scheduleName.trim()&&/^\d{4}-\d{2}-\d{2}$/.test(scheduleStart)&&scheduleStart>=tomorrowLondonDate()&&Number.isInteger(scheduleRateNumber)&&scheduleRateNumber>=1&&scheduleRateNumber<=4);

  async function loadBoardPage(boardId:number,page:number){
    const fallback=pins.filter(pin=>Number(pin.boardId)===boardId);
    if(!paginated){setBoardPages(current=>({...current,[boardId]:{pins:fallback,pagination:pinPagination(undefined,fallback.length),loading:false,error:'',selectedIds:[]}}));return}
    setBoardPages(current=>({...current,[boardId]:{pins:current[boardId]?.pins??[],pagination:current[boardId]?.pagination??pinPagination(undefined,0),loading:true,error:'',selectedIds:[],requestedPage:page}}));
    try{
      const result=await api(`/api/pinterest/pins?boardId=${boardId}&page=${page}&pageSize=${PIN_PAGE_SIZE}`);
      setBoardPages(current=>({...current,[boardId]:{pins:result.data??[],pagination:pinPagination(result.pagination,result.data?.length??0),loading:false,error:'',selectedIds:[]}}));
      if(result.boardCounts)setBoardCounts(result.boardCounts);
    }catch(error){setBoardPages(current=>({...current,[boardId]:{...current[boardId],loading:false,error:error instanceof Error?error.message:'Unable to load this page.'}}))}
  }

  function updateSavedPin(updated:Json){
    setBoardPages(current=>Object.fromEntries(Object.entries(current).map(([id,page])=>[id,{...page,pins:page.pins.map(pin=>Number(pin.id)===Number(updated.id)?{...pin,...updated}:pin)}])));
    onPinSaved(updated);
  }

  function togglePin(boardId:number,pinId:number){
    setBoardPages(current=>{const page=current[boardId];return {...current,[boardId]:{...page,selectedIds:page.selectedIds.includes(pinId)?page.selectedIds.filter(id=>id!==pinId):[...page.selectedIds,pinId]}}});
  }

  function togglePagePins(boardId:number){
    setBoardPages(current=>{const page=current[boardId];const eligible=page.pins.filter(canSchedulePin).map(pin=>Number(pin.id));return {...current,[boardId]:{...page,selectedIds:eligible.every(id=>page.selectedIds.includes(id))?[]:eligible}}});
  }

  function openSchedule(board:Json){
    const page=boardPages[Number(board.id)];
    const ids=page.pins.filter(pin=>canSchedulePin(pin)&&page.selectedIds.includes(Number(pin.id))).map(pin=>Number(pin.id));
    if(!ids.length)return;
    const start=tomorrowLondonDate();
    setScheduleBoard(board);setScheduleIds(ids);setScheduleName(`${board.name} — ${start}`);setScheduleStart(start);setScheduleRate('2');setScheduleError('');
  }

  async function scheduleSelectedPins(){
    if(!canCreateSchedule||!scheduleBoard||scheduling)return;
    setScheduling(true);setScheduleError('');
    try{
      const result=await api('/api/pinterest/campaigns',{method:'POST',body:JSON.stringify({action:'schedule-selected',name:scheduleName.trim(),boardId:Number(scheduleBoard.id),pinIds:scheduleIds,startDate:scheduleStart,pinsPerDay:scheduleRateNumber,timeZone:'Europe/London'})});
      const scheduledCount=result.data?.scheduledCount??scheduleIds.length;
      setScheduleNotice(`Scheduled ${scheduledCount} ${scheduledCount===1?'Pin':'Pins'} from ${scheduleStart} (Europe/London).`);
      setScheduleBoard(null);
      await loadBoardPage(Number(scheduleBoard.id),boardPages[Number(scheduleBoard.id)]?.pagination.page??1);
    }catch(error){setScheduleError(error instanceof Error?error.message:'Unable to schedule the selected Pins.')}
    finally{setScheduling(false)}
  }

  function openAdd(board:Json) {
    setActiveBoard(board);
    setSection('');
    setSelectedIds(new Set());
    setTiming('campaign');
    setWhen('');
    setProgress('');
    setDialogError('');
  }

  function toggleBoard(boardId:number) {
    if(!expandedBoards.has(boardId)&&!boardPages[boardId])void loadBoardPage(boardId,1);
    setExpandedBoards(current=>{const next=new Set(current);if(next.has(boardId))next.delete(boardId);else next.add(boardId);return next});
  }

  function toggleListing(listingId:number) {
    setSelectedIds(current=>{const next=new Set(current);if(next.has(listingId))next.delete(listingId);else next.add(listingId);return next});
  }

  function toggleAll() {
    setSelectedIds(current=>{
      const next=new Set(current);
      if(allSelected)sectionListings.forEach(listing=>next.delete(Number(listing.id)));
      else sectionListings.forEach(listing=>next.add(Number(listing.id)));
      return next;
    });
  }

  async function submitSelected() {
    if(!activeBoard||selectedIds.size===0||(timing==='later'&&!when))return;
    const selected=listings.filter(listing=>selectedIds.has(Number(listing.id)));
    setSubmitting(true);
    setDialogError('');
    try {
      for(let index=0;index<selected.length;index+=1) {
        const listing=selected[index];
        setProgress(`Generating description ${index+1} of ${selected.length}: ${listing.title}`);
        await api('/api/pinterest/pins',{method:'POST',body:JSON.stringify({listingId:Number(listing.id),imageId:listing.images?.[0]?.id,boardId:Number(activeBoard.id),publishNow:timing==='now',saveDraft:timing==='campaign',scheduledAt:timing==='later'?when:null})});
      }
      setActiveBoard(null);
      await reload();
    } catch(error) {
      setDialogError(error instanceof Error?error.message:'Unable to create Pins.');
    } finally {
      setSubmitting(false);
      setProgress('');
    }
  }

  return <div className="grid gap-4">
    <div><h1 className="text-2xl font-semibold">Pinterest Pins</h1><p className="mt-1 text-muted-foreground">Manage publishing by Pinterest board.</p></div>
    <Notice value={message}/>
    {scheduleNotice?<p role="status" className="rounded-lg border bg-muted p-3 text-sm">{scheduleNotice}</p>:null}
    {boards.length===0?<Card><CardContent className="p-6 text-muted-foreground">No Pinterest boards found. Sync or create a board first.</CardContent></Card>:boards.map(board=>{
      const boardId=Number(board.id);
      const page=boardPages[boardId];
      const boardPins=page?.pins??pins.filter(pin=>Number(pin.boardId)===boardId);
      const counts=boardCounts.find(count=>Number(count.boardId)===boardId);
      const total=counts?.total??boardPins.length;
      const draftCount=counts?.draft??boardPins.filter(pin=>pin.status==='DRAFT').length;
      const pausedCount=counts?.paused??boardPins.filter(pin=>pin.status==='PAUSED').length;
      const failedCount=counts?.failed??boardPins.filter(pin=>pin.status==='FAILED').length;
      const publishedCount=counts?.published??boardPins.filter(pin=>pin.status==='PUBLISHED').length;
      const scheduledCount=counts?.scheduled??boardPins.filter(pin=>pin.status==='SCHEDULED').length;
      const expanded=expandedBoards.has(Number(board.id));
      return <Card key={board.id}>
        <CardHeader className="flex flex-row items-center justify-between gap-4">
          <button type="button" className="flex min-w-0 flex-1 items-center gap-2 text-left" aria-expanded={expanded} onClick={()=>toggleBoard(Number(board.id))}>
            {expanded?<ChevronDown className="h-5 w-5 shrink-0" aria-hidden="true"/>:<ChevronRight className="h-5 w-5 shrink-0" aria-hidden="true"/>}
            <CardTitle>{board.name}</CardTitle>
            <span className="text-sm font-normal text-muted-foreground">{total} total · {draftCount} drafts · {pausedCount} paused · {failedCount} failed · {publishedCount} published · {scheduledCount} scheduled</span>
          </button>
          <div className="flex items-center gap-2">
            <Button type="button" size="icon" variant="destructive" aria-label={`Delete ${board.name}`} title={total?'Delete all Pins from this board before deleting the board':'Delete board'} disabled={total>0} onClick={()=>{if(window.confirm(`Delete the Pinterest board ${board.name}?`))void act(`/api/pinterest/boards?id=${encodeURIComponent(board.id)}`,{method:'DELETE'})}}><Trash2 className="h-4 w-4" aria-hidden="true"/></Button>
            <Button type="button" onClick={()=>openAdd(board)}><Plus className="h-4 w-4" aria-hidden="true"/>Add</Button>
          </div>
        </CardHeader>
        {expanded?<CardContent className="space-y-4">
          {page?.error?<p role="alert" className="text-sm text-destructive">{page.error} <button type="button" className="underline" onClick={()=>void loadBoardPage(boardId,page.requestedPage??page.pagination.page)}>Retry</button></p>:null}
          {page?.loading?<p className="text-sm text-muted-foreground">Loading Pins…</p>:<>
            {boardPins.length&&page?<>
              <div className="flex flex-wrap items-center justify-between gap-3">
                <p className="text-sm text-muted-foreground">{page.selectedIds.length} selected on this page. Selection clears when changing pages.</p>
                <Button type="button" variant="outline" disabled={!page.selectedIds.length} onClick={()=>openSchedule(board)}>Schedule selected ({page.selectedIds.length})</Button>
              </div>
              <PinWorkflowTable pins={boardPins} act={act} onPinSaved={updateSavedPin} selection={{selectedIds:page.selectedIds,onToggle:id=>togglePin(boardId,id),onTogglePage:()=>togglePagePins(boardId)}}/>
            </>:!page?.error?<p className="text-sm text-muted-foreground">No Pins have been added to this board.</p>:null}
          </>}
          {page?<PinPageControls pagination={page.pagination} label={board.name} loading={page.loading} onPage={next=>void loadBoardPage(boardId,next)}/>:null}
        </CardContent>:null}
      </Card>;
    })}

    <Dialog open={activeBoard!==null} onOpenChange={open=>{if(!open&&!submitting)setActiveBoard(null)}}>
      <DialogContent className="max-w-5xl">
        <DialogHeader><DialogTitle>Add Pins to {activeBoard?.name}</DialogTitle></DialogHeader>
        <div className="grid gap-4">
          {dialogError?<p className="rounded-md border border-destructive/30 bg-destructive/10 p-3 text-sm text-destructive">{dialogError}</p>:null}
          <label className="grid max-w-md gap-2 text-sm font-medium">Section<select className="h-10 rounded-md border bg-background px-3 font-normal" value={section} disabled={submitting} onChange={event=>{setSection(event.target.value);setSelectedIds(new Set());setDialogError('')}}><option value="">Choose section</option>{sections.map(value=><option key={value} value={value}>{value}</option>)}</select></label>
          {section?<div className="max-h-[24rem] overflow-auto rounded-md border"><Table><TableHeader><TableRow><TableHead className="w-12"><input type="checkbox" aria-label="Select or clear all listings" checked={allSelected} onChange={toggleAll} disabled={submitting||sectionListings.length===0}/></TableHead>{showSubject?<TableHead>Subject</TableHead>:null}<TableHead>Listing</TableHead></TableRow></TableHeader><TableBody>{sectionListings.map(listing=><TableRow key={listing.id}><TableCell><input type="checkbox" aria-label={`Select ${listing.title}`} checked={selectedIds.has(Number(listing.id))} onChange={()=>toggleListing(Number(listing.id))} disabled={submitting}/></TableCell>{showSubject?<TableCell className="font-medium">{listing.subject}</TableCell>:null}<TableCell>{listing.title}</TableCell></TableRow>)}</TableBody></Table></div>:null}
          {section&&sectionListings.length===0?<p className="text-sm text-muted-foreground">Every listing in this section is already published or selected for publishing.</p>:null}
          <div className="grid gap-3 sm:grid-cols-2">
            <label className="grid gap-2 text-sm font-medium">Publishing<select className="h-10 rounded-md border bg-background px-3 font-normal" value={timing} disabled={submitting} onChange={event=>setTiming(event.target.value as 'campaign'|'now'|'later')}><option value="campaign">Add to board for campaign</option><option value="now">Publish now</option><option value="later">Publish later</option></select></label>
            {timing==='later'?<label className="grid gap-2 text-sm font-medium">Scheduled time<Input type="datetime-local" value={when} disabled={submitting} onChange={event=>setWhen(event.target.value)}/></label>:null}
          </div>
          {progress?<p className="text-sm text-muted-foreground">{progress}</p>:null}
        </div>
        <DialogFooter><Button type="button" variant="outline" disabled={submitting} onClick={()=>setActiveBoard(null)}>Cancel</Button><Button type="button" disabled={submitting||selectedIds.size===0||(timing==='later'&&!when)} onClick={submitSelected}>{submitting?'Working…':timing==='campaign'?`Add ${selectedIds.size||''}`:timing==='now'?`Publish ${selectedIds.size||''}`:`Schedule ${selectedIds.size||''}`}</Button></DialogFooter>
      </DialogContent>
    </Dialog>
    <Dialog open={scheduleBoard!==null} onOpenChange={open=>{if(!open&&!scheduling)setScheduleBoard(null)}}>
      <DialogContent>
        <DialogHeader><DialogTitle>Schedule selected Pins</DialogTitle><DialogDescription>{scheduleIds.length} selected {scheduleIds.length===1?'Pin':'Pins'} from {scheduleBoard?.name}. Dates and publishing times use Europe/London.</DialogDescription></DialogHeader>
        <div className="grid gap-4">
          {scheduleError?<p role="alert" className="text-sm text-destructive">{scheduleError}</p>:null}
          <label className="grid gap-2 text-sm font-medium">Campaign name<Input value={scheduleName} disabled={scheduling} onChange={event=>setScheduleName(event.target.value)}/></label>
          <label className="grid gap-2 text-sm font-medium">Start date<Input type="date" min={tomorrowLondonDate()} value={scheduleStart} disabled={scheduling} onChange={event=>setScheduleStart(event.target.value)}/></label>
          <label className="grid gap-2 text-sm font-medium">Pins per day<Input type="number" min="1" max="4" value={scheduleRate} disabled={scheduling} onChange={event=>setScheduleRate(event.target.value)}/></label>
          <p className="text-sm text-muted-foreground">Only the selected unpublished draft, paused or failed Pins will be scheduled.</p>
        </div>
        <DialogFooter><Button type="button" variant="outline" disabled={scheduling} onClick={()=>setScheduleBoard(null)}>Cancel</Button><Button type="button" disabled={!canCreateSchedule||scheduling} onClick={scheduleSelectedPins}>{scheduling?'Scheduling…':`Schedule ${scheduleIds.length} ${scheduleIds.length===1?'Pin':'Pins'}`}</Button></DialogFooter>
      </DialogContent>
    </Dialog>
  </div>;
}

function PinsWorkflow({pins,listings,boards,message,act}:{pins:Json[];listings:Json[];boards:Json[];message:string;act:(p:string,i?:RequestInit)=>void}) {
  const [section,setSection]=useState('');
  const [listingId,setListing]=useState('');
  const [boardId,setBoard]=useState('');
  const [timing,setTiming]=useState<'now'|'later'>('now');
  const [when,setWhen]=useState('');
  const [creating,setCreating]=useState(false);
  const [progress,setProgress]=useState('');
  const sections=[...new Set(listings.map(x=>x.section as string))].sort((a,b)=>a.localeCompare(b,undefined,{sensitivity:'base'}));
  const filteredListings=section?listings.filter(x=>x.section===section):[];
  const canCreate=Boolean(listingId&&boardId&&(timing==='now'||when));

  async function createSelectedPins() {
    if (!canCreate) return;
    const selectedListings=listingId==='all'?filteredListings:filteredListings.filter(listing=>listing.id===Number(listingId));
    setCreating(true);
    try {
      for(let index=0;index<selectedListings.length;index+=1) {
        const listing=selectedListings[index];
        setProgress(`${index+1} of ${selectedListings.length}: ${listing.title}`);
        await act('/api/pinterest/pins',{method:'POST',body:JSON.stringify({listingId:Number(listing.id),imageId:listing.images?.[0]?.id,boardId:Number(boardId),publishNow:timing==='now',scheduledAt:timing==='later'?when:null})});
      }
    } finally {
      setCreating(false);
      setProgress('');
    }
  }
  return <Card><CardHeader><CardTitle>Pins</CardTitle><CardDescription>Choose a section, listing, and board, then publish now or schedule the Pin for later.</CardDescription></CardHeader><CardContent className="space-y-4"><Notice value={message}/><div className="grid gap-2 md:grid-cols-3 lg:grid-cols-6">
    <select className="h-10 rounded-md border bg-background px-3" value={section} onChange={event=>{setSection(event.target.value);setListing('')}}><option value="">Choose section</option>{sections.map(value=><option key={value} value={value}>{value}</option>)}</select>
    <select className="h-10 rounded-md border bg-background px-3" value={listingId} onChange={event=>setListing(event.target.value)} disabled={!section||creating}><option value="">Choose listing</option>{filteredListings.length>0?<option value="all">All listings in this section ({filteredListings.length})</option>:null}{filteredListings.map(listing=><option key={listing.id} value={listing.id}>{listing.title}</option>)}</select>
    <select className="h-10 rounded-md border bg-background px-3" value={boardId} onChange={event=>setBoard(event.target.value)}><option value="">Choose board</option>{boards.map(board=><option key={board.id} value={board.id}>{board.name}</option>)}</select>
    <select className="h-10 rounded-md border bg-background px-3" value={timing} onChange={event=>setTiming(event.target.value as 'now'|'later')}><option value="now">Publish now</option><option value="later">Publish later</option></select>
    {timing==='later'?<Input type="datetime-local" value={when} onChange={event=>setWhen(event.target.value)}/>:<span className="hidden lg:block" aria-hidden="true"/>}
    <Button disabled={!canCreate||creating} onClick={createSelectedPins}>{creating?'Creating…':timing==='now'?'Publish now':'Schedule'}</Button>
  </div>{progress?<p className="text-sm text-muted-foreground">{progress}</p>:null}<PinWorkflowTable pins={pins} act={act}/></CardContent></Card>;
}

function PinWorkflowTable({pins,act,onPinSaved,selection}:{pins:Json[];act:(p:string,i?:RequestInit)=>void;onPinSaved?:(pin:Json)=>void;selection?:{selectedIds:number[];onToggle:(id:number)=>void;onTogglePage:()=>void}}) {
  const [reviewPin,setReviewPin]=useState<Json|null>(null);
  const [description,setDescription]=useState('');
  const [savedDescription,setSavedDescription]=useState<string|null>(null);
  const [descriptionAction,setDescriptionAction]=useState<'saving'|'regenerating'|null>(null);
  const [reviewError,setReviewError]=useState('');
  const [reviewMessage,setReviewMessage]=useState('');
  const pinTitle=(pin:Json)=>pin.title?.trim()||pin.listing?.title||'Untitled Pin';
  const published=Boolean(reviewPin?.pinterestPinId)||reviewPin?.status==='PUBLISHED';
  const canEditDescription=Boolean(reviewPin&&!published&&['DRAFT','PAUSED','FAILED'].includes(reviewPin.status));
  const descriptionChanged=description!==(savedDescription??'');
  const descriptionLength=pinDescriptionLength(description);
  let descriptionValidation='';
  try{validatePinDescription(description)}catch(error){descriptionValidation=error instanceof Error?error.message:'Enter a valid description.'}
  if(descriptionLength>PINTEREST_DESCRIPTION_MAX_LENGTH)descriptionValidation=`Description must be ${PINTEREST_DESCRIPTION_MAX_LENGTH} characters or fewer.`;
  const busy=descriptionAction!==null;
  const eligiblePins=pins.filter(canSchedulePin);

  function openReview(pin:Json){
    setReviewPin(pin);
    setDescription(pin.description??'');
    setSavedDescription(pin.description??null);
    setReviewError('');
    setReviewMessage('');
  }

  async function regenerateDescription(){
    if(!reviewPin||!canEditDescription||busy)return;
    setDescriptionAction('regenerating');
    setReviewError('');
    setReviewMessage('');
    try{
      const result=await api('/api/pinterest/pins',{method:'POST',body:JSON.stringify({action:'regenerate-description',id:reviewPin.id})});
      if(typeof result.data?.description!=='string')throw new Error('A regenerated description was not returned.');
      setDescription(result.data.description);
      setReviewMessage('Description regenerated. Review it, then save to keep the change.');
    }catch(error){setReviewError(error instanceof Error?error.message:'Unable to regenerate the description.')}
    finally{setDescriptionAction(null)}
  }

  async function saveDescription(){
    if(!reviewPin||!canEditDescription||!descriptionChanged||descriptionValidation||busy)return;
    setDescriptionAction('saving');
    setReviewError('');
    setReviewMessage('');
    try{
      const result=await api('/api/pinterest/pins',{method:'PATCH',body:JSON.stringify({id:reviewPin.id,description:validatePinDescription(description),expectedDescription:savedDescription})});
      if(typeof result.data?.description!=='string')throw new Error('The saved description was not returned.');
      const updated={...reviewPin,...result.data};
      setReviewPin(updated);
      setDescription(updated.description);
      setSavedDescription(updated.description);
      onPinSaved?.(updated);
      setReviewMessage('Description saved.');
    }catch(error){setReviewError(error instanceof Error?error.message:'Unable to save the description.')}
    finally{setDescriptionAction(null)}
  }
  return <>
    <Table>
      <TableHeader><TableRow>{selection?<TableHead className="w-12"><input type="checkbox" aria-label="Select eligible Pins on this page" disabled={!eligiblePins.length} checked={eligiblePins.length>0&&eligiblePins.every(pin=>selection.selectedIds.includes(Number(pin.id)))} onChange={selection.onTogglePage}/></TableHead>:null}<TableHead>Pin</TableHead><TableHead>Board</TableHead><TableHead>Status</TableHead><TableHead>Scheduled</TableHead><TableHead className="text-right">Actions</TableHead></TableRow></TableHeader>
      <TableBody>{pins.map(pin=><TableRow key={pin.id}>
        {selection?<TableCell><input type="checkbox" aria-label={`Select ${pinTitle(pin)}`} disabled={!canSchedulePin(pin)} checked={selection.selectedIds.includes(Number(pin.id))} onChange={()=>selection.onToggle(Number(pin.id))}/></TableCell>:null}
        <TableCell>
          <div className="flex min-w-64 items-center gap-3">
            {pin.previewUrl?<img src={pin.previewUrl} alt={pinTitle(pin)} loading="lazy" className="h-24 w-16 shrink-0 rounded border bg-muted object-contain"/>:<div className="flex h-24 w-16 shrink-0 items-center justify-center rounded border bg-muted p-1 text-center text-xs text-muted-foreground">No preview</div>}
            <div><p className="font-medium">{pinTitle(pin)}</p><p className="mt-1 text-xs text-muted-foreground">{pin.listing?.title??'Source listing unavailable'}</p></div>
          </div>
        </TableCell>
        <TableCell>{pin.board?.name}</TableCell>
        <TableCell>{pin.status}{pin.error?<span className="block text-xs text-destructive">{pin.error}</span>:null}</TableCell>
        <TableCell>{pin.scheduledAt?new Date(pin.scheduledAt).toLocaleString():'—'}</TableCell>
        <TableCell><div className="flex justify-end gap-2">
          <Button type="button" size="sm" variant="outline" aria-label={`Review ${pinTitle(pin)}`} onClick={()=>openReview(pin)}>Review</Button>
          {pin.status!=='PUBLISHED'?<Button size="sm" onClick={()=>act('/api/pinterest/pins',{method:'POST',body:JSON.stringify({action:'publish',id:pin.id})})}>Publish now</Button>:null}
          <Button size="sm" variant="destructive" onClick={()=>{if(window.confirm(`Delete the Pinterest item for ${pin.listing?.title??'this listing'}?`))void act('/api/pinterest/pins',{method:'DELETE',body:JSON.stringify({id:pin.id})})}}>Delete</Button>
        </div></TableCell>
      </TableRow>)}</TableBody>
    </Table>
    <Dialog open={reviewPin!==null} onOpenChange={open=>{if(!open&&!busy)setReviewPin(null)}}>
      <DialogContent className="max-h-[90vh] max-w-5xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{reviewPin?pinTitle(reviewPin):'Review Pin'}</DialogTitle>
          <DialogDescription>Review the image, description and destination before publishing.</DialogDescription>
        </DialogHeader>
        {reviewPin?<div className="grid gap-6 sm:grid-cols-2">
          <div className="flex items-start justify-center rounded-lg border bg-muted/40 p-2">
            {reviewPin.previewUrl?<img src={reviewPin.previewUrl} alt={pinTitle(reviewPin)} className="max-h-[65vh] w-full object-contain"/>:<p className="p-6 text-sm text-muted-foreground">No image preview is available for this Pin.</p>}
          </div>
          <div className="grid content-start gap-5 text-sm">
            <dl className="grid gap-3">
              <div><dt className="font-medium">Source listing</dt><dd className="mt-1 text-muted-foreground">{reviewPin.listing?.title??'Source listing unavailable'}</dd></div>
              <div><dt className="font-medium">Board</dt><dd className="mt-1 text-muted-foreground">{reviewPin.board?.name??'Unknown board'}</dd></div>
              <div><dt className="font-medium">Status</dt><dd className="mt-1 text-muted-foreground">{reviewPin.status}</dd></div>
            </dl>
            {canEditDescription?<div className="grid gap-2">
              <label htmlFor={`pin-description-${reviewPin.id}`} className="font-medium">Description</label>
              <textarea id={`pin-description-${reviewPin.id}`} value={description} rows={7} disabled={busy} aria-invalid={Boolean(descriptionValidation&&descriptionChanged)} aria-describedby="pin-description-count pin-description-help" className="w-full rounded-md border border-input bg-background p-3 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50" onChange={event=>{setDescription(event.target.value);setReviewError('');setReviewMessage('')}}/>
              <p id="pin-description-count" aria-live="polite" className={`text-right text-xs tabular-nums ${descriptionLength>PINTEREST_DESCRIPTION_MAX_LENGTH?'text-destructive':'text-muted-foreground'}`}>{descriptionLength} / {PINTEREST_DESCRIPTION_MAX_LENGTH}</p>
              <p id="pin-description-help" className="text-xs text-muted-foreground">Saved changes are used when this Pin is published.</p>
              {descriptionValidation&&descriptionChanged?<p className="text-xs text-destructive">{descriptionValidation}</p>:null}
              <div className="flex flex-wrap gap-2">
                <Button type="button" size="sm" variant="outline" disabled={busy} onClick={regenerateDescription}>{descriptionAction==='regenerating'?'Generating description…':'Regenerate description'}</Button>
                <Button type="button" size="sm" disabled={!descriptionChanged||Boolean(descriptionValidation)||busy} onClick={saveDescription}>{descriptionAction==='saving'?'Saving…':'Save description'}</Button>
              </div>
            </div>:<div>
              <h3 className="font-medium">Description</h3><p className="mt-1 whitespace-pre-wrap text-muted-foreground">{reviewPin.description||'No description supplied.'}</p>
              <p className="mt-2 text-xs text-muted-foreground">{published?'Published Pins are read-only here. This screen does not edit live Pinterest Pins.':reviewPin.status==='SCHEDULED'?'Scheduled Pins are read-only while awaiting publishing.':'This Pin is read-only while publishing is in progress.'}</p>
            </div>}
            {reviewError?<p role="alert" className="text-sm text-destructive">{reviewError}</p>:null}
            {reviewMessage?<p role="status" className="text-sm text-muted-foreground">{reviewMessage}</p>:null}
            <div><h3 className="font-medium">Destination</h3>{reviewPin.destinationUrl?<a href={reviewPin.destinationUrl} target="_blank" rel="noopener noreferrer" className="mt-1 block break-all text-primary underline underline-offset-4">{reviewPin.destinationUrl}</a>:<p className="mt-1 text-muted-foreground">No destination supplied.</p>}</div>
          </div>
        </div>:null}
        <DialogFooter><Button type="button" variant="outline" disabled={busy} onClick={()=>setReviewPin(null)}>Close review</Button></DialogFooter>
      </DialogContent>
    </Dialog>
  </>;
}

function PinPageControls({pagination,label,loading,onPage}:{pagination:PinPagination;label:string;loading:boolean;onPage:(page:number)=>void}){
  return <div className="flex flex-wrap items-center justify-between gap-3 border-t pt-3 text-sm">
    <p className="text-muted-foreground">Page {pagination.page} of {pagination.totalPages} · {pagination.total} Pins</p>
    <div className="flex gap-2">
      <Button type="button" size="sm" variant="outline" disabled={loading||pagination.page<=1} aria-label={`Previous page for ${label}`} onClick={()=>onPage(pagination.page-1)}>Previous</Button>
      <Button type="button" size="sm" variant="outline" disabled={loading||pagination.page>=pagination.totalPages} aria-label={`Next page for ${label}`} onClick={()=>onPage(pagination.page+1)}>Next</Button>
    </div>
  </div>;
}

function CampaignBoardScheduler({data,boards,message,act}:{data:Json[];boards:Json[];message:string;act:(p:string,i?:RequestInit)=>void}) {
  const [name,setName]=useState('');
  const [boardId,setBoardId]=useState('');
  const [date,setDate]=useState(new Date().toISOString().slice(0,10));
  const [pinsPerDay,setPinsPerDay]=useState('2');
  const canCreate=Boolean(name.trim()&&boardId&&date&&Number(pinsPerDay)>=1);
  return <Card><CardHeader><CardTitle>Campaigns</CardTitle><CardDescription>Schedule unscheduled Pins that have already been added to a Pinterest board.</CardDescription></CardHeader><CardContent className="space-y-4"><Notice value={message}/><div className="grid gap-2 md:grid-cols-5">
    <Input placeholder="Campaign name" value={name} onChange={event=>setName(event.target.value)}/>
    <select className="h-10 rounded-md border bg-background px-3" value={boardId} onChange={event=>setBoardId(event.target.value)}><option value="">Choose Pinterest board</option>{boards.map(board=><option key={board.id} value={board.id}>{board.name}</option>)}</select>
    <Input type="date" value={date} onChange={event=>setDate(event.target.value)}/>
    <Input type="number" min="1" max="4" value={pinsPerDay} onChange={event=>setPinsPerDay(event.target.value)} placeholder="Pins per day"/>
    <Button disabled={!canCreate} onClick={()=>act('/api/pinterest/campaigns',{method:'POST',body:JSON.stringify({name,boardId:Number(boardId),startDate:date,pinsPerDay:Number(pinsPerDay)})})}>Create schedule</Button>
  </div><p className="text-sm text-muted-foreground">Only draft Pins added using “Add to board for campaign” are scheduled. Published and already scheduled Pins are excluded.</p>
  <Table><TableHeader><TableRow><TableHead>Name</TableHead><TableHead>Board</TableHead><TableHead>Status</TableHead><TableHead>Pins</TableHead><TableHead className="text-right">Actions</TableHead></TableRow></TableHeader><TableBody>{data.length?data.map(campaign=><TableRow key={campaign.id}><TableCell>{campaign.name}</TableCell><TableCell>{campaign.board?.name??'Unknown board'}</TableCell><TableCell>{campaign.status}</TableCell><TableCell>{campaign._count?.pins??0}</TableCell><TableCell className="text-right"><Button type="button" size="icon" variant="destructive" aria-label={`Delete ${campaign.name}`} title="Delete campaign" onClick={()=>{if(window.confirm(`Delete the campaign “${campaign.name}”? Its unpublished scheduled Pins will be returned to drafts.`))void act('/api/pinterest/campaigns',{method:'DELETE',body:JSON.stringify({id:campaign.id})})}}><Trash2 className="h-4 w-4" aria-hidden="true"/></Button></TableCell></TableRow>):<TableRow><TableCell colSpan={5} className="text-center text-muted-foreground">No campaigns created.</TableCell></TableRow>}</TableBody></Table></CardContent></Card>;
}

function Campaigns({data,aux,message,act}:{data:Json[];aux:Json;message:string;act:(p:string,i?:RequestInit)=>void}){const sections=Array.from(new Map((aux?.listings??[]).filter((x:Json)=>x.section).map((x:Json)=>[x.section,x])).values()) as Json[];const [name,setName]=useState(''),[sectionId,setSection]=useState(''),[board,setBoard]=useState(''),[date,setDate]=useState(new Date().toISOString().slice(0,10));return <Card><CardHeader><CardTitle>Campaigns</CardTitle><CardDescription>Create a deterministic schedule across a source category.</CardDescription></CardHeader><CardContent className="space-y-4"><Notice value={message}/><div className="grid gap-2 md:grid-cols-5"><Input placeholder="Campaign name" value={name} onChange={e=>setName(e.target.value)}/><select className="rounded-md border bg-background px-3" value={sectionId} onChange={e=>setSection(e.target.value)}><option>Source category</option>{sections.map(x=><option key={x.section} value={x.id}>{x.section}</option>)}</select><select className="rounded-md border bg-background px-3" value={board} onChange={e=>setBoard(e.target.value)}><option>Board</option>{(aux?.boards??[]).map((x:Json)=><option key={x.id} value={x.id}>{x.name}</option>)}</select><Input type="date" value={date} onChange={e=>setDate(e.target.value)}/><Button onClick={()=>act('/api/pinterest/campaigns',{method:'POST',body:JSON.stringify({name,sourceSectionId:Number(sectionId),boardId:Number(board),startDate:date,pinsPerDay:2})})}>Create schedule</Button></div><Table><TableHeader><TableRow><TableHead>Name</TableHead><TableHead>Category</TableHead><TableHead>Status</TableHead><TableHead>Pins</TableHead></TableRow></TableHeader><TableBody>{data.map(x=><TableRow key={x.id}><TableCell>{x.name}</TableCell><TableCell>{x.sourceSection?.title}</TableCell><TableCell>{x.status}</TableCell><TableCell>{x._count?.pins}</TableCell></TableRow>)}</TableBody></Table></CardContent></Card>}
function Queue({data,pagination,message,act}:{data:Json[];pagination?:Json;message:string;act:(p:string,i?:RequestInit)=>void}){
  const [pins,setPins]=useState(data),[page,setPage]=useState(()=>pinPagination(pagination,data.length)),[loading,setLoading]=useState(false),[error,setError]=useState('');
  async function loadPage(next:number){setLoading(true);setError('');try{const result=await api(`/api/pinterest/pins?page=${next}&pageSize=${PIN_PAGE_SIZE}`);setPins(result.data??[]);setPage(pinPagination(result.pagination,result.data?.length??0))}catch(caught){setError(caught instanceof Error?caught.message:'Unable to load this page.')}finally{setLoading(false)}}
  return <Card><CardHeader><CardTitle>Publishing queue</CardTitle><CardDescription>Scheduled, failed, and recently published Pins.</CardDescription></CardHeader><CardContent className="space-y-4"><Notice value={message}/>{error?<p role="alert" className="text-sm text-destructive">{error}</p>:null}{loading?<p className="text-sm text-muted-foreground">Loading Pins…</p>:<PinTable pins={pins} act={act}/>}<PinPageControls pagination={page} label="publishing queue" loading={loading} onPage={next=>void loadPage(next)}/></CardContent></Card>;
}
function JsonPanel({title,description,data,message}:{title:string;description:string;data:any;message:string}){return <Card><CardHeader><CardTitle>{title}</CardTitle><CardDescription>{description}</CardDescription></CardHeader><CardContent><Notice value={message}/>{data?<pre className="max-h-[38rem] overflow-auto whitespace-pre-wrap rounded-lg bg-muted p-4 text-xs">{JSON.stringify(data,null,2)}</pre>:<p className="text-muted-foreground">No data is available yet.</p>}</CardContent></Card>}
