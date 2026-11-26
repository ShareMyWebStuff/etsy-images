import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ListingEditorContext, ListingEditorData } from '@/lib/listing-editor';
import type { ListingTemplateArtworkPlan as Plan } from '@/lib/listing-template-artwork-policy';
import { ListingTemplateArtworkAssignments } from './ListingTemplateArtworkAssignments';

const context: ListingEditorContext = { shopId: '66615491', sectionId: '30', subSectionId: '42', listingId: '10' };
const key = '7:00000000-0000-4000-8000-000000000001', automaticKey = '8:00000000-0000-4000-8000-000000000002';
function plan(): Plan {
  return { categoryId: 25, orientation: 'portrait', valid: false, errors: [], fingerprint: 'initial', assignments: { [automaticKey]: { '7': '10' } },
    roles: [
      { id: 7, name: 'Combined room', sceneId: '00000000-0000-4000-8000-000000000001', assignmentKey: key, mode: 'combined', requiresSelection: true, valid: false, errors: [],
        items: [{ itemNumber: 1, orientation: 'portrait', sourceListingId: null, automatic: false },
          { itemNumber: 2, orientation: 'landscape', sourceListingId: null, automatic: false }, { itemNumber: 3, orientation: 'portrait', sourceListingId: null, automatic: false }] },
      { id: 8, name: 'One repeated artwork', sceneId: '00000000-0000-4000-8000-000000000002', assignmentKey: automaticKey, mode: 'both', requiresSelection: false, valid: true, errors: [],
        items: [{ itemNumber: 7, orientation: 'portrait', sourceListingId: '10', automatic: true }] },
      { id: 9, name: 'Static image', sceneId: '00000000-0000-4000-8000-000000000003', assignmentKey: null, mode: 'no-areas', requiresSelection: false, valid: true, errors: [], items: [] },
      { id: 10, name: 'Legacy PNG', sceneId: null, assignmentKey: null, mode: 'legacy', requiresSelection: false, valid: true, errors: [], items: [] },
    ], candidates: [
      { id: '10', name: 'Current fox', orientation: 'portrait', sectionId: '30', subSectionId: '42', hasThumbnail: true, hasCurrentSizes: true },
      { id: '11', name: 'Portrait deer', orientation: 'portrait', sectionId: '30', subSectionId: '43', hasThumbnail: true, hasCurrentSizes: true },
      { id: '12', name: 'Landscape hills', orientation: 'landscape', sectionId: '30', subSectionId: '43', hasThumbnail: true, hasCurrentSizes: true },
      { id: '13', name: 'Needs sizes', orientation: 'portrait', sectionId: '30', subSectionId: '42', hasThumbnail: true, hasCurrentSizes: false },
      { id: '14', name: 'Needs upload', orientation: 'portrait', sectionId: '30', subSectionId: '42', hasThumbnail: false, hasCurrentSizes: false },
      { id: '15', name: 'Other section', orientation: 'portrait', sectionId: '99', subSectionId: '98', hasThumbnail: true, hasCurrentSizes: true },
    ] };
}
// This unit only needs the editor identity, assigned template and artwork plan.
function data(artwork = plan(), listingContext = context): ListingEditorData {
  return { context: listingContext, templateArtwork: artwork, template: { id: artwork.categoryId, name: 'Room template' },
    listing: { id: listingContext.listingId, artworkOrientation: artwork.orientation } } as ListingEditorData;
}
function savedPlan(): Plan {
  const next = plan(); next.valid = true; next.fingerprint = 'saved';
  next.assignments[key] = { '1': '10', '2': '12', '3': '10' };
  next.roles[0] = { ...next.roles[0], valid: true, items: next.roles[0].items.map(item => ({ ...item, sourceListingId: next.assignments[key][String(item.itemNumber)] })) };
  return next;
}
const select = (item: number) => screen.getByRole('combobox', { name: `Combined room — Artwork item ${item} (${item === 2 ? 'landscape' : 'portrait'})` }) as HTMLSelectElement;
function chooseComplete() { for (const [item, id] of [[1, '10'], [2, '12'], [3, '10']] as const) fireEvent.change(select(item), { target: { value: id } }); }
const saveButton = () => screen.getByRole('button', { name: 'Save artwork selections' }) as HTMLButtonElement;
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
function deferred() { let resolve!: (response: Response) => void; const promise = new Promise<Response>(done => { resolve = done; }); return { promise, resolve }; }
afterEach(() => vi.unstubAllGlobals());

