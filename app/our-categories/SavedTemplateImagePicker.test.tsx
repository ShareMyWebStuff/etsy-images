import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { SavedTemplateImagePicker } from './SavedTemplateImagePicker';
import type { OurCategoryFormValues } from '@/lib/our-categories';
import type { OurTemplateImageDefinitionView } from '@/lib/our-template-image-definition-types';
import type { TemplateImageTag } from '@/lib/our-template-image-tag-types';

const values: OurCategoryFormValues = { name: 'Single artwork', templateType: 'single', itemCount: 1, followedTemplateId: null,
  roomTheme: '', backgroundColour: '#F5F0E8', printsFrames: true, customisePrints: false, digitalDownload: true, customTop: false,
  customBottom: false, printFrameSectionId: null, customisedSectionId: null, downloadSectionId: null, sizes: {}, frames: {}, landscapeEnabled: false };
const tags: TemplateImageTag[] = [{ id: 'nursery', name: 'Nursery' }, { id: 'woodland', name: 'Woodland' }, { id: 'bedroom', name: 'Bedroom' }];
function child(id: string, orientation: 'portrait' | 'landscape', tagged: TemplateImageTag[], items = [1]): OurTemplateImageDefinitionView['images'][number] {
  return { id, name: `${id} child`, width: 1200, height: 800, tags: tagged, originalFileName: `${id}.png`, createdAt: '2026-01-01', updatedAt: '2026-01-02',
    variantSlot: orientation, lightingMode: 'opaque', openings: items.map((item, index) => ({ id: `opening-${index}`, name: `Frame ${index + 1}`,
      imageItemNumber: item, orientation, ratio: '4x5', placements: {}, corners: { topLeft: { x: 10, y: 10 }, topRight: { x: 90, y: 10 },
        bottomRight: { x: 90, y: 90 }, bottomLeft: { x: 10, y: 90 } } })) };
}
const definitions: OurTemplateImageDefinitionView[] = [
  { id: 'both', name: 'Two orientation rooms', mode: 'both', createdAt: '2026-01-01', updatedAt: '2026-01-01',
    images: [child('landscape', 'landscape', [tags[1]]), child('portrait', 'portrait', [tags[0]])] },
  { id: 'combined', name: 'Four print room', mode: 'combined', createdAt: '2026-01-01', updatedAt: '2026-01-01',
    images: [{ ...child('mixed', 'portrait', [tags[1], tags[2]], [1, 2, 3, 4, 1]), variantSlot: 'single',
      openings: child('mixed', 'portrait', [], [1, 2, 3, 4, 1]).openings.map(opening => ({ ...opening, orientation: opening.imageItemNumber % 2 ? 'portrait' : 'landscape' })) }] },
  { id: 'empty', name: 'Empty definition', mode: 'no-areas', createdAt: '2026-01-01', updatedAt: '2026-01-01', images: [] },
];
function mockApi(options: { definitions?: OurTemplateImageDefinitionView[]; loadError?: string; tagsError?: string; attachError?: string } = {}) {
  const request = vi.fn(async (url: string, init?: RequestInit) => {
    if (url === '/api/our-template-image-definitions') return { ok: !options.loadError, json: async () => options.loadError ? { error: options.loadError } : { definitions: options.definitions ?? definitions } };
    if (url === '/api/our-template-image-tags') return { ok: !options.tagsError, json: async () => options.tagsError ? { error: options.tagsError } : { tags } };
    if (url === '/api/our-categories/12/templates' && init?.method === 'POST') return { ok: !options.attachError, json: async () => options.attachError ? { error: options.attachError } : { template: { id: '88', templateImageDefinitionId: (init.body as FormData).get('templateImageDefinitionId') } } };
    throw new Error(`Unexpected picker request ${url}`);
  });
  vi.stubGlobal('fetch', request); return request;
}
function mount(onAttached = vi.fn()) { render(<SavedTemplateImagePicker categoryId="12" values={values} onClose={vi.fn()} onAttached={onAttached} />); return onAttached; }
const results = () => within(screen.getByRole('region', { name: 'Saved template image definitions' })).queryAllByRole('button', { name: /^Select / });
async function tag(name: string) { fireEvent.change(screen.getByRole('combobox', { name: 'Filter template images by tags' }), { target: { value: name.slice(0, 3) } }); fireEvent.click(await screen.findByRole('option', { name })); }
afterEach(() => vi.unstubAllGlobals());

