import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { SavedTemplateImagePicker } from './SavedTemplateImagePicker';
import type { OurCategoryFormValues } from '@/lib/our-categories';
import type { TemplateImageTag } from '@/lib/our-template-image-tag-types';

afterEach(() => vi.unstubAllGlobals());
const values: OurCategoryFormValues = {
  name: 'Nursery set', templateType: 'multiple', itemCount: 3, followedTemplateId: null, roomTheme: '', backgroundColour: '#F5F0E8',
  printsFrames: true, customisePrints: false, digitalDownload: true, customTop: false, customBottom: false,
  printFrameSectionId: null, customisedSectionId: null, downloadSectionId: null, sizes: {}, frames: {},
};

const tags: TemplateImageTag[] = [{ id: 'nursery', name: 'Nursery' }, { id: 'woodland', name: 'Woodland' }, { id: 'bedroom', name: 'Bedroom' }];
const scenes = [
  { id: 'scene-1', name: 'Two angled frames', width: 1200, height: 800, tags: [tags[0], tags[1]],
    openings: [{ name: 'Left', imageItemNumber: 1 }, { name: 'Right', imageItemNumber: 2 }], updatedAt: '2026-01-01' },
  { id: 'scene-2', name: 'Bright nursery', width: 800, height: 1200, tags: [tags[0]],
    openings: [{ name: 'Centre', imageItemNumber: 1 }], updatedAt: '2026-01-02' },
  { id: 'scene-3', name: 'Oak bedroom', width: 1200, height: 800, tags: [tags[1], tags[2]],
    openings: [{ name: 'Oak frame', imageItemNumber: 1 }], updatedAt: '2026-01-03' },
  { id: 'scene-4', name: 'Soft room', width: 1200, height: 800,
    openings: [{ name: 'Soft frame', imageItemNumber: 1 }], updatedAt: '2026-01-04' },
];

