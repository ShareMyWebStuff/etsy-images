import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import { PinterestModule } from './PinterestModule';

const sourceTitle = 'Baby Elephant Nursery Print';
const board = { id: 1, name: 'Safari Nursery Wall Art' };
const preparedPins = [
  {
    id: 11,
    title: 'Baby Elephant Nursery Room Inspiration',
    description: 'Create a calm safari nursery with this baby elephant print in an oak frame.',
    destinationUrl: 'https://www.etsy.com/listing/4613999149',
  },
  {
    id: 12,
    title: 'Baby Elephant Print Details',
    description: 'See the gentle elephant artwork and choose your unframed or framed print.',
    destinationUrl: 'https://www.etsy.com/listing/4613999149',
  },
  {
    id: 13,
    title: 'Baby Elephant Digital Download',
    description: 'Download the baby elephant artwork to print at home. No physical item is included.',
    destinationUrl: 'https://www.etsy.com/listing/4558974984',
  },
].map((pin) => ({
  ...pin,
  boardId: board.id,
  board,
  listing: { title: sourceTitle },
  status: 'DRAFT',
  scheduledAt: null,
  previewUrl: `/api/pinterest/pins/${pin.id}/image`,
  hasDedicatedCreative: true,
}));

function mockPins(pins: Array<Record<string, unknown>>, handle?: (url: string, init?: RequestInit) => Response | Promise<Response> | undefined) {
  const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
    const handled=handle?.(url,init);
    if(handled)return handled;
    let data: unknown = [];
    if (!init?.method || init.method === 'GET') {
      if (url.startsWith('/api/pinterest/pins')&&!url.includes('mode=listings')) data = pins;
      else if (url === '/api/pinterest/boards') data = [board];
    }
    return new Response(JSON.stringify({ data }), { headers: { 'Content-Type': 'application/json' } });
  });
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

function json(body:unknown,status=200){return new Response(JSON.stringify(body),{status,headers:{'Content-Type':'application/json'}})}
function mockPagedPins(pages:Record<number,Array<Array<Record<string,unknown>>>>,counts:Array<Record<string,number>>,handle?:(url:string,init?:RequestInit)=>Response|Promise<Response>|undefined,boards=[board]){
  const fetchMock=vi.fn(async(url:string,init?:RequestInit)=>{
    const handled=handle?.(url,init);
    if(handled)return handled;
    const parsed=new URL(url,'http://localhost');
    if(parsed.pathname==='/api/pinterest/boards')return json({data:boards});
    if(parsed.searchParams.get('mode')==='listings')return json({data:[]});
    if(parsed.pathname==='/api/pinterest/pins'&&(!init?.method||init.method==='GET')){
      const boardId=Number(parsed.searchParams.get('boardId'));
      const page=Number(parsed.searchParams.get('page'))||1;
      const total=boardId?counts.find(count=>count.boardId===boardId)?.total??0:counts.reduce((sum,count)=>sum+count.total,0);
      const data=boardId?pages[boardId]?.[page-1]??[]:Object.values(pages)[0]?.[0]??[];
      return json({data,pagination:{page,pageSize:100,total,totalPages:Math.max(1,Math.ceil(total/100))},boardCounts:counts});
    }
    return json({data:{}});
  });
  vi.stubGlobal('fetch',fetchMock);
  return fetchMock;
}

afterEach(() => vi.unstubAllGlobals());

