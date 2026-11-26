import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import type { OurTemplateImageForegroundMask } from '@/lib/our-template-image-types';
import { SceneEditorTestHarness as OurTemplateImagesClient } from './scene-editor-test-harness';
import type { SceneImage } from './SceneImageEditor';

const painted: OurTemplateImageForegroundMask = { version: 1, strokes: [{
  mode: 'paint', size: 14, softness: 0.25, points: [{ x: 80, y: 40 }, { x: 82, y: 42 }],
}] };
vi.mock('./ForegroundMaskEditor', () => ({ ForegroundMaskEditor: ({ mask, openingCorners, onChange, onClose }: {
  mask?: OurTemplateImageForegroundMask; openingCorners?: unknown[]; onChange(mask: OurTemplateImageForegroundMask): void; onClose(): void;
}) => <div role="dialog" aria-label="Keep in front editor"><p>Existing strokes: {mask?.strokes.length ?? 0}</p>
  <p>Opening guides: {openingCorners?.length ?? 0}</p>
  <button onClick={() => onChange({ version: 1, strokes: [{ mode: 'paint', size: 14, softness: 0.25, points: [{ x: 80, y: 40 }, { x: 82, y: 42 }] }] })}>Paint a foreground object</button>
  <button onClick={onClose}>Back to template image</button></div> }));
vi.mock('./ForegroundMaskPreview', () => ({ ForegroundMaskPreview: () => null }));

function scene(mask?: OurTemplateImageForegroundMask): SceneImage {
  return { id: '10', name: 'Nursery', originalFileName: 'room.png', width: 120, height: 80,
    createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z', lightingMode: 'opaque',
    foregroundMask: mask, openings: [{ id: 'frame', name: 'Print', imageItemNumber: 1, ratio: '2x3', orientation: 'portrait',
      corners: { topLeft: { x: 20, y: 10 }, topRight: { x: 80, y: 10 }, bottomRight: { x: 80, y: 70 }, bottomLeft: { x: 20, y: 70 } },
      placements: { '2x3:portrait': { x: -0.5, y: -0.25, width: 2 } } }],
  };
}
const json = (payload: unknown) => ({ ok: true, json: async () => payload });
afterEach(() => vi.unstubAllGlobals());

describe('foreground masks in the scene editor', () => {
  it('keeps painting local until Save and restores it when reopening the scene', async () => {
    let stored = scene();
    const corners = structuredClone(stored.openings[0].corners);
    const request = vi.fn(async (_url: string, options?: RequestInit) => {
      if (options?.method === 'PATCH') {
        stored = { ...stored, ...JSON.parse(String((options.body as FormData).get('definition'))) };
        return json({ image: stored });
      }
      return json({ images: [stored] });
    });
    vi.stubGlobal('fetch', request);
    render(<OurTemplateImagesClient />);
    fireEvent.click(await screen.findByRole('button', { name: 'Edit Nursery' }));
    fireEvent.click(screen.getByRole('button', { name: 'Keep in front' }));
    expect(screen.getByText('Opening guides: 1')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Paint a foreground object' }));
    expect(request.mock.calls.filter(([, options]) => options?.method)).toHaveLength(0);
    fireEvent.click(screen.getByRole('button', { name: 'Back to template image' }));
    expect(screen.getByText(/Foreground protection is configured/)).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Save template image' }));
    await screen.findByRole('button', { name: 'Edit Nursery' });
    expect(stored.foregroundMask).toEqual(painted);
    expect(stored.openings[0].corners).toEqual(corners);
    fireEvent.click(screen.getByRole('button', { name: 'Edit Nursery' }));
    fireEvent.click(screen.getByRole('button', { name: 'Keep in front' }));
    expect(screen.getByText('Existing strokes: 1')).toBeTruthy();
  });

  it.each([
    { name: 'painted mask', mask: painted },
    { name: 'smart selection', mask: { version: 1 as const, strokes: [{ mode: 'paint' as const, size: 1, softness: 0, points: [],
      region: { width: 120, height: 80, runs: [[4875, 10, 255] as [number, number, number]] } }] } },
  ])('preserves the $name when fitting paper in Test or correcting opening corners', async ({ mask }) => {
    let stored = scene(mask);
    const request = vi.fn(async (url: string, options?: RequestInit) => {
      if (url.endsWith('/samples')) return json({ artworks: [] });
      if (options?.method === 'PATCH') {
        stored = { ...stored, ...JSON.parse(String((options.body as FormData).get('definition'))) };
        return json({ image: stored });
      }
      return json({ images: [stored] });
    });
    vi.stubGlobal('fetch', request);
    render(<OurTemplateImagesClient />);
    fireEvent.click(await screen.findByRole('button', { name: 'Test Nursery' }));
    fireEvent.click(screen.getByRole('button', { name: 'Fit artwork to openings' }));
    await screen.findByText(/Artwork fitted to the openings/);
    expect(stored.foregroundMask).toEqual(mask);
    fireEvent.click(screen.getAllByRole('button', { name: 'Close' })[0]);
    fireEvent.click(screen.getByRole('button', { name: 'Edit Nursery' }));
    fireEvent.keyDown(screen.getByRole('button', { name: 'Top left corner of Print' }), { key: 'ArrowRight' });
    fireEvent.click(screen.getByRole('button', { name: 'Save template image' }));
    await waitFor(() => expect(stored.openings[0].corners.topLeft.x).toBe(21));
    expect(stored.foregroundMask).toEqual(mask);
  });
});
