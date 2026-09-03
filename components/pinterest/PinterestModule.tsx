'use client';
import { useCallback, useEffect, useState } from 'react'; import Link from 'next/link'; import { Button } from '@/components/ui/button'; import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'; import { Input } from '@/components/ui/input'; import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { ChevronDown, ChevronRight, Eraser, Plus, Trash2 } from 'lucide-react';
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
type Json = Record<string, any>;
async function api(path: string, init?: RequestInit) { const response = await fetch(path, { ...init, headers: { 'Content-Type':'application/json', ...init?.headers } }); const body = await response.json(); if (!response.ok) throw new Error(body.error ?? 'Request failed.'); return body; }
function Notice({ value }: { value: string }) { return value ? <p className="rounded-lg border bg-muted p-3 text-sm">{value}</p> : null; }
export function PinterestModule({ mode }: { mode: string }) {
  const [data,setData]=useState<any>(null), [aux,setAux]=useState<any>(null), [message,setMessage]=useState(''), [loading,setLoading]=useState(true);
  const load=useCallback(async()=>{setLoading(true);setMessage('');try { if(mode==='connection') setData((await api('/api/pinterest/connection')).data); else if(mode==='boards'){setData((await api('/api/pinterest/boards')).data);setAux((await api('/api/pinterest/boards?suggestions=1')).data);} else if(mode==='pins'){setData((await api('/api/pinterest/pins')).data);setAux({listings:(await api('/api/pinterest/pins?mode=listings')).data,boards:(await api('/api/pinterest/boards')).data});} else if(mode==='campaigns'){setData((await api('/api/pinterest/campaigns')).data);const [listings,boards]=await Promise.all([api('/api/pinterest/pins?mode=listings'),api('/api/pinterest/boards')]);setAux({listings:listings.data,boards:boards.data});} else if(mode==='queue')setData((await api('/api/pinterest/pins')).data); else if(mode==='analytics')setData(await api('/api/pinterest/analytics')); else if(mode==='trends')setData(await api('/api/pinterest/trends?region=GB&type=growing')); else {const [connection,boards,pins,campaigns]=await Promise.all([api('/api/pinterest/connection'),api('/api/pinterest/boards'),api('/api/pinterest/pins'),api('/api/pinterest/campaigns')]);setData({connection:connection.data,boards:boards.data,pins:pins.data,campaigns:campaigns.data});}} catch(e){setMessage(e instanceof Error?e.message:'Unable to load Pinterest data.');}finally{setLoading(false)}},[mode]); useEffect(()=>{void load()},[load]);
  async function act(path:string,init?:RequestInit){try{setMessage('Working…');await api(path,init);setMessage('Done.');await load()}catch(e){setMessage(e instanceof Error?e.message:'Action failed.')}}
  if(loading)return <Card><CardContent className="p-6">Loading Pinterest…</CardContent></Card>;
  if(mode==='connection')return <><Card><CardHeader><CardTitle>Pinterest connection</CardTitle><CardDescription>OAuth credentials remain encrypted on the server.</CardDescription></CardHeader><CardContent className="space-y-4"><Notice value={message}/>{data?<><p>Connected as <strong>{data.username??data.accountId}</strong> ({data.environment})</p><p className="text-sm text-muted-foreground">Scopes: {(data.scopes??[]).join(', ')}</p><div className="flex gap-2"><Button onClick={()=>act('/api/pinterest/connection',{method:'POST'})}>Test connection</Button><Button variant="outline" asChild><a href="/api/pinterest/connect">Reconnect</a></Button><Button variant="destructive" onClick={()=>act('/api/pinterest/connection',{method:'DELETE'})}>Disconnect</Button></div></>:<Button asChild><a href="/api/pinterest/connect">Connect Pinterest</a></Button>}</CardContent></Card></>;
  if(mode==='boards')return <Boards data={data??[]} suggestions={aux??[]} message={message} act={act}/>;
  if(mode==='pins')return <PinsBoardWorkflow pins={data??[]} listings={aux?.listings??[]} boards={aux?.boards??[]} message={message} act={act} reload={load}/>;
  if(mode==='campaigns')return <CampaignBoardScheduler data={data??[]} boards={aux?.boards??[]} message={message} act={act}/>;
  if(mode==='queue')return <Queue data={data??[]} message={message} act={act}/>;
  if(mode==='analytics')return <JsonPanel title="Pinterest analytics" description={data?.cached?'Showing a cached Pinterest snapshot.':'Latest Pinterest account and top-pin metrics.'} data={data?.data} message={message}/>;
  if(mode==='trends')return <JsonPanel title="Pinterest trends" description={data?.note??`Current keyword trends for ${data?.region??'GB'}.`} data={data?.data} message={message}/>;
  const counts={scheduled:data?.pins?.filter((x:Json)=>x.status==='SCHEDULED').length??0,published:data?.pins?.filter((x:Json)=>x.status==='PUBLISHED').length??0,failed:data?.pins?.filter((x:Json)=>x.status==='FAILED').length??0};
  return <><div><h1 className="text-3xl font-semibold">Pinterest marketing</h1><p className="text-muted-foreground">Manage organic Pinterest publishing from your existing Etsy listings.</p></div><Notice value={message}/><div className="grid gap-4 md:grid-cols-4">{[['Connection',data?.connection?`@${data.connection.username??'connected'}`:'Not connected'],['Boards',String(data?.boards?.length??0)],['Scheduled',String(counts.scheduled)],['Published',String(counts.published)]].map(([a,b])=><Card key={a}><CardHeader><CardDescription>{a}</CardDescription><CardTitle>{b}</CardTitle></CardHeader></Card>)}</div><Card><CardHeader><CardTitle>Quick start</CardTitle></CardHeader><CardContent className="flex flex-wrap gap-2"><Button asChild><Link href="/pinterest/connection">Connect account</Link></Button><Button variant="outline" asChild><Link href="/pinterest/boards">Sync boards</Link></Button><Button variant="outline" asChild><Link href="/pinterest/pins">Create a pin</Link></Button></CardContent></Card></>;
}
function Boards({data,suggestions,message,act}:{data:Json[];suggestions:Json[];message:string;act:(p:string,i?:RequestInit)=>void}){const [name,setName]=useState(''),[description,setDescription]=useState('');return <Card><CardHeader><CardTitle>Boards</CardTitle><CardDescription>Sync existing boards or create curated boards.</CardDescription></CardHeader><CardContent className="space-y-4"><Notice value={message}/><div className="flex flex-wrap gap-2"><Input value={name} onChange={e=>setName(e.target.value)} placeholder="Board name" className="max-w-xs"/><Input value={description} onChange={e=>setDescription(e.target.value)} placeholder="Description" className="max-w-md"/><Button onClick={()=>act('/api/pinterest/boards',{method:'POST',body:JSON.stringify({name,description})})}>Create</Button><Button variant="outline" onClick={()=>act('/api/pinterest/boards',{method:'POST',body:JSON.stringify({action:'sync'})})}>Sync boards</Button></div><Table><TableHeader><TableRow><TableHead>Name</TableHead><TableHead>Privacy</TableHead><TableHead>Pins</TableHead><TableHead className="text-right">Actions</TableHead></TableRow></TableHeader><TableBody>{data.map(x=>{const localPinCount=Number(x._count?.pins??0);const hasPins=Number(x.pinCount??0)>0||localPinCount>0;const isEmpty=x.pinCount===0&&localPinCount===0;return <TableRow key={x.id}><TableCell>{x.name}</TableCell><TableCell>{x.privacy}</TableCell><TableCell>{x.pinCount??'—'}</TableCell><TableCell><div className="flex justify-end gap-2"><Button type="button" size="icon" variant="outline" disabled={!hasPins} aria-label={`Clear ${x.name}`} title={hasPins?'Clear all Pins from board':'Board is already empty'} onClick={()=>{if(window.confirm(`Remove every Pin from “${x.name}”? This deletes the Pins from Pinterest and cannot be undone.`))void act('/api/pinterest/boards',{method:'POST',body:JSON.stringify({action:'clear',id:x.id})})}}><Eraser className="h-4 w-4" aria-hidden="true"/></Button><Button type="button" size="icon" variant="destructive" disabled={!isEmpty} aria-label={`Delete ${x.name}`} title={isEmpty?'Delete board':'Only empty boards can be deleted'} onClick={()=>{if(window.confirm(`Delete the empty Pinterest board “${x.name}”? This cannot be undone.`))void act(`/api/pinterest/boards?id=${encodeURIComponent(x.id)}`,{method:'DELETE'})}}><Trash2 className="h-4 w-4" aria-hidden="true"/></Button></div></TableCell></TableRow>})}</TableBody></Table><div><h3 className="font-medium">Suggested boards</h3><div className="mt-2 flex flex-wrap gap-2">{suggestions.slice(0,12).map(x=><Button key={x.name} size="sm" variant="outline" onClick={()=>act('/api/pinterest/boards',{method:'POST',body:JSON.stringify(x)})}>+ {x.name}</Button>)}</div></div></CardContent></Card>}
function Pins({pins,listings,boards,message,act}:{pins:Json[];listings:Json[];boards:Json[];message:string;act:(p:string,i?:RequestInit)=>void}){const [listingId,setListing]=useState(''),[boardId,setBoard]=useState(''),[when,setWhen]=useState('');const chosen=listings.find(x=>x.id===Number(listingId));return <Card><CardHeader><CardTitle>Pins</CardTitle><CardDescription>Choose an Etsy listing and Pinterest board. Drafts may lack a URL; publishing may not.</CardDescription></CardHeader><CardContent className="space-y-4"><Notice value={message}/><div className="grid gap-2 md:grid-cols-4"><select className="rounded-md border bg-background px-3" value={listingId} onChange={e=>setListing(e.target.value)}><option value="">Choose listing</option>{listings.map(x=><option key={x.id} value={x.id}>{x.section?`${x.section} — `:''}{x.title}</option>)}</select><select className="rounded-md border bg-background px-3" value={boardId} onChange={e=>setBoard(e.target.value)}><option value="">Choose board</option>{boards.map(x=><option key={x.id} value={x.id}>{x.name}</option>)}</select><Input type="datetime-local" value={when} onChange={e=>setWhen(e.target.value)}/><Button onClick={()=>act('/api/pinterest/pins',{method:'POST',body:JSON.stringify({listingId:Number(listingId),imageId:chosen?.images?.[0]?.id,boardId:Number(boardId),scheduledAt:when||null})})}>{when?'Schedule':'Save draft'}</Button></div><PinTable pins={pins} act={act}/></CardContent></Card>}
function PinTable({pins,act}:{pins:Json[];act:(p:string,i?:RequestInit)=>void}){return <Table><TableHeader><TableRow><TableHead>Listing</TableHead><TableHead>Board</TableHead><TableHead>Status</TableHead><TableHead>Scheduled</TableHead><TableHead>Action</TableHead></TableRow></TableHeader><TableBody>{pins.map(x=><TableRow key={x.id}><TableCell>{x.listing?.title}</TableCell><TableCell>{x.board?.name}</TableCell><TableCell>{x.status}{x.error?<span className="block text-xs text-destructive">{x.error}</span>:null}</TableCell><TableCell>{x.scheduledAt?new Date(x.scheduledAt).toLocaleString():'—'}</TableCell><TableCell>{x.status!=='PUBLISHED'?<Button size="sm" onClick={()=>act('/api/pinterest/pins',{method:'POST',body:JSON.stringify({action:'publish',id:x.id})})}>Publish</Button>:null}</TableCell></TableRow>)}</TableBody></Table>}
function PinsBoardWorkflow({pins,listings,boards,message,act,reload}:{pins:Json[];listings:Json[];boards:Json[];message:string;act:(p:string,i?:RequestInit)=>void;reload:()=>Promise<void>}) {
  const [expandedBoards,setExpandedBoards]=useState<Set<number>>(()=>new Set());
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
        setProgress(`${index+1} of ${selected.length}: ${listing.title}`);
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
    {boards.length===0?<Card><CardContent className="p-6 text-muted-foreground">No Pinterest boards found. Sync or create a board first.</CardContent></Card>:boards.map(board=>{
      const boardPins=pins.filter(pin=>Number(pin.boardId)===Number(board.id));
      const publishedCount=boardPins.filter(pin=>pin.status==='PUBLISHED').length;
      const scheduledCount=boardPins.filter(pin=>pin.status==='SCHEDULED').length;
      const expanded=expandedBoards.has(Number(board.id));
      return <Card key={board.id}>
        <CardHeader className="flex flex-row items-center justify-between gap-4">
          <button type="button" className="flex min-w-0 flex-1 items-center gap-2 text-left" aria-expanded={expanded} onClick={()=>toggleBoard(Number(board.id))}>
            {expanded?<ChevronDown className="h-5 w-5 shrink-0" aria-hidden="true"/>:<ChevronRight className="h-5 w-5 shrink-0" aria-hidden="true"/>}
            <CardTitle>{board.name}</CardTitle>
            <span className="text-sm font-normal text-muted-foreground">{publishedCount} published · {scheduledCount} scheduled</span>
          </button>
          <div className="flex items-center gap-2">
            <Button type="button" size="icon" variant="destructive" aria-label={`Delete ${board.name}`} title={boardPins.length?'Delete all Pins from this board before deleting the board':'Delete board'} disabled={boardPins.length>0} onClick={()=>{if(window.confirm(`Delete the Pinterest board ${board.name}?`))void act(`/api/pinterest/boards?id=${encodeURIComponent(board.id)}`,{method:'DELETE'})}}><Trash2 className="h-4 w-4" aria-hidden="true"/></Button>
            <Button type="button" onClick={()=>openAdd(board)}><Plus className="h-4 w-4" aria-hidden="true"/>Add</Button>
          </div>
        </CardHeader>
        {expanded?<CardContent>{boardPins.length?<PinWorkflowTable pins={boardPins} act={act}/>:<p className="text-sm text-muted-foreground">No Pins have been added to this board.</p>}</CardContent>:null}
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

function PinWorkflowTable({pins,act}:{pins:Json[];act:(p:string,i?:RequestInit)=>void}) {
  return <Table><TableHeader><TableRow><TableHead>Listing</TableHead><TableHead>Board</TableHead><TableHead>Status</TableHead><TableHead>Scheduled</TableHead><TableHead className="text-right">Actions</TableHead></TableRow></TableHeader><TableBody>{pins.map(pin=><TableRow key={pin.id}><TableCell>{pin.listing?.title}</TableCell><TableCell>{pin.board?.name}</TableCell><TableCell>{pin.status}{pin.error?<span className="block text-xs text-destructive">{pin.error}</span>:null}</TableCell><TableCell>{pin.scheduledAt?new Date(pin.scheduledAt).toLocaleString():'—'}</TableCell><TableCell><div className="flex justify-end gap-2">{pin.status!=='PUBLISHED'?<Button size="sm" onClick={()=>act('/api/pinterest/pins',{method:'POST',body:JSON.stringify({action:'publish',id:pin.id})})}>Publish now</Button>:null}<Button size="sm" variant="destructive" onClick={()=>{if(window.confirm(`Delete the Pinterest item for ${pin.listing?.title??'this listing'}?`))void act('/api/pinterest/pins',{method:'DELETE',body:JSON.stringify({id:pin.id})})}}>Delete</Button></div></TableCell></TableRow>)}</TableBody></Table>;
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
function Queue({data,message,act}:{data:Json[];message:string;act:(p:string,i?:RequestInit)=>void}){return <Card><CardHeader><CardTitle>Publishing queue</CardTitle><CardDescription>Scheduled, failed, and recently published Pins. The worker endpoint requires PINTEREST_CRON_SECRET.</CardDescription></CardHeader><CardContent className="space-y-4"><Notice value={message}/><PinTable pins={data} act={act}/></CardContent></Card>}
function JsonPanel({title,description,data,message}:{title:string;description:string;data:any;message:string}){return <Card><CardHeader><CardTitle>{title}</CardTitle><CardDescription>{description}</CardDescription></CardHeader><CardContent><Notice value={message}/>{data?<pre className="max-h-[38rem] overflow-auto whitespace-pre-wrap rounded-lg bg-muted p-4 text-xs">{JSON.stringify(data,null,2)}</pre>:<p className="text-muted-foreground">No data is available yet.</p>}</CardContent></Card>}