describe('Pinterest Pin review', () => {
  it('shows and reviews distinct room, detail and digital drafts with the correct destinations without publishing', async () => {
    const user = userEvent.setup();
    const fetchMock = mockPins(preparedPins);
    render(<PinterestModule mode="pins" />);
    await user.click(await screen.findByRole('button', { name: /^Safari Nursery Wall Art/ }));
    expect(screen.getByText(/3 drafts/)).toBeTruthy();

    for (const pin of preparedPins) {
      const row = screen.getByText(pin.title).closest('tr')!;
      expect(within(row).getByText(sourceTitle)).toBeTruthy();
      expect(within(row).getByRole('img', { name: pin.title }).getAttribute('src')).toBe(pin.previewUrl);

      await user.click(within(row).getByRole('button', { name: `Review ${pin.title}` }));
      const dialog = screen.getByRole('dialog');
      expect(within(dialog).getByRole('heading', { name: pin.title })).toBeTruthy();
      expect((within(dialog).getByRole('textbox', { name: 'Description' }) as HTMLTextAreaElement).value).toBe(pin.description);
      expect(within(dialog).getByText(sourceTitle)).toBeTruthy();
      expect(within(dialog).getByText(board.name)).toBeTruthy();
      expect(within(dialog).getByText('DRAFT')).toBeTruthy();
      expect(within(dialog).getByRole('img', { name: pin.title }).getAttribute('src')).toBe(pin.previewUrl);
      const destination = within(dialog).getByRole('link', { name: pin.destinationUrl });
      expect(destination.getAttribute('href')).toBe(pin.destinationUrl);
      expect(destination.getAttribute('target')).toBe('_blank');
      expect(within(dialog).queryByRole('button', { name: /publish/i })).toBeNull();
      await user.click(within(dialog).getByRole('button', { name: 'Close review' }));
    }

    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect(fetchMock.mock.calls.every(([, init]) => !init?.method || init.method === 'GET')).toBe(true);
  });

  it('reviews older Pins without a preview or Pin title', async () => {
    const user = userEvent.setup();
    const fetchMock = mockPins([{ id: 21, boardId: board.id, board, listing: { title: sourceTitle }, status: 'PUBLISHED' }]);
    render(<PinterestModule mode="pins" />);
    await user.click(await screen.findByRole('button', { name: /^Safari Nursery Wall Art/ }));
    const row = screen.getByRole('button', { name: `Review ${sourceTitle}` }).closest('tr')!;
    expect(within(row).getByText('No preview')).toBeTruthy();
    expect(within(row).queryByRole('button', { name: 'Publish now' })).toBeNull();

    await user.click(within(row).getByRole('button', { name: `Review ${sourceTitle}` }));

    const dialog = screen.getByRole('dialog');
    expect(within(dialog).getByRole('heading', { name: sourceTitle })).toBeTruthy();
    expect(within(dialog).getByText('No image preview is available for this Pin.')).toBeTruthy();
    expect(within(dialog).getByText('No description supplied.')).toBeTruthy();
    expect(within(dialog).getByText('No destination supplied.')).toBeTruthy();
    expect(within(dialog).getByText('PUBLISHED')).toBeTruthy();
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it('retains the explicit publish action for a selected draft', async () => {
    const user = userEvent.setup();
    const fetchMock = mockPins(preparedPins);
    render(<PinterestModule mode="pins" />);
    await user.click(await screen.findByRole('button', { name: /^Safari Nursery Wall Art/ }));
    const row = screen.getByText(preparedPins[1].title).closest('tr')!;

    await user.click(within(row).getByRole('button', { name: 'Publish now' }));

    await waitFor(() => expect(fetchMock).toHaveBeenCalledWith('/api/pinterest/pins', expect.objectContaining({
      method: 'POST', body: JSON.stringify({ action: 'publish', id: 12 }),
    })));
  });

  it('retains confirmation before deleting a selected draft', async () => {
    const user = userEvent.setup();
    const fetchMock = mockPins(preparedPins);
    const confirm = vi.spyOn(window, 'confirm').mockReturnValue(true);
    render(<PinterestModule mode="pins" />);
    await user.click(await screen.findByRole('button', { name: /^Safari Nursery Wall Art/ }));
    const row = screen.getByText(preparedPins[2].title).closest('tr')!;

    await user.click(within(row).getByRole('button', { name: 'Delete' }));

    expect(confirm).toHaveBeenCalledWith(`Delete the Pinterest item for ${sourceTitle}?`);
    await waitFor(() => expect(fetchMock).toHaveBeenCalledWith('/api/pinterest/pins', expect.objectContaining({
      method: 'DELETE', body: JSON.stringify({ id: 13 }),
    })));
  });

  it('counts Unicode characters and prevents empty or overlength saves without truncating text', async () => {
    const user=userEvent.setup();
    const fetchMock=mockPins(preparedPins);
    render(<PinterestModule mode="pins"/>);
    await user.click(await screen.findByRole('button',{name:/^Safari Nursery Wall Art/}));
    await user.click(screen.getByRole('button',{name:`Review ${preparedPins[0].title}`}));
    const dialog=screen.getByRole('dialog');
    const input=within(dialog).getByRole('textbox',{name:'Description'}) as HTMLTextAreaElement;
    const save=within(dialog).getByRole('button',{name:'Save description'});
    expect(save.hasAttribute('disabled')).toBe(true);

    fireEvent.change(input,{target:{value:'🐘'.repeat(500)}});
    expect(within(dialog).getByText('500 / 500')).toBeTruthy();
    expect(save.hasAttribute('disabled')).toBe(false);
    fireEvent.change(input,{target:{value:'🐘'.repeat(501)}});
    expect(input.value).toBe('🐘'.repeat(501));
    expect(within(dialog).getByText('501 / 500')).toBeTruthy();
    expect(save.hasAttribute('disabled')).toBe(true);
    fireEvent.change(input,{target:{value:'   '}});
    expect(save.hasAttribute('disabled')).toBe(true);
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it('saves only the edited description against its original value and keeps the board and review open', async () => {
    const user=userEvent.setup();
    const nextDescription='A gentle elephant print for a calm nursery.';
    const fetchMock=mockPins(preparedPins,(_url,init)=>init?.method==='PATCH'
      ?new Response(JSON.stringify({data:{id:11,description:nextDescription}}),{headers:{'Content-Type':'application/json'}})
      :undefined);
    render(<PinterestModule mode="pins"/>);
    await user.click(await screen.findByRole('button',{name:/^Safari Nursery Wall Art/}));
    await user.click(screen.getByRole('button',{name:`Review ${preparedPins[0].title}`}));
    const input=screen.getByRole('textbox',{name:'Description'}) as HTMLTextAreaElement;
    fireEvent.change(input,{target:{value:`  ${nextDescription}  `}});

    await user.click(screen.getByRole('button',{name:'Save description'}));

    expect(await screen.findByText('Description saved.')).toBeTruthy();
    expect(screen.getByRole('dialog')).toBeTruthy();
    expect(input.value).toBe(nextDescription);
    expect(screen.getByRole('button',{name:'Save description'}).hasAttribute('disabled')).toBe(true);
    expect(fetchMock).toHaveBeenCalledWith('/api/pinterest/pins',expect.objectContaining({
      method:'PATCH',body:JSON.stringify({id:11,description:nextDescription,expectedDescription:preparedPins[0].description}),
    }));
    await user.click(screen.getByRole('button',{name:'Close review'}));
    expect(screen.getByRole('button',{name:/^Safari Nursery Wall Art/}).getAttribute('aria-expanded')).toBe('true');
    await user.click(screen.getByRole('button',{name:`Review ${preparedPins[0].title}`}));
    expect((screen.getByRole('textbox',{name:'Description'}) as HTMLTextAreaElement).value).toBe(nextDescription);
    expect(fetchMock).toHaveBeenCalledTimes(4);
    expect(fetchMock.mock.calls.filter(([,init])=>init?.method==='POST')).toHaveLength(0);
  });

  it('regenerates a candidate without saving or publishing it and keeps unsaved candidates local on close', async () => {
    const user=userEvent.setup();
    const candidate='A fresh elephant nursery description for your wall art.';
    let resolveCandidate!:(response:Response)=>void;
    const pending=new Promise<Response>(resolve=>{resolveCandidate=resolve});
    const fetchMock=mockPins(preparedPins,(_url,init)=>init?.method==='POST'?pending:undefined);
    render(<PinterestModule mode="pins"/>);
    await user.click(await screen.findByRole('button',{name:/^Safari Nursery Wall Art/}));
    await user.click(screen.getByRole('button',{name:`Review ${preparedPins[0].title}`}));
    const input=screen.getByRole('textbox',{name:'Description'}) as HTMLTextAreaElement;
    fireEvent.change(input,{target:{value:'My unsaved wording.'}});

    await user.click(screen.getByRole('button',{name:'Regenerate description'}));

    expect(screen.getByRole('button',{name:'Generating description…'}).hasAttribute('disabled')).toBe(true);
    expect(screen.getByRole('button',{name:'Save description'}).hasAttribute('disabled')).toBe(true);
    expect(input.value).toBe('My unsaved wording.');
    await act(async()=>resolveCandidate(new Response(JSON.stringify({data:{id:11,description:candidate}}),{headers:{'Content-Type':'application/json'}})));
    await waitFor(()=>expect(input.value).toBe(candidate));
    expect(screen.getByRole('button',{name:'Save description'}).hasAttribute('disabled')).toBe(false);
    expect(fetchMock).toHaveBeenCalledWith('/api/pinterest/pins',expect.objectContaining({
      method:'POST',body:JSON.stringify({action:'regenerate-description',id:11}),
    }));
    expect(fetchMock.mock.calls.filter(([,init])=>init?.method==='PATCH')).toHaveLength(0);
    await user.click(screen.getByRole('button',{name:'Close review'}));
    await user.click(screen.getByRole('button',{name:`Review ${preparedPins[0].title}`}));
    expect((screen.getByRole('textbox',{name:'Description'}) as HTMLTextAreaElement).value).toBe(preparedPins[0].description);
    expect(fetchMock).toHaveBeenCalledTimes(4);
  });

  it('preserves unsaved text and shows an inline regeneration failure', async () => {
    const user=userEvent.setup();
    const fetchMock=mockPins(preparedPins,(_url,init)=>init?.method==='POST'
      ?new Response(JSON.stringify({error:'Description generation is temporarily unavailable.'}),{status:503,headers:{'Content-Type':'application/json'}})
      :undefined);
    render(<PinterestModule mode="pins"/>);
    await user.click(await screen.findByRole('button',{name:/^Safari Nursery Wall Art/}));
    await user.click(screen.getByRole('button',{name:`Review ${preparedPins[0].title}`}));
    const input=screen.getByRole('textbox',{name:'Description'}) as HTMLTextAreaElement;
    fireEvent.change(input,{target:{value:'Keep this unsaved wording.'}});

    await user.click(screen.getByRole('button',{name:'Regenerate description'}));

    expect((await screen.findByRole('alert')).textContent).toBe('Description generation is temporarily unavailable.');
    expect(input.value).toBe('Keep this unsaved wording.');
    expect(screen.getByRole('dialog')).toBeTruthy();
    expect(screen.getByRole('button',{name:'Save description'}).hasAttribute('disabled')).toBe(false);
    expect(fetchMock.mock.calls.filter(([,init])=>init?.method==='PATCH')).toHaveLength(0);
  });

  it('preserves the editor when saving detects another edit', async () => {
    const user=userEvent.setup();
    const fetchMock=mockPins(preparedPins,(_url,init)=>init?.method==='PATCH'
      ?new Response(JSON.stringify({error:'The description changed elsewhere. Reopen this Pin and try again.'}),{status:409,headers:{'Content-Type':'application/json'}})
      :undefined);
    render(<PinterestModule mode="pins"/>);
    await user.click(await screen.findByRole('button',{name:/^Safari Nursery Wall Art/}));
    await user.click(screen.getByRole('button',{name:`Review ${preparedPins[0].title}`}));
    const input=screen.getByRole('textbox',{name:'Description'}) as HTMLTextAreaElement;
    fireEvent.change(input,{target:{value:'Keep this edited wording.'}});

    await user.click(screen.getByRole('button',{name:'Save description'}));

    expect((await screen.findByRole('alert')).textContent).toContain('description changed elsewhere');
    expect(input.value).toBe('Keep this edited wording.');
    expect(screen.getByRole('dialog')).toBeTruthy();
    expect(screen.getByRole('button',{name:'Save description'}).hasAttribute('disabled')).toBe(false);
    expect(fetchMock.mock.calls.filter(([,init])=>init?.method==='POST')).toHaveLength(0);
  });

  it.each(['DRAFT','PAUSED','FAILED'])('allows description editing for an unpublished %s Pin',async status=>{
    const user=userEvent.setup();
    mockPins([{...preparedPins[0],status}]);
    render(<PinterestModule mode="pins"/>);
    await user.click(await screen.findByRole('button',{name:/^Safari Nursery Wall Art/}));
    await user.click(screen.getByRole('button',{name:`Review ${preparedPins[0].title}`}));
    expect(screen.getByRole('textbox',{name:'Description'})).toBeTruthy();
    expect(screen.getByRole('button',{name:'Regenerate description'})).toBeTruthy();
  });

  it.each([
    {status:'PUBLISHED',pinterestPinId:'remote-11'},
    {status:'SCHEDULED',pinterestPinId:null},
    {status:'PUBLISHING',pinterestPinId:null},
    {status:'DRAFT',pinterestPinId:'remote-11'},
  ])('keeps $status Pins with remote id $pinterestPinId read-only',async overrides=>{
    const user=userEvent.setup();
    const fetchMock=mockPins([{...preparedPins[0],...overrides}]);
    render(<PinterestModule mode="pins"/>);
    await user.click(await screen.findByRole('button',{name:/^Safari Nursery Wall Art/}));
    await user.click(screen.getByRole('button',{name:`Review ${preparedPins[0].title}`}));
    const dialog=screen.getByRole('dialog');
    expect(within(dialog).queryByRole('textbox',{name:'Description'})).toBeNull();
    expect(within(dialog).queryByRole('button',{name:'Regenerate description'})).toBeNull();
    expect(within(dialog).queryByRole('button',{name:'Save description'})).toBeNull();
    expect(within(dialog).getByText(preparedPins[0].description)).toBeTruthy();
    expect(within(dialog).getByText(/read-only/)).toBeTruthy();
    if(overrides.pinterestPinId)expect(within(dialog).getByText(/does not edit live Pinterest Pins/)).toBeTruthy();
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });
});

describe('Pinterest board pagination and selected scheduling',()=>{
  it('loads beyond 300 rows with global board totals and preserves page four through description saves',async()=>{
    const user=userEvent.setup();
    const otherBoard={id:2,name:'Woodland Nursery Wall Art'};
    const pages=Array.from({length:4},(_,index)=>[{...preparedPins[0],id:101+index,title:`Elephant page ${index+1}`}]);
    const counts=[
      {boardId:1,total:351,draft:300,paused:20,scheduled:25,published:5,failed:1},
      {boardId:2,total:75,draft:75,paused:0,scheduled:0,published:0,failed:0},
    ];
    const fetchMock=mockPagedPins({1:pages,2:[]},counts,(_url,init)=>init?.method==='PATCH'?json({data:{id:104,description:'Saved on page four.'}}):undefined,[board,otherBoard]);
    render(<PinterestModule mode="pins"/>);
    const toggle=await screen.findByRole('button',{name:/^Safari Nursery Wall Art/});
    expect(toggle.textContent).toContain('351 total');
    expect(toggle.textContent).toContain('300 drafts');
    expect(screen.getByRole('button',{name:'Delete Woodland Nursery Wall Art'}).hasAttribute('disabled')).toBe(true);
    await user.click(toggle);
    await screen.findByText('Elephant page 1');
    await user.click(screen.getByRole('checkbox',{name:'Select Elephant page 1'}));
    for(let next=2;next<=4;next++){
      await user.click(screen.getByRole('button',{name:'Next page for Safari Nursery Wall Art'}));
      await screen.findByText(`Elephant page ${next}`);
      expect(screen.getByText('0 selected on this page. Selection clears when changing pages.')).toBeTruthy();
    }
    expect(screen.getByText('Page 4 of 4 · 351 Pins')).toBeTruthy();
    expect(screen.getByRole('button',{name:'Next page for Safari Nursery Wall Art'}).hasAttribute('disabled')).toBe(true);
    expect(fetchMock).toHaveBeenCalledWith('/api/pinterest/pins?boardId=1&page=4&pageSize=100',expect.anything());
    await user.click(screen.getByRole('button',{name:'Review Elephant page 4'}));
    fireEvent.change(screen.getByRole('textbox',{name:'Description'}),{target:{value:'Saved on page four.'}});
    await user.click(screen.getByRole('button',{name:'Save description'}));
    await screen.findByText('Description saved.');
    await user.click(screen.getByRole('button',{name:'Close review'}));
    expect(screen.getByText('Page 4 of 4 · 351 Pins')).toBeTruthy();
    await user.click(screen.getByRole('button',{name:'Review Elephant page 4'}));
    expect((screen.getByRole('textbox',{name:'Description'}) as HTMLTextAreaElement).value).toBe('Saved on page four.');
    expect(fetchMock.mock.calls.filter(([,init])=>init?.method==='POST')).toHaveLength(0);
  });

  it('schedules only eligible selections on the current page starting tomorrow in London',async()=>{
    const user=userEvent.setup();
    const rows=[
      {...preparedPins[0],status:'DRAFT'},
      {...preparedPins[1],status:'PAUSED'},
      {...preparedPins[2],status:'FAILED'},
      {...preparedPins[0],id:14,title:'Already scheduled',status:'SCHEDULED'},
      {...preparedPins[0],id:15,title:'Already published',status:'PUBLISHED',pinterestPinId:'remote-15'},
      {...preparedPins[0],id:16,title:'Has remote Pin',status:'DRAFT',pinterestPinId:'remote-16'},
    ];
    const counts=[{boardId:1,total:101,draft:97,paused:1,scheduled:1,published:1,failed:1}];
    const fetchMock=mockPagedPins({1:[rows,[{...preparedPins[0],id:1001,title:'Not on this page'}]]},counts,(_url,init)=>init?.method==='POST'?json({data:{scheduledCount:3}}):undefined);
    render(<PinterestModule mode="pins"/>);
    await user.click(await screen.findByRole('button',{name:/^Safari Nursery Wall Art/}));
    await screen.findByText('Already scheduled');
    expect(screen.getByRole('checkbox',{name:'Select Already scheduled'}).hasAttribute('disabled')).toBe(true);
    expect(screen.getByRole('checkbox',{name:'Select Already published'}).hasAttribute('disabled')).toBe(true);
    expect(screen.getByRole('checkbox',{name:'Select Has remote Pin'}).hasAttribute('disabled')).toBe(true);
    await user.click(screen.getByRole('checkbox',{name:'Select eligible Pins on this page'}));
    expect(screen.getByText('3 selected on this page. Selection clears when changing pages.')).toBeTruthy();
    await user.click(screen.getByRole('button',{name:'Schedule selected (3)'}));
    const dialog=screen.getByRole('dialog');
    const start=within(dialog).getByLabelText('Start date') as HTMLInputElement;
    const londonToday=new Date().toLocaleDateString('en-CA',{timeZone:'Europe/London'});
    const tomorrow=new Date(`${londonToday}T12:00:00Z`);tomorrow.setUTCDate(tomorrow.getUTCDate()+1);
    expect(start.value).toBe(tomorrow.toISOString().slice(0,10));
    fireEvent.change(within(dialog).getByLabelText('Campaign name'),{target:{value:'Selected launch'}});
    fireEvent.change(within(dialog).getByLabelText('Pins per day'),{target:{value:'1'}});
    await user.click(within(dialog).getByRole('button',{name:'Schedule 3 Pins'}));
    await waitFor(()=>expect(screen.queryByRole('dialog')).toBeNull());
    expect(fetchMock).toHaveBeenCalledWith('/api/pinterest/campaigns',expect.objectContaining({
      method:'POST',body:JSON.stringify({action:'schedule-selected',name:'Selected launch',boardId:1,pinIds:[11,12,13],startDate:start.value,pinsPerDay:1,timeZone:'Europe/London'}),
    }));
    expect(fetchMock.mock.calls.some(([url,init])=>url==='/api/pinterest/pins'&&init?.method==='POST')).toBe(false);
    expect(await screen.findByText(/Scheduled 3 Pins from/)).toBeTruthy();
  });

  it('keeps failed scheduling selections and date inputs for retry',async()=>{
    const user=userEvent.setup();
    const counts=[{boardId:1,total:3,draft:3,paused:0,scheduled:0,published:0,failed:0}];
    const fetchMock=mockPagedPins({1:[preparedPins]},counts,(_url,init)=>init?.method==='POST'?json({error:'A selected Pin changed. Review and retry.'},409):undefined);
    render(<PinterestModule mode="pins"/>);
    await user.click(await screen.findByRole('button',{name:/^Safari Nursery Wall Art/}));
    await screen.findByText(preparedPins[0].title);
    await user.click(screen.getByRole('checkbox',{name:`Select ${preparedPins[0].title}`}));
    await user.click(screen.getByRole('button',{name:'Schedule selected (1)'}));
    await user.click(screen.getByRole('button',{name:'Schedule 1 Pin'}));
    expect((await screen.findByRole('alert')).textContent).toContain('selected Pin changed');
    expect(screen.getByRole('dialog')).toBeTruthy();
    expect((screen.getByLabelText('Start date') as HTMLInputElement).value).toBeTruthy();
    expect(screen.getByRole('button',{name:'Schedule 1 Pin'}).hasAttribute('disabled')).toBe(false);
    expect(fetchMock.mock.calls.filter(([,init])=>init?.method==='POST')).toHaveLength(1);
  });

  it('retries the requested board page after a page load fails',async()=>{
    const user=userEvent.setup();
    let failures=1;
    mockPagedPins({1:[[preparedPins[0]],[preparedPins[1]]]},[{boardId:1,total:101,draft:101,paused:0,scheduled:0,published:0,failed:0}],url=>{
      if(url.includes('boardId=1&page=2')&&failures-->0)return json({error:'Page temporarily unavailable.'},503);
    });
    render(<PinterestModule mode="pins"/>);
    await user.click(await screen.findByRole('button',{name:/^Safari Nursery Wall Art/}));
    await screen.findByText(preparedPins[0].title);
    await user.click(screen.getByRole('button',{name:'Next page for Safari Nursery Wall Art'}));
    expect((await screen.findByRole('alert')).textContent).toContain('temporarily unavailable');
    await user.click(screen.getByRole('button',{name:'Retry'}));
    expect(await screen.findByText(preparedPins[1].title)).toBeTruthy();
    expect(screen.getByText('Page 2 of 2 · 101 Pins')).toBeTruthy();
  });

  it('pages the publishing queue with complete totals',async()=>{
    const user=userEvent.setup();
    const fetchMock=mockPagedPins({1:[[preparedPins[0]]]},[{boardId:1,total:351,draft:0,paused:0,scheduled:351,published:0,failed:0}],url=>url.includes('page=2')?json({data:[{...preparedPins[1],listing:{title:'Queue page two'}}],pagination:{page:2,pageSize:100,total:351,totalPages:4}}):undefined);
    render(<PinterestModule mode="queue"/>);
    await screen.findByText(sourceTitle);
    expect(screen.getByText('Page 1 of 4 · 351 Pins')).toBeTruthy();
    await user.click(screen.getByRole('button',{name:'Next page for publishing queue'}));
    expect(await screen.findByText('Queue page two')).toBeTruthy();
    expect(screen.getByText('Page 2 of 4 · 351 Pins')).toBeTruthy();
    expect(fetchMock).toHaveBeenCalledWith('/api/pinterest/pins?page=2&pageSize=100',expect.anything());
  });
});
