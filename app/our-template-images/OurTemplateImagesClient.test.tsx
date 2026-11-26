import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { OurTemplateImageDefinitionView, TemplateImageDefinitionMode, TemplateImageVariantSlot } from '@/lib/our-template-image-definition-types';
import { OurTemplateImagesClient, newestScenes } from './OurTemplateImagesClient';
import { SceneEditor, SceneTest, type SceneImage } from './SceneImageEditor';

const { push } = vi.hoisted(() => ({ push: vi.fn() }));
vi.mock('next/navigation', () => ({ useRouter: () => ({ push }) }));

type Definition = OurTemplateImageDefinitionView;
type Image = Definition['images'][number] & { variantSlot: TemplateImageVariantSlot };
const tags = [{ id: 'portrait-tag', name: 'Warm room' }, { id: 'landscape-tag', name: 'Wide room' }];
function image(id = 'portrait-image', slot: TemplateImageVariantSlot = 'portrait', item = 1): Image {
  const orientation = slot === 'landscape' ? 'landscape' : 'portrait';
  return { id, name: `${slot} room`, originalFileName: `${id}.png`, width: 1200, height: 800,
    createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-02T00:00:00.000Z', variantSlot: slot,
    tags: [slot === 'landscape' ? tags[1] : tags[0]], lightingMode: 'opaque',
    openings: [{ id: `${id}-opening`, name: `${slot} frame`, imageItemNumber: item, ratio: '4x5', orientation,
      corners: { topLeft: { x: 100, y: 100 }, topRight: { x: 450, y: 100 }, bottomRight: { x: 450, y: 650 }, bottomLeft: { x: 100, y: 650 } }, placements: {} }] };
}
function definition(id = 'parent', images: Image[] = [image()], mode: TemplateImageDefinitionMode = 'both'): Definition {
  return { id, name: id === 'parent' ? 'Nursery definition' : id, mode, images,
    createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-02T00:00:00.000Z' };
}
function json(payload: unknown, ok = true) { return { ok, json: async () => payload }; }
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>(done => { resolve = done; });
  return { promise, resolve };
}
function mockApi(initial = [definition()]) {
  let saved = structuredClone(initial);
  const request = vi.fn(async (url: string, options?: RequestInit) => {
    if (url === '/api/our-template-image-tags') return json({ tags });
    if (url === '/api/our-template-image-definitions' && options?.method === 'POST') {
      const body = JSON.parse(options.body as string), created = { ...definition('created', [], body.mode), name: body.name };
      saved.push(created); return json({ definition: created });
    }
    if (url === '/api/our-template-image-definitions') return json({ definitions: saved });
    if (url.endsWith('/impact')) return json({ impact: { affectedTemplateCount: 2, affectedImageTemplateCount: 3, affectedListingCount: 4 } });
    const match = url.match(/^\/api\/our-template-image-definitions\/([^/]+)(?:\/images\/([^/]+))?$/);
    if (match) {
      const parent = saved.find(item => item.id === match[1])!;
      if (options?.method === 'PATCH') { parent.name = JSON.parse(options.body as string).name; return json({ definition: parent }); }
      if (options?.method === 'DELETE' && match[2]) { parent.images = parent.images.filter(item => item.id !== match[2]); return json({ definition: parent }); }
      if (options?.method === 'DELETE') { saved = saved.filter(item => item.id !== parent.id); return json({ deletedId: parent.id }); }
      return json({ definition: parent });
    }
    throw new Error(`Unexpected request ${options?.method ?? 'GET'} ${url}`);
  });
  vi.stubGlobal('fetch', request);
  return { request, saved: () => saved };
}
function editorProps() { return { tagOptions: [], tagsLoading: false, tagsError: null, onReloadTags: vi.fn(), onTagCreated: vi.fn(), onCancel: vi.fn(), onSaved: vi.fn() }; }
beforeEach(() => {
  push.mockReset();
  vi.spyOn(document, 'referrer', 'get').mockReturnValue('');
  window.history.replaceState({}, '', '/our-template-images');
  Object.defineProperty(URL, 'createObjectURL', { configurable: true, value: vi.fn(() => 'blob:test-image') });
  Object.defineProperty(URL, 'revokeObjectURL', { configurable: true, value: vi.fn() });
});
afterEach(() => vi.unstubAllGlobals());

