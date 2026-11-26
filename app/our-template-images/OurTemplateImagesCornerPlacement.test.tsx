import { fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { TemplateOpeningCorners } from '@/lib/our-category-template-composite';
import { estimateOpeningAspect, PAPER_RATIOS, placementKey } from '@/lib/our-template-image-geometry';
import type { OurTemplateImageOpening, PaperPlacement, PaperPlacementKey } from '@/lib/our-template-image-types';
import { SceneEditorTestHarness as OurTemplateImagesClient } from './scene-editor-test-harness';
import type { SceneImage } from './SceneImageEditor';

const originalCorners: TemplateOpeningCorners = {
  topLeft: { x: 1689, y: 489 }, topRight: { x: 2492, y: 488 },
  bottomRight: { x: 2489, y: 1662 }, bottomLeft: { x: 1689, y: 1663 },
};
type Intent = { zoom: number; horizontalPan: number; verticalPan: number };

function paperAspect(ratio: OurTemplateImageOpening['ratio'], orientation: OurTemplateImageOpening['orientation']) {
  const spec = PAPER_RATIOS.find((item) => item.key === ratio)!;
  return orientation === 'portrait' ? spec.width / spec.height : spec.height / spec.width;
}

function configuredPlacement(corners: TemplateOpeningCorners, ratio: OurTemplateImageOpening['ratio'], orientation: OurTemplateImageOpening['orientation'], intent: Intent): PaperPlacement {
  const openingAspect = estimateOpeningAspect(corners, 4096, 4096);
  const targetAspect = paperAspect(ratio, orientation);
  const width = Math.max(1, targetAspect / openingAspect) * intent.zoom;
  const height = width * openingAspect / targetAspect;
  return { width, x: (1 - width) * intent.horizontalPan, y: (1 - height) * intent.verticalPan };
}

function scene(opening: OurTemplateImageOpening): SceneImage {
  return { id: 'cosy', name: 'Cosy room', originalFileName: 'cosy.png', createdAt: '2026-11-19T12:00:00.000Z', updatedAt: '2026-11-19T12:00:00.000Z',
    width: 4096, height: 4096, lightingMode: 'opaque', openings: [opening], tags: [] };
}

function savedSceneHarness(initial: SceneImage) {
  let stored = structuredClone(initial);
  const saves: SceneImage[] = [];
  const request = vi.fn(async (url: string, options?: RequestInit) => {
    if (url === '/api/our-template-image-tags') return { ok: true, json: async () => ({ tags: [] }) };
    if (options?.method === 'PATCH') {
      const form = options.body as FormData;
      stored = { ...stored, ...JSON.parse(String(form.get('definition'))), name: String(form.get('name')) };
      saves.push(structuredClone(stored));
      return { ok: true, json: async () => ({ image: structuredClone(stored) }) };
    }
    if (url === '/api/our-template-images') return { ok: true, json: async () => ({ images: [structuredClone(stored)] }) };
    throw new Error(`Unexpected request in the corner placement test: ${url}`);
  });
  vi.stubGlobal('fetch', request);
  return { saves, request };
}

function stage() {
  const element = screen.getByAltText('Room scene opening editor').parentElement!;
  vi.spyOn(element, 'getBoundingClientRect').mockReturnValue({ left: 10, top: 20, x: 10, y: 20, width: 1024, height: 1024, right: 1034, bottom: 1044, toJSON: () => ({}) });
}

function dragBottomRight(from: { x: number; y: number }, to: { x: number; y: number }) {
  const handle = screen.getByRole('button', { name: 'Bottom right corner of Main frame' });
  fireEvent.pointerDown(handle, { button: 0, pointerId: 1, clientX: 10 + from.x / 4, clientY: 20 + from.y / 4 });
  fireEvent.pointerMove(handle, { pointerId: 1, clientX: 10 + to.x / 4, clientY: 20 + to.y / 4 });
  fireEvent.pointerUp(handle, { pointerId: 1, clientX: 10 + to.x / 4, clientY: 20 + to.y / 4 });
}

function expectVisibleZoom(percent: number) {
  expect(within(screen.getByLabelText('Paper zoom').closest('label')!).getByText(`${percent}%`)).toBeTruthy();
}

async function saveAndReopen() {
  fireEvent.click(screen.getByRole('button', { name: 'Save template image' }));
  fireEvent.click(await screen.findByRole('button', { name: 'Edit Cosy room' }));
  stage();
}

describe('opening corner corrections preserve paper placement', () => {
  beforeEach(() => {
    window.history.replaceState({}, '', '/our-template-images');
    vi.stubGlobal('PointerEvent', MouseEvent);
    Object.defineProperty(HTMLElement.prototype, 'setPointerCapture', { configurable: true, value: vi.fn() });
    Object.defineProperty(HTMLElement.prototype, 'releasePointerCapture', { configurable: true, value: vi.fn() });
  });
  afterEach(() => vi.unstubAllGlobals());

  it('preserves intentional relative zoom and pan for every saved ratio after a corner drag, save/reopen and reversal', async () => {
    const opening: OurTemplateImageOpening = { id: 'frame', name: 'Main frame', corners: originalCorners, imageItemNumber: 1,
      ratio: 'iso-a1', orientation: 'portrait', placements: {} };
    const intents = new Map<PaperPlacementKey, Intent>();
    for (const [index, spec] of PAPER_RATIOS.entries()) for (const orientation of ['portrait', 'landscape'] as const) {
      const key = placementKey(spec.key, orientation);
      const intent = { zoom: key === 'iso-a1:portrait' ? 2 : 1.25 + index / 10,
        horizontalPan: orientation === 'portrait' ? 0.2 : 0.7, verticalPan: orientation === 'portrait' ? 0.8 : 0.3 };
      intents.set(key, intent);
      opening.placements[key] = configuredPlacement(originalCorners, spec.key, orientation, intent);
    }
    const initialPlacements = structuredClone(opening.placements);
    const harness = savedSceneHarness(scene(opening));
    render(<OurTemplateImagesClient />);
    fireEvent.click(await screen.findByRole('button', { name: 'Edit Cosy room' }));
    stage(); expectVisibleZoom(200);
    const corrected = { x: 2689, y: 1762 };
    dragBottomRight(originalCorners.bottomRight, corrected);
    expectVisibleZoom(200);
    await saveAndReopen();
    expect(harness.saves[0].openings[0].corners.bottomRight).toEqual(corrected);
    const correctedOpening = harness.saves[0].openings[0];
    expect(Object.keys(correctedOpening.placements)).toHaveLength(12);
    const correctedAspect = estimateOpeningAspect(correctedOpening.corners, 4096, 4096);
    for (const [key, intent] of intents) {
      const [ratio, orientation] = key.split(':') as [OurTemplateImageOpening['ratio'], OurTemplateImageOpening['orientation']];
      const placement = correctedOpening.placements[key]!;
      const aspect = paperAspect(ratio, orientation);
      const minimumWidth = Math.max(1, aspect / correctedAspect);
      expect(placement.width / minimumWidth).toBeCloseTo(intent.zoom, 9);
      expect(placement.x / (1 - placement.width)).toBeCloseTo(intent.horizontalPan, 9);
      expect(placement.y / (1 - placement.width * correctedAspect / aspect)).toBeCloseTo(intent.verticalPan, 9);
    }
    expectVisibleZoom(200);
    expect(screen.getByRole('button', { name: 'Bottom right corner of Main frame' }).style.left).toBe(`${corrected.x / 4096 * 100}%`);
    fireEvent.change(screen.getByLabelText('Paper ratio'), { target: { value: '4x5' } });
    fireEvent.change(screen.getByLabelText('Paper orientation'), { target: { value: 'landscape' } });
    expectVisibleZoom(155);
    fireEvent.change(screen.getByLabelText('Paper ratio'), { target: { value: 'iso-a1' } });
    fireEvent.change(screen.getByLabelText('Paper orientation'), { target: { value: 'portrait' } });
    expectVisibleZoom(200);
    dragBottomRight(corrected, originalCorners.bottomRight);
    expectVisibleZoom(200);
    await saveAndReopen();
    expect(harness.saves[1].openings[0].corners).toEqual(originalCorners);
    for (const key of intents.keys()) {
      const restored = harness.saves[1].openings[0].placements[key]!;
      expect(restored.width).toBeCloseTo(initialPlacements[key]!.width, 8);
      expect(restored.x).toBeCloseTo(initialPlacements[key]!.x, 8);
      expect(restored.y).toBeCloseTo(initialPlacements[key]!.y, 8);
    }
  });

  it('keeps a real Cosy one-pixel correction at centred 100% zoom and retains it after save/reopen', async () => {
    const ratio = '5x7';
    const placement = configuredPlacement(originalCorners, ratio, 'portrait', { zoom: 1, horizontalPan: 0.5, verticalPan: 0.5 });
    const initial = scene({ id: 'frame', name: 'Main frame', corners: originalCorners, imageItemNumber: 1, ratio,
      orientation: 'portrait', placements: { '5x7:portrait': placement } });
    const harness = savedSceneHarness(initial);
    render(<OurTemplateImagesClient />);
    fireEvent.click(await screen.findByRole('button', { name: 'Edit Cosy room' }));
    stage(); expectVisibleZoom(100);
    const corrected = { x: 2488, y: 1662 };
    dragBottomRight(originalCorners.bottomRight, corrected);
    expectVisibleZoom(100);
    expect(Number((screen.getByLabelText('Paper zoom') as HTMLInputElement).value)).toBeLessThan(1.05);
    await saveAndReopen();
    const saved = harness.saves[0].openings[0];
    expect(saved.corners.bottomRight).toEqual(corrected);
    const actualPlacement = saved.placements['5x7:portrait']!;
    const expectedPlacement = configuredPlacement(saved.corners, ratio, 'portrait', { zoom: 1, horizontalPan: 0.5, verticalPan: 0.5 });
    expect(actualPlacement.width).toBeCloseTo(expectedPlacement.width, 10);
    expect(actualPlacement.x).toBeCloseTo(expectedPlacement.x, 10);
    expect(actualPlacement.y).toBeCloseTo(expectedPlacement.y, 10);
    expectVisibleZoom(100);
    expect(Number((screen.getByLabelText('Paper zoom') as HTMLInputElement).value)).toBeLessThan(1.05);
    expect(screen.getByRole('button', { name: 'Bottom right corner of Main frame' }).style.left).toBe(`${corrected.x / 4096 * 100}%`);
  });
});
