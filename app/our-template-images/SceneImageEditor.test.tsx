import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { SceneEditorTestHarness as OurTemplateImagesClient } from './scene-editor-test-harness';
import type { SceneImage } from './SceneImageEditor';
import { defaultPaperPlacement, estimateOpeningAspect, paperPlacementHeight } from '@/lib/our-template-image-geometry';

function scene(): SceneImage {
  return {
    id: '10', name: 'Nursery', originalFileName: 'nursery.png', createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z',
    width: 1200, height: 800, lightingMode: 'auto',
    openings: [{ id: 'left', name: 'Left frame', imageItemNumber: 1, ratio: 'iso-a1', orientation: 'portrait',
      corners: { topLeft: { x: 100, y: 100 }, topRight: { x: 350, y: 120 }, bottomRight: { x: 340, y: 520 }, bottomLeft: { x: 110, y: 500 } },
      placements: { 'iso-a1:portrait': { x: -0.2, y: -0.3, width: 1.7 } } },
    { id: 'right', name: 'Right frame', imageItemNumber: 2, ratio: '4x5', orientation: 'portrait',
      corners: { topLeft: { x: 650, y: 100 }, topRight: { x: 950, y: 130 }, bottomRight: { x: 940, y: 530 }, bottomLeft: { x: 660, y: 500 } },
      placements: {} }],
  };
}
const json = (payload: unknown) => ({ ok: true, json: async () => payload });