describe('template image definitions', () => {
  it('keeps scene creation ordering stable regardless of edit date', () => {
    const older = image(), newer = { ...image('11'), createdAt: '2026-02-01' }, tied = { ...image('12'), createdAt: newer.createdAt };
    older.updatedAt = '2026-12-01';
    expect(newestScenes([older, newer, tied]).map(item => item.id)).toEqual(['12', '11', 'portrait-image']);
  });

  it('shows the parent name above its portrait preview and toggles active tags and original downloads without library Test', async () => {
    const { request } = mockApi([definition('parent', [image('landscape-image', 'landscape'), image()])]);
    render(<OurTemplateImagesClient />);
    const card = (await screen.findByRole('heading', { name: 'Nursery definition' })).closest<HTMLElement>('[role=listitem]')!;
    const heading = within(card).getByRole('heading'), preview = within(card).getByRole('img');
    expect(heading.compareDocumentPosition(preview) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(preview.getAttribute('src')).toContain('/portrait-image/image?preview=1');
    expect(preview.getAttribute('loading')).toBe('lazy'); expect(preview.getAttribute('decoding')).toBe('async');
    expect(within(card).getByText('Warm room')).toBeTruthy(); expect(within(card).queryByText('Wide room')).toBeNull();
    expect(within(card).queryByRole('button', { name: /Test/ })).toBeNull();
    fireEvent.click(within(card).getByRole('button', { name: 'Landscape' }));
    expect(preview.getAttribute('src')).toContain('/landscape-image/image?preview=1');
    expect(within(card).getByText('Wide room')).toBeTruthy(); expect(within(card).queryByText('Warm room')).toBeNull();
    const download = within(card).getByRole('link', { name: 'Download Nursery definition' });
    const url = new URL(download.getAttribute('href')!, 'http://localhost');
    expect(url.pathname).toBe('/api/our-template-images/landscape-image/image');
    expect(url.searchParams.get('download')).toBe('1'); expect(url.searchParams.has('preview')).toBe(false);
    fireEvent.click(within(card).getByRole('button', { name: 'Edit Nursery definition' }));
    expect(screen.getByRole('heading', { name: 'Nursery definition' })).toBeTruthy();
    expect((screen.getByRole('button', { name: 'Load Portrait' }) as HTMLButtonElement).disabled).toBe(true);
    expect((screen.getByRole('button', { name: 'Load Landscape' }) as HTMLButtonElement).disabled).toBe(true);
    expect((screen.getByRole('button', { name: 'Edit image portrait room' }) as HTMLButtonElement).disabled).toBe(false);
    expect((screen.getByRole('button', { name: 'Edit image landscape room' }) as HTMLButtonElement).disabled).toBe(false);
    expect(screen.queryByAltText('Room scene opening editor')).toBeNull();
    expect(request.mock.calls.every(([, options]) => !options?.method)).toBe(true);
  });

  it.each(['no-areas', 'both', 'combined'] as const)('creates a saved empty %s definition before opening its image editor', async mode => {
    const { request, saved } = mockApi([]);
    render(<OurTemplateImagesClient />);
    await screen.findByText(/No template images yet/);
    fireEvent.click(screen.getByRole('button', { name: 'Create template image' }));
    const dialog = screen.getByRole('dialog', { name: 'Create template image' });
    expect((within(dialog).getByRole('radio', { name: 'Both' }) as HTMLInputElement).checked).toBe(true);
    fireEvent.change(within(dialog).getByLabelText('Template image name'), { target: { value: 'New room' } });
    fireEvent.click(within(dialog).getByRole('radio', { name: mode === 'no-areas' ? 'No areas' : mode === 'both' ? 'Both' : 'Combined' }));
    fireEvent.click(within(dialog).getByRole('button', { name: 'Create' }));
    await screen.findByRole('heading', { name: 'New room' });
    expect(saved()).toHaveLength(1); expect(saved()[0].images).toEqual([]);
    expect(request).toHaveBeenCalledWith('/api/our-template-image-definitions', expect.objectContaining({ method: 'POST', body: JSON.stringify({ name: 'New room', mode }) }));
    expect(screen.getByRole('button', { name: 'Save Image Template' })).toBeTruthy();
    expect((screen.getByRole('button', { name: mode === 'both' ? 'Load Portrait' : 'Select Image' }) as HTMLButtonElement).disabled).toBe(false);
    fireEvent.change(screen.getByLabelText('Template Image Name'), { target: { value: 'Unsaved name' } });
    fireEvent.click(screen.getByRole('button', { name: 'Back' }));
    await screen.findByRole('heading', { name: 'New room' });
    expect(screen.queryByRole('heading', { name: 'Unsaved name' })).toBeNull();
    expect((screen.getByRole('button', { name: 'Download New room' }) as HTMLButtonElement).disabled).toBe(true);
    expect(request.mock.calls.filter(([, options]) => options?.method)).toHaveLength(1);
  });

  it('cancels creation without a mutation and saves a renamed parent without altering children', async () => {
    const { request, saved } = mockApi(); const originalChildren = structuredClone(saved()[0].images);
    render(<OurTemplateImagesClient />);
    fireEvent.click(screen.getByRole('button', { name: 'Create template image' }));
    fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Cancel' }));
    expect(request.mock.calls.every(([, options]) => !options?.method)).toBe(true);
    fireEvent.click(await screen.findByRole('button', { name: 'Edit Nursery definition' }));
    fireEvent.change(screen.getByLabelText('Template Image Name'), { target: { value: 'Renamed parent' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save Image Template' }));
    await screen.findByRole('heading', { name: 'Renamed parent' });
    expect(saved()[0].images).toEqual(originalChildren);
    expect(request).toHaveBeenCalledWith('/api/our-template-image-definitions/parent', expect.objectContaining({ method: 'PATCH', body: JSON.stringify({ name: 'Renamed parent' }) }));
  });

  it('returns Back to the originating template without saving a rename, while child Cancel stays in its parent', async () => {
    const { request, saved } = mockApi(), originalChildren = structuredClone(saved()[0].images);
    const returnTo = '/our-templates/25/edit?tab=image-templates&filter=Nursery#role-9';
    window.history.replaceState({}, '', `/our-template-images?${new URLSearchParams({ definition: 'parent', returnTo })}`);
    render(<OurTemplateImagesClient />);
    fireEvent.click(await screen.findByRole('button', { name: 'Edit image portrait room' }));
    expect(screen.getByRole('heading', { name: 'Edit template image' })).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(screen.getByRole('heading', { name: 'Nursery definition' })).toBeTruthy();
    expect(push).not.toHaveBeenCalled();
    fireEvent.change(screen.getByLabelText('Template Image Name'), { target: { value: 'Unsaved name' } });
    fireEvent.click(screen.getByRole('button', { name: 'Back' }));
    expect(push).toHaveBeenCalledExactlyOnceWith(returnTo);
    expect(saved()[0].name).toBe('Nursery definition'); expect(saved()[0].images).toEqual(originalChildren);
    expect(request.mock.calls.every(([, options]) => !options?.method)).toBe(true);
  });

  it('returns an old child deep link to its same-origin referring template Image Templates tab', async () => {
    const { request } = mockApi();
    vi.spyOn(document, 'referrer', 'get').mockReturnValue(`${window.location.origin}/our-templates/25/edit?tab=details&filter=Nursery#role-9`);
    window.history.replaceState({}, '', '/our-template-images?edit=portrait-image');
    render(<OurTemplateImagesClient />);
    fireEvent.click(await screen.findByRole('button', { name: 'Back' }));
    expect(push).toHaveBeenCalledExactlyOnceWith('/our-templates/25/edit?tab=image-templates&filter=Nursery#role-9');
    expect(request.mock.calls.every(([, options]) => !options?.method)).toBe(true);
  });

  it('clears the template return context after saving so reopening from the library stays in the library', async () => {
    mockApi();
    window.history.replaceState({}, '', `/our-template-images?${new URLSearchParams({ definition: 'parent', returnTo: '/our-templates/25/edit?tab=image-templates' })}`);
    render(<OurTemplateImagesClient />);
    fireEvent.change(await screen.findByLabelText('Template Image Name'), { target: { value: 'Saved name' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save Image Template' }));
    await screen.findByRole('list', { name: 'Template images' });
    expect(push).not.toHaveBeenCalled(); expect(window.location.search).toBe('');
    fireEvent.click(screen.getByRole('button', { name: 'Edit Saved name' }));
    fireEvent.click(screen.getByRole('button', { name: 'Back' }));
    expect(push).not.toHaveBeenCalled();
    expect(screen.getByRole('list', { name: 'Template images' })).toBeTruthy();
    expect(window.location.search).toBe('');
  });

  it.each([
    'https://example.com/our-templates/25/edit',
    '//example.com/our-templates/25/edit',
    '/\\example.com/our-templates/25/edit',
    '/our-templates/25/edit?tab=image-templates\n',
    '/our-templates/0/edit',
    '/listings',
  ])('ignores an unsafe explicit returnTo %j without falling back to a referring template', async returnTo => {
    const { request, saved } = mockApi();
    vi.spyOn(document, 'referrer', 'get').mockReturnValue(`${window.location.origin}/our-templates/25/edit?tab=image-templates`);
    window.history.replaceState({}, '', `/our-template-images?${new URLSearchParams({ definition: 'parent', returnTo })}`);
    render(<OurTemplateImagesClient />);
    fireEvent.change(await screen.findByLabelText('Template Image Name'), { target: { value: 'Unsaved name' } });
    fireEvent.click(screen.getByRole('button', { name: 'Back' }));
    expect(push).not.toHaveBeenCalled();
    expect(screen.getByRole('list', { name: 'Template images' })).toBeTruthy();
    expect(screen.getByRole('heading', { name: 'Nursery definition' })).toBeTruthy();
    expect(screen.queryByRole('heading', { name: 'Unsaved name' })).toBeNull();
    expect(saved()[0].name).toBe('Nursery definition');
    expect(new URLSearchParams(window.location.search).has('definition')).toBe(false);
    expect(new URLSearchParams(window.location.search).has('returnTo')).toBe(false);
    expect(request.mock.calls.every(([, options]) => !options?.method)).toBe(true);
  });

  it('returns a directly opened definition to the library without saving the unsaved name or using an external referrer', async () => {
    const { request } = mockApi();
    vi.spyOn(document, 'referrer', 'get').mockReturnValue('https://example.com/our-templates/25/edit');
    window.history.replaceState({}, '', '/our-template-images?definition=parent');
    render(<OurTemplateImagesClient />);
    fireEvent.change(await screen.findByLabelText('Template Image Name'), { target: { value: 'Unsaved name' } });
    fireEvent.click(screen.getByRole('button', { name: 'Back' }));
    expect(push).not.toHaveBeenCalled();
    expect(screen.getByRole('list', { name: 'Template images' })).toBeTruthy();
    expect(screen.getByRole('heading', { name: 'Nursery definition' })).toBeTruthy();
    expect(screen.queryByRole('heading', { name: 'Unsaved name' })).toBeNull();
    expect(window.location.search).toBe('');
    expect(request.mock.calls.every(([, options]) => !options?.method)).toBe(true);
  });

  it('opens legacy child links at their parent and removes only the selected child association', async () => {
    const portrait = image(), landscape = image('landscape-image', 'landscape');
    const { request, saved } = mockApi([definition('parent', [portrait, landscape]), definition('other-parent', [portrait])]);
    window.history.replaceState({}, '', '/our-template-images?edit=portrait-image');
    render(<OurTemplateImagesClient />);
    await screen.findByRole('button', { name: 'Load Landscape' });
    expect(window.location.search).toBe('?definition=parent');
    fireEvent.click(screen.getByRole('button', { name: 'Delete image portrait room' }));
    const confirmation = screen.getByRole('dialog', { name: 'Delete image portrait room?' });
    expect(confirmation.textContent).toContain('Images shared with other definitions are kept');
    fireEvent.click(within(confirmation).getByRole('button', { name: 'Delete image' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(saved()[0].images.map(item => item.id)).toEqual(['landscape-image']);
    expect((screen.getByRole('button', { name: 'Load Portrait' }) as HTMLButtonElement).disabled).toBe(false);
    expect((screen.getByRole('button', { name: 'Load Landscape' }) as HTMLButtonElement).disabled).toBe(true);
    expect(saved()[1].images.map(item => item.id)).toEqual(['portrait-image']);
    expect(request).toHaveBeenCalledWith('/api/our-template-image-definitions/parent/images/portrait-image', { method: 'DELETE' });
    expect(request.mock.calls.some(([url, options]) => url === '/api/our-template-images/portrait-image' && options?.method === 'DELETE')).toBe(false);
  });

  it.each([false, true])('accepts a committed child deletion without refreshed definition (refresh warning: %s)', async withWarning => {
    const parent = definition('parent', [image(), image('landscape-image', 'landscape')]);
    const base = mockApi([parent]), refreshed = deferred<ReturnType<typeof json>>();
    const warning = 'The image was deleted, but the definition could not be reloaded. Reload this page.';
    const request = vi.fn((url: string, options?: RequestInit) => {
      if (url === '/api/our-template-image-definitions/parent/images/landscape-image' && options?.method === 'DELETE') {
        return Promise.resolve(json({ deletedId: 'landscape-image', definitionId: 'parent', ...(withWarning ? { refreshError: warning } : {}) }));
      }
      if (url === '/api/our-template-image-definitions/parent' && !options?.method) return refreshed.promise;
      return base.request(url, options);
    });
    vi.stubGlobal('fetch', request);
    window.history.replaceState({}, '', '/our-template-images?definition=parent');
    render(<OurTemplateImagesClient />);
    fireEvent.click(await screen.findByRole('button', { name: 'Delete image landscape room' }));
    fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Delete image' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(screen.queryByRole('heading', { name: 'landscape room' })).toBeNull();
    expect((screen.getByRole('button', { name: 'Load Landscape' }) as HTMLButtonElement).disabled).toBe(false);
    expect((screen.getByRole('button', { name: 'Load Portrait' }) as HTMLButtonElement).disabled).toBe(true);
    expect(request.mock.calls.filter(([, options]) => options?.method === 'DELETE')).toHaveLength(1);
    if (withWarning) expect(screen.getByRole('alert').textContent).toContain(warning);
    await act(async () => refreshed.resolve(json({ definition: { ...parent, images: [parent.images[0]] } })));
    expect(screen.queryByRole('alert')).toBeNull();
    expect(screen.queryByRole('heading', { name: 'landscape room' })).toBeNull();
  });

  it('does not restore a deleted child when a background reload from an earlier save finishes late', async () => {
    const parent = definition('parent', [image(), image('landscape-image', 'landscape')]);
    const base = mockApi([parent]), oldReload = deferred<ReturnType<typeof json>>();
    const staleSnapshot = structuredClone(parent), savedPortrait = { ...parent.images[0], name: 'Corrected portrait room' };
    const request = vi.fn((url: string, options?: RequestInit) => {
      if (url === '/api/our-template-images/portrait-image' && options?.method === 'PATCH') return Promise.resolve(json({ image: savedPortrait }));
      if (url === '/api/our-template-image-definitions/parent' && !options?.method) return oldReload.promise;
      if (url === '/api/our-template-image-definitions/parent/images/landscape-image' && options?.method === 'DELETE') {
        return Promise.resolve(json({ deletedId: 'landscape-image', definitionId: 'parent', definition: { ...parent, images: [savedPortrait] } }));
      }
      return base.request(url, options);
    });
    vi.stubGlobal('fetch', request);
    window.history.replaceState({}, '', '/our-template-images?definition=parent');
    render(<OurTemplateImagesClient />);
    fireEvent.click(await screen.findByRole('button', { name: 'Edit image portrait room' }));
    fireEvent.click(screen.getByRole('button', { name: 'Save template image' }));
    await screen.findByRole('heading', { name: 'Corrected portrait room' });
    expect(request).toHaveBeenCalledWith('/api/our-template-image-definitions/parent', { cache: 'no-store' });
    fireEvent.click(screen.getByRole('button', { name: 'Delete image landscape room' }));
    fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Delete image' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    await act(async () => oldReload.resolve(json({ definition: staleSnapshot })));
    expect(screen.queryByRole('heading', { name: 'landscape room' })).toBeNull();
    expect(screen.getByRole('heading', { name: 'Corrected portrait room' })).toBeTruthy();
    expect((screen.getByRole('button', { name: 'Load Landscape' }) as HTMLButtonElement).disabled).toBe(false);
    fireEvent.click(screen.getByRole('button', { name: 'Back' }));
    const card = screen.getByRole('listitem');
    expect(within(card).queryByRole('button', { name: 'Landscape' })).toBeNull();
  });

  it('keeps a failed child deletion retryable and guards duplicate submissions while it is pending', async () => {
    const base = mockApi([definition('parent', [image(), image('landscape-image', 'landscape')])]);
    const pending = deferred<ReturnType<typeof json>>();
    let attempts = 0;
    const request = vi.fn((url: string, options?: RequestInit) => {
      if (url === '/api/our-template-image-definitions/parent/images/landscape-image' && options?.method === 'DELETE' && ++attempts === 1) return pending.promise;
      return base.request(url, options);
    });
    vi.stubGlobal('fetch', request);
    window.history.replaceState({}, '', '/our-template-images?definition=parent');
    render(<OurTemplateImagesClient />);
    fireEvent.click(await screen.findByRole('button', { name: 'Delete image landscape room' }));
    const dialog = screen.getByRole('dialog');
    fireEvent.click(within(dialog).getByRole('button', { name: 'Delete image' }));
    const pendingButton = within(dialog).getByRole('button', { name: /Deleting/ }) as HTMLButtonElement;
    expect(pendingButton.disabled).toBe(true);
    fireEvent.click(pendingButton);
    expect(attempts).toBe(1);
    await act(async () => pending.resolve(json({ error: 'The image is being updated. Try again.' }, false)));
    expect(within(dialog).getByRole('alert').textContent).toContain('The image is being updated. Try again.');
    expect((within(dialog).getByRole('button', { name: 'Delete image' }) as HTMLButtonElement).disabled).toBe(false);
    fireEvent.click(within(dialog).getByRole('button', { name: 'Delete image' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(attempts).toBe(2);
    expect(screen.queryByRole('heading', { name: 'landscape room' })).toBeNull();
  });

  it('checks parent dependencies before deletion and keeps an empty definition independently removable', async () => {
    const { request } = mockApi([definition('parent', [])]);
    render(<OurTemplateImagesClient />);
    fireEvent.click(await screen.findByRole('button', { name: 'Delete Nursery definition' }));
    const dialog = screen.getByRole('dialog', { name: 'Delete Nursery definition?' });
    await within(dialog).findByText(/2 template\(s\).*3 image reference\(s\).*4 listing\(s\)/);
    fireEvent.click(within(dialog).getByRole('button', { name: 'Delete template image' }));
    await screen.findByText(/No template images yet/);
    expect(request).toHaveBeenCalledWith('/api/our-template-image-definitions/parent', { method: 'DELETE' });
  });

  it('searches child filenames and requires all selected tags on the same child image', async () => {
    mockApi([definition('parent', [image(), image('landscape-image', 'landscape')]), definition('Empty draft', [])]);
    render(<OurTemplateImagesClient />);
    const search = await screen.findByRole('searchbox', { name: 'Search template images' });
    fireEvent.change(search, { target: { value: 'LANDSCAPE-IMAGE.PNG' } });
    expect(screen.getAllByRole('listitem')).toHaveLength(1);
    fireEvent.change(search, { target: { value: '' } });
    const input = screen.getByRole('combobox', { name: 'Filter by tags' });
    fireEvent.change(input, { target: { value: 'Warm' } }); fireEvent.click(await screen.findByRole('option', { name: 'Warm room' }));
    expect(screen.getByRole('heading', { name: 'Nursery definition' })).toBeTruthy();
    fireEvent.change(input, { target: { value: 'Wide' } }); fireEvent.click(await screen.findByRole('option', { name: 'Wide room' }));
    expect(screen.getByText('No template images match your search.')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Clear search' }));
    expect(screen.getAllByRole('listitem')).toHaveLength(2);
  });
});

describe('inherited child image modes', () => {
  it('uploads a No areas image through its parent endpoint and cannot create artwork areas', async () => {
    const props = editorProps(), saved = { ...image('static-image', 'single'), openings: [] };
    const request = vi.fn(async (_url: string, _options?: RequestInit) => json({ image: saved })); vi.stubGlobal('fetch', request);
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue({ drawImage: vi.fn(), getImageData: () => ({ data: new Uint8ClampedArray(120 * 80 * 4) }) } as never);
    render(<SceneEditor {...props} initial={null} defaultName="Static room" childContext={{ parentDefinitionId: 'parent', mode: 'no-areas', variantSlot: 'single' }} />);
    expect(screen.queryByRole('button', { name: 'Place four corners manually' })).toBeNull();
    expect(screen.queryByText(/Openings \(/)).toBeNull();
    fireEvent.change(screen.getByLabelText(/^Canva room PNG/), { target: { files: [new File(['PNG'], 'static.png', { type: 'image/png' })] } });
    const source = screen.getByAltText('Room scene opening editor');
    Object.defineProperties(source, { naturalWidth: { value: 120 }, naturalHeight: { value: 80 } }); fireEvent.load(source);
    fireEvent.pointerDown(source.parentElement!, { button: 0, clientX: 10, clientY: 10 });
    fireEvent.click(screen.getByRole('button', { name: 'Save template image' }));
    expect(request).toHaveBeenCalledWith('/api/our-template-image-definitions/parent/images', expect.objectContaining({ method: 'POST' }));
    const form = request.mock.calls[0][1]!.body as FormData;
    expect(form.get('parentDefinitionId')).toBe('parent'); expect(form.get('variantSlot')).toBe('single');
    expect(JSON.parse(String(form.get('definition'))).openings).toEqual([]);
    await waitFor(() => expect(props.onSaved).toHaveBeenCalledOnce());
  });

  it('locks Both children to their inherited orientation and blocks a mismatched existing image', () => {
    const request = vi.fn(); vi.stubGlobal('fetch', request);
    render(<SceneEditor {...editorProps()} initial={image('wrong', 'landscape')} childContext={{ parentDefinitionId: 'parent', mode: 'both', variantSlot: 'portrait' }} />);
    expect((screen.getByLabelText('Paper orientation') as HTMLSelectElement).disabled).toBe(true);
    fireEvent.click(screen.getByRole('button', { name: 'Save template image' }));
    expect(screen.getByRole('alert').textContent).toContain('Every artwork area must use portrait orientation');
    expect(request).not.toHaveBeenCalled();
  });

  it('blocks Combined images until both orientations use different unique artwork numbers', async () => {
    const first = image(), second = image('second').openings[0]; second.id = 'second'; second.imageItemNumber = 1;
    const initial: SceneImage = { ...first, openings: [...first.openings, second] };
    const request = vi.fn(async (_url: string, _options?: RequestInit) => json({ image: initial })); vi.stubGlobal('fetch', request);
    render(<SceneEditor {...editorProps()} initial={initial} childContext={{ parentDefinitionId: 'parent', mode: 'combined', variantSlot: 'single' }} />);
    fireEvent.click(screen.getByRole('button', { name: 'Save template image' }));
    expect(screen.getByRole('alert').textContent).toContain('at least one portrait area and one landscape area');
    fireEvent.change(screen.getByLabelText('Selected opening'), { target: { value: 'second' } });
    fireEvent.change(screen.getByLabelText('Paper orientation'), { target: { value: 'landscape' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save template image' }));
    expect(screen.getByRole('alert').textContent).toContain('Artwork item 1 cannot be used for both');
    expect(request).not.toHaveBeenCalled();
    fireEvent.change(screen.getByLabelText('Artwork item'), { target: { value: '2' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save template image' }));
    await waitFor(() => expect(request).toHaveBeenCalledOnce());
    const form = request.mock.calls[0][1]!.body as FormData;
    expect(form.get('variantSlot')).toBe('single');
    expect(JSON.parse(String(form.get('definition'))).openings.map((area: { imageItemNumber: number; orientation: string }) => [area.imageItemNumber, area.orientation])).toEqual([[1, 'portrait'], [2, 'landscape']]);
  });

  it('renders No areas tests without asking for artwork', async () => {
    const request = vi.fn(async (url: string) => url.endsWith('/samples') ? json({ artworks: [] }) : { ok: true, blob: async () => new Blob(['PNG']) }); vi.stubGlobal('fetch', request);
    render(<SceneTest scene={{ ...image('static', 'single'), openings: [] }} onClose={vi.fn()} onFitted={vi.fn()} childContext={{ parentDefinitionId: 'parent', mode: 'no-areas', variantSlot: 'single' }} />);
    expect(screen.queryByLabelText(/Upload sample artwork/)).toBeNull();
    const renderButton = screen.getByRole('button', { name: 'Render test preview' }) as HTMLButtonElement;
    expect(renderButton.disabled).toBe(false);
    fireEvent.click(renderButton);
    await screen.findByAltText('Completed room preview for single room');
    expect(request).toHaveBeenCalledWith('/api/our-template-images/static/test', expect.objectContaining({ method: 'POST' }));
  });

  it('deduplicates repeated areas in Test and filters saved artwork by each item?s required orientation', async () => {
    const portrait = image(), landscape = image('wide', 'landscape', 2), repeated = { ...portrait.openings[0], id: 'repeat' };
    const combined = { ...portrait, openings: [...portrait.openings, ...landscape.openings, repeated] };
    vi.stubGlobal('fetch', vi.fn(async () => json({ artworks: [{ id: 'p', name: 'Portrait artwork', orientation: 'portrait' }, { id: 'l', name: 'Landscape artwork', orientation: 'landscape' }] })));
    render(<SceneTest scene={combined} onClose={vi.fn()} onFitted={vi.fn()} childContext={{ parentDefinitionId: 'parent', mode: 'combined', variantSlot: 'single' }} />);
    const portraitOptions = await screen.findByLabelText('Or choose existing artwork 1');
    await within(portraitOptions).findByRole('option', { name: 'Portrait artwork' });
    expect(within(portraitOptions).queryByRole('option', { name: 'Landscape artwork' })).toBeNull();
    const landscapeOptions = screen.getByLabelText('Or choose existing artwork 2');
    expect(within(landscapeOptions).getByRole('option', { name: 'Landscape artwork' })).toBeTruthy();
    expect(within(landscapeOptions).queryByRole('option', { name: 'Portrait artwork' })).toBeNull();
    expect(screen.getAllByRole('group')).toHaveLength(2);
    expect(screen.queryByLabelText('Upload sample artwork 3')).toBeNull();
  });
});