describe('listing template artwork selections', () => {
  it('shows one selector per distinct item, orientation-safe section candidates, current artwork and automatic/static explanations', () => {
    const request = vi.fn(); vi.stubGlobal('fetch', request);
    render(<ListingTemplateArtworkAssignments data={data()} onSaved={vi.fn()} />);
    expect(screen.getAllByRole('combobox')).toHaveLength(3);
    expect(within(select(1)).getByRole('option', { name: 'Current fox (current listing)' })).toBeTruthy();
    expect(within(select(1)).getByRole('option', { name: 'Portrait deer' })).toBeTruthy();
    expect(within(select(1)).queryByRole('option', { name: 'Landscape hills' })).toBeNull();
    expect(within(select(1)).queryByRole('option', { name: 'Other section' })).toBeNull();
    expect((within(select(1)).getByRole('option', { name: 'Needs sizes — Set Size required' }) as HTMLOptionElement).disabled).toBe(true);
    expect((within(select(1)).getByRole('option', { name: 'Needs upload — artwork required' }) as HTMLOptionElement).disabled).toBe(true);
    expect(within(select(2)).getAllByRole('option').map(option => option.textContent)).toEqual(['Choose listing artwork', 'Landscape hills']);
    expect(screen.getByText(/Uses the current listing automatically for its one distinct artwork item/)).toBeTruthy();
    expect(screen.getByText(/No areas: uses the saved image/)).toBeTruthy();
    expect(screen.queryByText('Legacy PNG')).toBeNull(); expect(saveButton().disabled).toBe(true);
    expect(request).not.toHaveBeenCalled();
  });

  it('allows source reuse but requires the current listing before enabling Save and notifies unsaved state', () => {
    const dirty = vi.fn(); render(<ListingTemplateArtworkAssignments data={data()} onSaved={vi.fn()} onDirtyChange={dirty} />);
    fireEvent.change(select(1), { target: { value: '11' } }); fireEvent.change(select(2), { target: { value: '12' } }); fireEvent.change(select(3), { target: { value: '11' } });
    expect(saveButton().disabled).toBe(true); expect(dirty).toHaveBeenLastCalledWith(true);
    expect(screen.getByText('Use the current listing for at least one artwork item.')).toBeTruthy();
    chooseComplete();
    expect(select(1).value).toBe('10'); expect(select(3).value).toBe('10'); expect(saveButton().disabled).toBe(false);
  });

  it('saves once with all context and canonical role keys, preserves automatic selections and releases locks after applying fresh data', async () => {
    const pending = deferred(), onSaved = vi.fn(), onBusy = vi.fn(), onDirty = vi.fn();
    const request = vi.fn(async () => pending.promise); vi.stubGlobal('fetch', request);
    render(<ListingTemplateArtworkAssignments data={data()} onSaved={onSaved} onSavingChange={onBusy} onDirtyChange={onDirty} />);
    chooseComplete(); const button = saveButton(); fireEvent.click(button); fireEvent.click(button);
    expect(request).toHaveBeenCalledTimes(1); expect(onBusy).toHaveBeenLastCalledWith(true);
    expect(screen.getByRole('button', { name: 'Saving artwork selections…' }).hasAttribute('disabled')).toBe(true);
    expect(select(1).disabled).toBe(true);
    const [url, options] = request.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('/api/shops/listings/editor/artwork-assignments'); expect(options.method).toBe('PUT');
    expect(JSON.parse(options.body as string)).toEqual({ ...context, assignments: { [automaticKey]: { '7': '10' }, [key]: { '1': '10', '2': '12', '3': '10' } } });
    const next = data(savedPlan()); await act(async () => pending.resolve(json({ data: next, plan: next.templateArtwork })));
    await waitFor(() => expect(onSaved).toHaveBeenCalledExactlyOnceWith(next));
    expect(onBusy).toHaveBeenLastCalledWith(false); expect(onDirty).toHaveBeenLastCalledWith(false);
    expect(screen.getByRole('status').textContent).toContain('Artwork selections saved'); expect(saveButton().disabled).toBe(true);
  });

  it('keeps rejected selections for correction and retry without applying stale readiness', async () => {
    const onSaved = vi.fn(), request = vi.fn(async () => json({ error: 'Selected artwork is no longer available.' }, 409)); vi.stubGlobal('fetch', request);
    render(<ListingTemplateArtworkAssignments data={data()} onSaved={onSaved} />); chooseComplete(); fireEvent.click(saveButton());
    expect((await screen.findByRole('alert')).textContent).toBe('Selected artwork is no longer available.');
    expect(select(1).value).toBe('10'); expect(saveButton().disabled).toBe(false); expect(onSaved).not.toHaveBeenCalled();
  });

  it('reports a committed save with refresh failure as requiring reload and keeps generation locked', async () => {
    const message = 'Artwork selections were saved, but the listing could not be refreshed. Reload this listing.';
    const onSaved = vi.fn(), dirty = vi.fn(); vi.stubGlobal('fetch', vi.fn(async () => json({ data: null, plan: savedPlan(), refreshError: message })));
    render(<ListingTemplateArtworkAssignments data={data()} onSaved={onSaved} onDirtyChange={dirty} />); chooseComplete(); fireEvent.click(saveButton());
    expect((await screen.findByRole('alert')).textContent).toBe(message);
    expect(screen.getByRole('button', { name: 'Reload listing' })).toBeTruthy(); expect(saveButton().disabled).toBe(true);
    expect(onSaved).not.toHaveBeenCalled(); expect(dirty).toHaveBeenLastCalledWith(true);
    expect(screen.queryByText(/Unable to save/)).toBeNull();
  });

  it('does not apply a foreign listing response after a successful request', async () => {
    const next = data(savedPlan(), { ...context, listingId: '99' }), onSaved = vi.fn();
    vi.stubGlobal('fetch', vi.fn(async () => json({ data: next, plan: savedPlan() })));
    render(<ListingTemplateArtworkAssignments data={data()} onSaved={onSaved} />); chooseComplete(); fireEvent.click(saveButton());
    expect((await screen.findByRole('alert')).textContent).toContain('were saved, but the listing could not be refreshed');
    expect(onSaved).not.toHaveBeenCalled();
  });

  it('abandons an in-flight response and resets selections when context or template changes', async () => {
    const pending = deferred(), onSaved = vi.fn(), busy = vi.fn(); vi.stubGlobal('fetch', vi.fn(async () => pending.promise));
    const { rerender } = render(<ListingTemplateArtworkAssignments data={data()} onSaved={onSaved} onSavingChange={busy} />);
    chooseComplete(); fireEvent.click(saveButton());
    const another = plan(); another.categoryId = 26;
    rerender(<ListingTemplateArtworkAssignments data={data(another, { ...context, listingId: '20' })} onSaved={onSaved} onSavingChange={busy} />);
    expect(select(1).value).toBe(''); expect(saveButton().disabled).toBe(true); expect(busy).toHaveBeenLastCalledWith(false);
    await act(async () => pending.resolve(json({ data: data(savedPlan()), plan: savedPlan() })));
    expect(onSaved).not.toHaveBeenCalled(); expect(select(1).value).toBe('');
  });

  it('ignores an unmounted save response and clears the parent busy and dirty indicators', async () => {
    const pending = deferred(), onSaved = vi.fn(), busy = vi.fn(), dirty = vi.fn(); vi.stubGlobal('fetch', vi.fn(async () => pending.promise));
    const { unmount } = render(<ListingTemplateArtworkAssignments data={data()} onSaved={onSaved} onSavingChange={busy} onDirtyChange={dirty} />);
    chooseComplete(); fireEvent.click(saveButton()); unmount();
    expect(busy).toHaveBeenLastCalledWith(false); expect(dirty).toHaveBeenLastCalledWith(false);
    await act(async () => pending.resolve(json({ data: data(savedPlan()), plan: savedPlan() })));
    expect(onSaved).not.toHaveBeenCalled();
  });

  it('honours external busy state and renders nothing for an entirely neutral template', () => {
    const initial = data(); const { rerender, container } = render(<ListingTemplateArtworkAssignments data={initial} disabled onSaved={vi.fn()} />);
    expect(select(1).disabled).toBe(true); expect(saveButton().disabled).toBe(true);
    const neutral = plan(); neutral.roles = [neutral.roles[3]];
    rerender(<ListingTemplateArtworkAssignments data={data(neutral)} onSaved={vi.fn()} />);
    expect(container.textContent).toBe('');
  });
});