describe('preserved scene editor controls', () => {
  beforeEach(() => {
    window.history.replaceState({}, '', '/our-template-images');
    Object.defineProperty(URL, 'createObjectURL', { configurable: true, value: vi.fn(() => 'blob:test-room') });
    Object.defineProperty(URL, 'revokeObjectURL', { configurable: true, value: vi.fn() });
  });
  afterEach(() => vi.unstubAllGlobals());

  it('assigns and removes shared tags when saving and reopening without changing opening geometry', async () => {
    const nursery = { id: 'tag-nursery', name: 'Nursery' };
    const dinosaurs = { id: 'tag-dinosaurs', name: 'Dinosaurs' };
    const catalogue = [nursery, dinosaurs];
    let saved = { ...scene(), tags: [nursery] };
    const originalOpenings = structuredClone(saved.openings);
    const request = vi.fn(async (url: string, options?: RequestInit) => {
      if (url === '/api/our-template-image-tags') return json({ tags: catalogue });
      if (options?.method === 'PATCH') {
        const body = options.body as FormData;
        saved = { ...saved, tags: JSON.parse(String(body.get('tagIds'))).map((id: string) => catalogue.find((tag) => tag.id === id)!) };
        return json({ image: saved });
      }
      return json({ images: [saved] });
    });
    vi.stubGlobal('fetch', request);
    render(<OurTemplateImagesClient />);
    fireEvent.click(await screen.findByRole('button', { name: 'Edit Nursery' }));
    const input = screen.getByRole('combobox', { name: 'Tags' });
    fireEvent.change(input, { target: { value: 'saur' } });
    fireEvent.click(await screen.findByRole('option', { name: 'Dinosaurs' }));
    fireEvent.click(screen.getByRole('button', { name: 'Save template image' }));
    await screen.findByRole('button', { name: 'Edit Nursery' });
    expect(saved.tags).toEqual([nursery, dinosaurs]);
    const firstSave = request.mock.calls.find(([, options]) => options?.method === 'PATCH')![1]!.body as FormData;
    expect(JSON.parse(String(firstSave.get('definition'))).openings).toEqual(originalOpenings);
    fireEvent.click(screen.getByRole('button', { name: 'Edit Nursery' }));
    fireEvent.click(screen.getByRole('button', { name: /Remove.*Dinosaurs/i }));
    fireEvent.click(screen.getByRole('button', { name: 'Save template image' }));
    await screen.findByRole('button', { name: 'Edit Nursery' });
    expect(saved.tags).toEqual([nursery]);
  });

  it('restores a ratio placement and preserves its relative zoom and pan through a saved corner correction', async () => {
    let stored = scene(); let submitted: SceneImage | undefined;
    const fetchMock = vi.fn(async (_url: string, options?: RequestInit) => {
      if (options?.method === 'PATCH') {
        const form = options.body as FormData;
        submitted = { ...stored, ...JSON.parse(String(form.get('definition'))), name: String(form.get('name')) };
        stored = submitted!; return json({ image: stored });
      }
      return json({ images: [stored] });
    });
    vi.stubGlobal('fetch', fetchMock);
    render(<OurTemplateImagesClient />);
    fireEvent.click(await screen.findByRole('button', { name: 'Edit Nursery' }));
    expect((screen.getByLabelText('Paper horizontal') as HTMLInputElement).value).toBe('-0.2');
    fireEvent.change(screen.getByLabelText('Paper ratio'), { target: { value: '2x3' } });
    fireEvent.change(screen.getByLabelText('Paper zoom'), { target: { value: '2' } });
    fireEvent.change(screen.getByLabelText('Paper ratio'), { target: { value: 'iso-a1' } });
    expect((screen.getByLabelText('Paper horizontal') as HTMLInputElement).value).toBe('-0.2');
    expect((screen.getByLabelText('Paper vertical') as HTMLInputElement).value).toBe('-0.3');
    fireEvent.keyDown(screen.getByRole('button', { name: 'Top left corner of Left frame' }), { key: 'ArrowRight' });
    fireEvent.click(screen.getByRole('button', { name: 'Save template image' }));
    await screen.findByRole('button', { name: 'Edit Nursery' });
    expect(submitted?.openings[0].corners.topLeft).toEqual({ x: 101, y: 100 });
    const before = scene();
    const oldAspect = estimateOpeningAspect(before.openings[0].corners, before.width, before.height);
    const newAspect = estimateOpeningAspect(submitted!.openings[0].corners, before.width, before.height);
    const placement = submitted!.openings[0].placements['iso-a1:portrait']!;
    expect(placement.width / defaultPaperPlacement(newAspect, 'iso-a1', 'portrait').width)
      .toBeCloseTo(1.7 / defaultPaperPlacement(oldAspect, 'iso-a1', 'portrait').width, 10);
    expect(placement.x / (1 - placement.width)).toBeCloseTo(-0.2 / (1 - 1.7), 10);
    expect(placement.y / (1 - paperPlacementHeight(placement, newAspect, 'iso-a1', 'portrait')))
      .toBeCloseTo(-0.3 / (1 - paperPlacementHeight({ x: -0.2, y: -0.3, width: 1.7 }, oldAspect, 'iso-a1', 'portrait')), 10);
    expect(submitted!.openings[0].placements['2x3:portrait']!.width / defaultPaperPlacement(newAspect, '2x3', 'portrait').width)
      .toBeCloseTo(2 / defaultPaperPlacement(oldAspect, '2x3', 'portrait').width, 10);
    fireEvent.click(screen.getByRole('button', { name: 'Edit Nursery' }));
    expect((screen.getByRole('button', { name: 'Top left corner of Left frame' }) as HTMLElement).style.left).toBe(`${101 / 1200 * 100}%`);
    expect(Number((screen.getByLabelText('Paper horizontal') as HTMLInputElement).value)).toBeCloseTo(placement.x, 4);
  });

  it('retains the first opening when clicking a second frame and supports a different artwork assignment', async () => {
    const saved = scene(); saved.width = 120; saved.height = 80;
    saved.openings = [{ ...saved.openings[0], corners: { topLeft: { x: 10, y: 10 }, topRight: { x: 35, y: 10 }, bottomRight: { x: 35, y: 55 }, bottomLeft: { x: 10, y: 55 } } }];
    let submitted: SceneImage | undefined;
    vi.stubGlobal('fetch', vi.fn(async (_url: string, options?: RequestInit) => {
      if (options?.method === 'PATCH') { submitted = { ...saved, ...JSON.parse(String((options.body as FormData).get('definition'))) }; return json({ image: submitted }); }
      return json({ images: [saved] });
    }));
    vi.stubGlobal('PointerEvent', MouseEvent);
    const rgba = new Uint8ClampedArray(120 * 80 * 4); rgba.fill(255);
    for (let y = 12; y < 58; y++) for (let x = 70; x < 100; x++) rgba[(y * 120 + x) * 4 + 3] = 0;
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue({ drawImage: vi.fn(), getImageData: () => ({ data: rgba }) } as unknown as CanvasRenderingContext2D);
    render(<OurTemplateImagesClient />);
    fireEvent.click(await screen.findByRole('button', { name: 'Edit Nursery' }));
    const image = screen.getByAltText('Room scene opening editor');
    Object.defineProperty(image, 'naturalWidth', { configurable: true, value: 120 }); Object.defineProperty(image, 'naturalHeight', { configurable: true, value: 80 });
    fireEvent.load(image);
    const stage = image.parentElement!;
    vi.spyOn(stage, 'getBoundingClientRect').mockReturnValue({ left: 0, top: 0, width: 600, height: 400, right: 600, bottom: 400, x: 0, y: 0, toJSON: () => ({}) });
    fireEvent.pointerDown(stage, { clientX: 425, clientY: 175, button: 0 });
    expect(screen.getByRole('heading', { name: 'Openings (2)' })).toBeTruthy();
    fireEvent.change(screen.getByLabelText('Artwork item'), { target: { value: '2' } });
    fireEvent.change(screen.getByLabelText('Opening name'), { target: { value: 'New right frame' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save template image' }));
    await waitFor(() => expect(submitted).toBeTruthy());
    expect(submitted!.openings[0].corners).toEqual(saved.openings[0].corners);
    expect(submitted!.openings[1].corners).toEqual({ topLeft: { x: 70, y: 12 }, topRight: { x: 99, y: 12 }, bottomRight: { x: 99, y: 57 }, bottomLeft: { x: 70, y: 57 } });
    expect(submitted!.openings.map((opening) => opening.imageItemNumber)).toEqual([1, 2]);
  });

  it('zooms a corner on double-click and saves close-up pixel corrections in original coordinates', async () => {
    let stored = scene(); let submitted: SceneImage | undefined;
    const original = structuredClone(stored);
    const fetchMock = vi.fn(async (_url: string, options?: RequestInit) => {
      if (options?.method === 'PATCH') {
        submitted = { ...stored, ...JSON.parse(String((options.body as FormData).get('definition'))) };
        stored = submitted!; return json({ image: stored });
      }
      return json({ images: [stored] });
    });
    vi.stubGlobal('fetch', fetchMock);
    render(<OurTemplateImagesClient />);
    fireEvent.click(await screen.findByRole('button', { name: 'Edit Nursery' }));
    fireEvent.dblClick(screen.getByRole('button', { name: 'Top left corner of Left frame' }));
    const detail = await screen.findByRole('button', { name: 'Top left corner of Left frame in close-up' });
    expect(screen.getByLabelText('Corner magnification')).toBeTruthy();
    fireEvent.keyDown(detail, { key: 'ArrowRight' });
    fireEvent.keyDown(detail, { key: 'ArrowDown' });
    fireEvent.change(screen.getByLabelText('Corner magnification'), { target: { value: '8' } });
    expect(screen.getByText('X 101 · Y 101 (original pixels)')).toBeTruthy();
    fireEvent.dblClick(detail);
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(screen.getByRole('button', { name: 'Top left corner of Left frame' }).style.left).toBe(`${101 / 1200 * 100}%`);
    expect(fetchMock.mock.calls.filter(([, options]) => options?.method)).toHaveLength(0);
    fireEvent.click(screen.getByRole('button', { name: 'Save template image' }));
    await screen.findByRole('button', { name: 'Edit Nursery' });
    expect(submitted!.openings[0].corners).toEqual({ ...original.openings[0].corners, topLeft: { x: 101, y: 101 } });
    expect(submitted!.openings[1]).toEqual(original.openings[1]);
    expect(submitted!.openings).toHaveLength(2);
    fireEvent.click(screen.getByRole('button', { name: 'Edit Nursery' }));
    fireEvent.keyDown(screen.getByRole('button', { name: 'Top left corner of Left frame' }), { key: 'Enter' });
    expect(await screen.findByText('X 101 · Y 101 (original pixels)')).toBeTruthy();
  });

  it('rejects a corner crossing that would invalidate the opening instead of crashing the editor', async () => {
    const saved = scene(); saved.openings[0].corners.topLeft = { x: 349, y: 120 };
    // Moving the top-left point across the top-right point would create a crossed quad.
    vi.stubGlobal('fetch', vi.fn(async () => json({ images: [saved] })));
    render(<OurTemplateImagesClient />);
    fireEvent.click(await screen.findByRole('button', { name: 'Edit Nursery' }));
    fireEvent.keyDown(screen.getByRole('button', { name: 'Top left corner of Left frame' }), { key: 'ArrowRight' });
    expect(screen.getByRole('button', { name: 'Top left corner of Left frame' }).style.left).toBe(`${349 / 1200 * 100}%`);
  });

  it('shows each artwork assignment and sends chosen listings to the shared Test endpoint only', async () => {
    const fetchMock = vi.fn(async (url: string, options?: RequestInit) => {
      if (url.endsWith('/samples')) return json({ artworks: [{ id: '101', name: 'Bunny print' }, { id: '102', name: 'Bear print' }] });
      if (url.endsWith('/test')) return { ok: true, blob: async () => new Blob(['preview'], { type: 'image/png' }) };
      return json({ images: [scene()] });
    });
    vi.stubGlobal('fetch', fetchMock);
    render(<OurTemplateImagesClient />);
    fireEvent.click(await screen.findByRole('button', { name: 'Test Nursery' }));
    await screen.findAllByRole('option', { name: 'Bunny print' });
    expect(screen.getByText(/Feeds Left frame/)).toBeTruthy(); expect(screen.getByText(/Feeds Right frame/)).toBeTruthy();
    fireEvent.change(screen.getByLabelText('Or choose existing artwork 1'), { target: { value: '101' } });
    fireEvent.change(screen.getByLabelText('Or choose existing artwork 2'), { target: { value: '102' } });
    fireEvent.click(screen.getByRole('button', { name: 'Render test preview' }));
    await screen.findByAltText('Completed room preview for Nursery');
    const testCall = fetchMock.mock.calls.find(([url]) => url.endsWith('/test'))!;
    expect((testCall[1]?.body as FormData).get('listing-1')).toBe('101');
    expect((testCall[1]?.body as FormData).get('listing-2')).toBe('102');
    expect(fetchMock.mock.calls.filter(([, options]) => options?.method && options.method !== 'GET').map(([url]) => url)).toEqual(['/api/our-template-images/10/test']);
  });

  it('fits enlarged artwork to each opening and saves matching listing-generation placements', async () => {
    const initial = scene();
    initial.openings[0].placements['iso-a1:portrait'] = { x: -0.885, y: 0, width: 2.77 };
    initial.openings[0].placements['2x3:portrait'] = { x: -0.25, y: -0.5, width: 2 };
    let submitted: SceneImage | undefined;
    const fetchMock = vi.fn(async (url: string, options?: RequestInit) => {
      if (url.endsWith('/samples')) return json({ artworks: [] });
      if (options?.method === 'PATCH') {
        submitted = { ...initial, ...JSON.parse(String((options.body as FormData).get('definition'))) };
        return json({ image: submitted });
      }
      return json({ images: [initial] });
    });
    vi.stubGlobal('fetch', fetchMock);
    render(<OurTemplateImagesClient />);
    fireEvent.click(await screen.findByRole('button', { name: 'Test Nursery' }));
    fireEvent.click(screen.getByRole('button', { name: 'Fit artwork to openings' }));
    await screen.findByText(/Artwork fitted to the openings/);
    const fitted = submitted!.openings[0].placements['iso-a1:portrait']!;
    expect(fitted.width).toBeLessThan(2.77);
    expect(fitted.x).toBeCloseTo((1 - fitted.width) / 2);
    expect(submitted!.openings.map(({ corners }) => corners)).toEqual(initial.openings.map(({ corners }) => corners));
    expect(submitted!.openings[0].placements['2x3:portrait']).toEqual({ x: -0.25, y: -0.5, width: 2 });
    expect(fetchMock.mock.calls.filter(([, options]) => options?.method).map(([url]) => url)).toEqual(['/api/our-template-images/10']);
  });


});