function mockApi(options: { images?: typeof scenes; imagesError?: string; tagsError?: string; attachError?: string } = {}) {
  const fetchMock = vi.fn(async (url: string, request?: RequestInit) => {
    if (url === '/api/our-template-images') return { ok: !options.imagesError, json: async () => options.imagesError ? { error: options.imagesError } : { images: options.images ?? scenes } };
    if (url === '/api/our-template-image-tags') return { ok: !options.tagsError, json: async () => options.tagsError ? { error: options.tagsError } : { tags } };
    if (url === '/api/our-categories/12/templates' && request?.method === 'POST') return { ok: !options.attachError, json: async () => options.attachError ? { error: options.attachError } : { template: { id: '88', ourTemplateImageId: 'scene-1' } } };
    throw new Error(`Unexpected picker request: ${url}`);
  });
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

function mount(onAttached = vi.fn()) {
  render(<SavedTemplateImagePicker categoryId="12" values={values} onClose={vi.fn()} onAttached={onAttached} />);
  return onAttached;
}

async function chooseTag(name: string) {
  const input = screen.getByRole('combobox', { name: 'Filter template images by tags' });
  fireEvent.change(input, { target: { value: name.slice(0, 3) } });
  fireEvent.click(await screen.findByRole('option', { name }));
}

function resultButtons() {
  return within(screen.getByRole('region', { name: 'Saved room scene results' })).queryAllByRole('button', { name: /^Select / });
}

describe('saved template image chooser', () => {
  it('browses thumbnails and attaches the selected scene with the existing product-use settings', async () => {
    const fetchMock = mockApi(); const attached = mount();
    const chosen = await screen.findByRole('button', { name: 'Select Two angled frames' });
    expect(resultButtons()).toHaveLength(4);
    expect(screen.getByRole('button', { name: 'Browse all' }).getAttribute('aria-pressed')).toBe('true');
    expect(screen.getByRole('status').textContent).toBe('4 of 4 template images shown');
    expect((screen.getByRole('button', { name: 'Add scene to template' }) as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(chosen);
    expect(chosen.getAttribute('aria-pressed')).toBe('true');
    expect(screen.getByText('Selected: Two angled frames')).toBeTruthy();
    const preview = screen.getByRole('img', { name: 'Two angled frames' });
    const previewUrl = new URL(preview.getAttribute('src')!, 'http://localhost');
    expect(previewUrl.pathname).toBe('/api/our-template-images/scene-1/image');
    expect(previewUrl.searchParams.get('preview')).toBe('1');
    expect(previewUrl.searchParams.get('v')).toBe('2026-01-01');
    expect(preview.getAttribute('loading')).toBe('lazy'); expect(preview.getAttribute('decoding')).toBe('async');
    expect(preview.getAttribute('width')).toBe('1200'); expect(preview.getAttribute('height')).toBe('800');
    expect(screen.getAllByRole('img').every((image) => new URL(image.getAttribute('src')!, 'http://localhost').searchParams.get('preview') === '1')).toBe(true);
    fireEvent.change(screen.getByLabelText('Image template name'), { target: { value: 'Nursery listing scene' } });
    fireEvent.click(screen.getByRole('button', { name: 'Add scene to template' }));
    await waitFor(() => expect(attached).toHaveBeenCalledWith({ id: '88', ourTemplateImageId: 'scene-1' }));
    const [url, options] = fetchMock.mock.calls.find(([, request]) => request?.method === 'POST')!;
    expect(url).toBe('/api/our-categories/12/templates');
    const form = options?.body as FormData;
    expect(form.get('ourTemplateImageId')).toBe('scene-1'); expect(form.has('file')).toBe(false);
    expect(form.get('name')).toBe('Nursery listing scene');
    expect(form.get('useOnPrints')).toBe('true'); expect(form.get('useOnCustomised')).toBe('false'); expect(form.get('useOnDigital')).toBe('true');
  });

  it('matches every selected tag, combines tags with a name filter, and clears empty-result filters', async () => {
    const fetchMock = mockApi(); mount();
    await screen.findByRole('button', { name: 'Select Two angled frames' });
    fireEvent.click(screen.getByRole('button', { name: 'Search by tags' }));
    await chooseTag('Nursery');
    expect(resultButtons().map((button) => button.getAttribute('aria-label'))).toEqual(['Select Two angled frames', 'Select Bright nursery']);
    await chooseTag('Woodland');
    expect(resultButtons().map((button) => button.getAttribute('aria-label'))).toEqual(['Select Two angled frames']);
    expect(screen.getByText(/Matches all selected tags/)).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Select Two angled frames' }));
    fireEvent.change(screen.getByLabelText('Search template images by name'), { target: { value: 'bright' } });
    expect(resultButtons()).toHaveLength(0);
    expect(screen.getByText('No template images match these filters.')).toBeTruthy();
    expect(screen.getByRole('status').textContent).toBe('0 of 4 template images shown');
    expect((screen.getByRole('button', { name: 'Add scene to template' }) as HTMLButtonElement).disabled).toBe(true);
    expect(screen.queryByText('Selected: Two angled frames')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Clear filters' }));
    expect(resultButtons()).toHaveLength(4);
    expect(screen.queryByRole('button', { name: 'Remove tag Nursery' })).toBeNull();
    expect(fetchMock.mock.calls.every(([, request]) => request?.method !== 'POST')).toBe(true);
  });

  it('filters names without regard to case and does not restore a hidden selection when the filter is removed', async () => {
    mockApi(); mount();
    fireEvent.click(await screen.findByRole('button', { name: 'Select Two angled frames' }));
    fireEvent.change(screen.getByLabelText('Search template images by name'), { target: { value: ' NURSERY ' } });
    expect(resultButtons()).toHaveLength(1);
    expect(screen.getByRole('button', { name: 'Select Bright nursery' })).toBeTruthy();
    expect((screen.getByRole('button', { name: 'Add scene to template' }) as HTMLButtonElement).disabled).toBe(true);
    fireEvent.change(screen.getByLabelText('Search template images by name'), { target: { value: '' } });
    expect(screen.getByRole('button', { name: 'Select Two angled frames' }).getAttribute('aria-pressed')).toBe('false');
    expect((screen.getByRole('button', { name: 'Add scene to template' }) as HTMLButtonElement).disabled).toBe(true);
  });

  it('returns to all scenes and clears old tag filters and selection when changing browse mode', async () => {
    mockApi(); mount();
    await screen.findByRole('button', { name: 'Select Two angled frames' });
    fireEvent.click(screen.getByRole('button', { name: 'Search by tags' }));
    await chooseTag('Bedroom');
    fireEvent.click(screen.getByRole('button', { name: 'Select Oak bedroom' }));
    fireEvent.click(screen.getByRole('button', { name: 'Browse all' }));
    expect(resultButtons()).toHaveLength(4);
    expect(screen.getByRole('button', { name: 'Select Oak bedroom' }).getAttribute('aria-pressed')).toBe('false');
    expect(screen.queryByRole('combobox', { name: 'Filter template images by tags' })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Search by tags' }));
    expect(screen.queryByRole('button', { name: 'Remove tag Bedroom' })).toBeNull();
    expect(resultButtons()).toHaveLength(4);
  });

  it('blocks an incompatible artwork assignment and recovers when another thumbnail is selected', async () => {
    const tooMany = { ...scenes[0], id: 'too-many', name: 'Five artwork frames', openings: [{ name: 'Far frame', imageItemNumber: 5 }] };
    const fetchMock = mockApi({ images: [tooMany, scenes[0]] }); mount();
    fireEvent.click(await screen.findByRole('button', { name: 'Select Five artwork frames' }));
    expect(screen.getByRole('alert').textContent).toContain('uses artwork item 5');
    expect((screen.getByRole('button', { name: 'Add scene to template' }) as HTMLButtonElement).disabled).toBe(true);
    expect(fetchMock.mock.calls.some(([, request]) => request?.method === 'POST')).toBe(false);
    fireEvent.click(screen.getByRole('button', { name: 'Select Two angled frames' }));
    expect(screen.queryByRole('alert')).toBeNull();
    expect((screen.getByRole('button', { name: 'Add scene to template' }) as HTMLButtonElement).disabled).toBe(false);
    fireEvent.click(screen.getByLabelText('Prints')); fireEvent.click(screen.getByLabelText('Digital downloads'));
    expect((screen.getByRole('button', { name: 'Add scene to template' }) as HTMLButtonElement).disabled).toBe(true);
  });

  it('explains an empty library and keeps attachment disabled', async () => {
    mockApi({ images: [] }); mount();
    expect(await screen.findByRole('link', { name: 'Create a template image' })).toBeTruthy();
    expect(screen.getByText(/No saved scenes yet/)).toBeTruthy();
    expect(resultButtons()).toHaveLength(0);
    expect((screen.getByRole('button', { name: 'Add scene to template' }) as HTMLButtonElement).disabled).toBe(true);
  });

  it('shows a scene-load error without suggesting that the library is empty', async () => {
    mockApi({ imagesError: 'Room images are unavailable.' }); mount();
    expect((await screen.findByRole('alert')).textContent).toBe('Room images are unavailable.');
    expect(screen.queryByText(/No saved scenes yet/)).toBeNull();
    expect((screen.getByRole('button', { name: 'Add scene to template' }) as HTMLButtonElement).disabled).toBe(true);
  });

  it('continues thumbnail browsing when the tag catalogue fails', async () => {
    mockApi({ tagsError: 'Tags are unavailable.' }); mount();
    await screen.findByRole('button', { name: 'Select Two angled frames' });
    fireEvent.click(screen.getByRole('button', { name: 'Search by tags' }));
    expect((await screen.findByRole('alert')).textContent).toContain('Tags are unavailable. You can still browse all scenes.');
    expect(resultButtons()).toHaveLength(4);
    fireEvent.click(screen.getByRole('button', { name: 'Browse all' }));
    fireEvent.click(screen.getByRole('button', { name: 'Select Two angled frames' }));
    expect((screen.getByRole('button', { name: 'Add scene to template' }) as HTMLButtonElement).disabled).toBe(false);
  });

  it('keeps a selected room available to retry when attaching fails', async () => {
    mockApi({ attachError: 'This room is already attached.' }); const attached = mount();
    fireEvent.click(await screen.findByRole('button', { name: 'Select Two angled frames' }));
    fireEvent.click(screen.getByRole('button', { name: 'Add scene to template' }));
    expect((await screen.findByRole('alert')).textContent).toBe('This room is already attached.');
    expect(attached).not.toHaveBeenCalled();
    expect(screen.getByRole('button', { name: 'Select Two angled frames' }).getAttribute('aria-pressed')).toBe('true');
    expect((screen.getByRole('button', { name: 'Add scene to template' }) as HTMLButtonElement).disabled).toBe(false);
  });
});