describe('saved template image definition picker', () => {
  it('browses parent definitions with portrait-first cached thumbnails and attaches description and selected products', async () => {
    const request = mockApi(), attached = mount();
    const choice = await screen.findByRole('button', { name: 'Select Two orientation rooms' });
    expect(results()).toHaveLength(3);
    const preview = within(choice).getByRole('img', { name: 'Two orientation rooms' });
    const url = new URL(preview.getAttribute('src')!, 'http://localhost');
    expect(url.pathname).toBe('/api/our-template-images/portrait/image'); expect(url.searchParams.get('preview')).toBe('1');
    expect(preview.getAttribute('loading')).toBe('lazy'); expect(preview.getAttribute('decoding')).toBe('async');
    expect(within(choice).getByText('Both - 2 images')).toBeTruthy();
    expect(within(choice).getByText('Nursery')).toBeTruthy(); expect(within(choice).getByText('Woodland')).toBeTruthy();
    fireEvent.click(choice);
    expect(choice.getAttribute('aria-pressed')).toBe('true');
    fireEvent.change(screen.getByLabelText('Description'), { target: { value: 'A paired room mockup' } });
    fireEvent.click(screen.getByLabelText('Digital downloads'));
    fireEvent.click(screen.getByRole('button', { name: 'Add template image' }));
    await waitFor(() => expect(attached).toHaveBeenCalledWith({ id: '88', templateImageDefinitionId: 'both' }));
    const post = request.mock.calls.find(([, init]) => init?.method === 'POST')!, form = post[1]!.body as FormData;
    expect(form.get('templateImageDefinitionId')).toBe('both'); expect(form.has('ourTemplateImageId')).toBe(false); expect(form.has('file')).toBe(false);
    expect(form.get('description')).toBe('A paired room mockup'); expect(form.get('useOnPrints')).toBe('true');
    expect(form.get('useOnCustomised')).toBe('false'); expect(form.get('useOnDigital')).toBe('false');
    expect(request.mock.calls.some(([url]) => url === '/api/our-template-images')).toBe(false);
  });

  it('allows multiple unique artwork numbers on a single template and counts reused areas once', async () => {
    const request = mockApi(); mount();
    fireEvent.click(await screen.findByRole('button', { name: 'Select Four print room' }));
    expect(screen.getByText(/4 distinct artwork items/)).toBeTruthy();
    expect(screen.queryByRole('alert')).toBeNull();
    const confirm = screen.getByRole('button', { name: 'Add template image' }) as HTMLButtonElement;
    expect(confirm.disabled).toBe(false); // Single category, landscape disabled: parent type governs its images.
    fireEvent.click(confirm);
    await waitFor(() => expect(request.mock.calls.some(([, init]) => init?.method === 'POST')).toBe(true));
  });

  it('matches tag unions across child images and combines them with a case-insensitive parent-name filter', async () => {
    mockApi(); mount(); await screen.findByRole('button', { name: 'Select Two orientation rooms' });
    fireEvent.click(screen.getByRole('button', { name: 'Search by tags' })); await tag('Nursery'); await tag('Woodland');
    expect(results().map(button => button.getAttribute('aria-label'))).toEqual(['Select Two orientation rooms']);
    fireEvent.click(results()[0]);
    fireEvent.change(screen.getByLabelText('Search template images by name'), { target: { value: ' FOUR ' } });
    expect(results()).toHaveLength(0); expect(screen.queryByText('Selected: Two orientation rooms')).toBeNull();
    expect((screen.getByRole('button', { name: 'Add template image' }) as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(screen.getByRole('button', { name: 'Clear filters' }));
    expect(results()).toHaveLength(3); expect(screen.getByRole('button', { name: 'Select Two orientation rooms' }).getAttribute('aria-pressed')).toBe('false');
  });

  it('clears tag filters and selection when returning to Browse all', async () => {
    mockApi(); mount(); await screen.findByRole('button', { name: 'Select Two orientation rooms' });
    fireEvent.click(screen.getByRole('button', { name: 'Search by tags' })); await tag('Bedroom');
    fireEvent.click(screen.getByRole('button', { name: 'Select Four print room' }));
    fireEvent.click(screen.getByRole('button', { name: 'Browse all' }));
    expect(results()).toHaveLength(3); expect(screen.queryByRole('combobox', { name: 'Filter template images by tags' })).toBeNull();
    expect((screen.getByRole('button', { name: 'Add template image' }) as HTMLButtonElement).disabled).toBe(true);
  });

  it('allows attaching an empty saved definition with a clear generation warning', async () => {
    const request = mockApi(), attached = mount();
    fireEvent.click(await screen.findByRole('button', { name: 'Select Empty definition' }));
    expect(screen.getByText(/This definition has no images yet/)).toBeTruthy();
    expect((screen.getByRole('button', { name: 'Add template image' }) as HTMLButtonElement).disabled).toBe(false);
    fireEvent.click(screen.getByRole('button', { name: 'Add template image' }));
    await waitFor(() => expect(attached).toHaveBeenCalledWith({ id: '88', templateImageDefinitionId: 'empty' }));
    expect(request.mock.calls.filter(([, init]) => init?.method)).toHaveLength(1);
  });

  it('requires a selection and at least one product use before attaching', async () => {
    const request = mockApi(); mount(); await screen.findByRole('button', { name: 'Select Two orientation rooms' });
    expect((screen.getByRole('button', { name: 'Add template image' }) as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(screen.getByRole('button', { name: 'Select Two orientation rooms' }));
    fireEvent.click(screen.getByLabelText('Prints')); fireEvent.click(screen.getByLabelText('Digital downloads'));
    const confirm = screen.getByRole('button', { name: 'Add template image' }) as HTMLButtonElement;
    expect(confirm.disabled).toBe(true); fireEvent.click(confirm);
    expect(request.mock.calls.every(([, init]) => !init?.method)).toBe(true);
  });

  it('explains an empty definition library without enabling attachment', async () => {
    mockApi({ definitions: [] }); mount();
    expect(await screen.findByText(/No saved definitions yet/)).toBeTruthy();
    expect(screen.getByRole('link', { name: 'Create a template image' })).toBeTruthy(); expect(results()).toHaveLength(0);
    expect((screen.getByRole('button', { name: 'Add template image' }) as HTMLButtonElement).disabled).toBe(true);
  });

  it('keeps definition-load and attachment errors visible and retains the selected definition for retry', async () => {
    mockApi({ attachError: 'This definition is already attached.' }); const attached = mount();
    fireEvent.click(await screen.findByRole('button', { name: 'Select Two orientation rooms' }));
    fireEvent.click(screen.getByRole('button', { name: 'Add template image' }));
    expect((await screen.findByRole('alert')).textContent).toBe('This definition is already attached.');
    expect(screen.getByText('Selected: Two orientation rooms')).toBeTruthy(); expect(attached).not.toHaveBeenCalled();
    expect((screen.getByRole('button', { name: 'Add template image' }) as HTMLButtonElement).disabled).toBe(false);
  });

  it('shows load failures distinctly and still allows browsing when only the tag catalogue fails', async () => {
    mockApi({ tagsError: 'Tags unavailable.' }); mount();
    await screen.findByRole('button', { name: 'Select Two orientation rooms' });
    fireEvent.click(screen.getByRole('button', { name: 'Search by tags' }));
    expect((await screen.findByRole('alert')).textContent).toContain('Tags unavailable.');
    expect(results()).toHaveLength(3);
  });
});
