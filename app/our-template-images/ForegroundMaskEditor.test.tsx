import { useState } from 'react';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MAX_FOREGROUND_MASK_STROKES, maskAlphaAtPixel, rasterizeForegroundMask } from '@/lib/our-template-image-foreground-mask';
import type { OurTemplateImageForegroundMask } from '@/lib/our-template-image-types';
import type { TemplateOpeningCorners } from '@/lib/our-category-template-composite';
import { ForegroundMaskEditor } from './ForegroundMaskEditor';

type Point = { x: number; y: number };
let canvasPixels: WeakMap<HTMLCanvasElement, Uint8ClampedArray>;
let sourcePixels: Uint8ClampedArray | null;
let sourceReads: () => void;

function ControlledMaskEditor({ onChange, initial, disabled = false, openingCorners }: {
  onChange(mask: OurTemplateImageForegroundMask | undefined): void;
  initial?: OurTemplateImageForegroundMask;
  disabled?: boolean;
  openingCorners?: TemplateOpeningCorners[];
}) {
  const [mask, setMask] = useState(initial);
  return <ForegroundMaskEditor imageUrl="/original-nursery.png" imageWidth={1000} imageHeight={800} mask={mask} disabled={disabled}
    onChange={(next) => { setMask(next); onChange(next); }} onClose={vi.fn()} openingCorners={openingCorners} />;
}

function canvasViewport() {
  const viewport = screen.getByRole('group', { name: 'Foreground protection canvas' });
  vi.spyOn(viewport, 'getBoundingClientRect').mockReturnValue({ x: 50, y: 30, left: 50, top: 30, right: 450, bottom: 350, width: 400, height: 320, toJSON: () => ({}) });
  fireEvent(window, new Event('resize'));
  return viewport;
}

function pointerStroke(viewport: HTMLElement, from: Point, to = from) {
  fireEvent.pointerDown(viewport, { button: 0, pointerId: 1, clientX: from.x, clientY: from.y });
  fireEvent.pointerMove(viewport, { pointerId: 1, clientX: to.x, clientY: to.y });
  fireEvent.pointerUp(viewport, { pointerId: 1, clientX: to.x, clientY: to.y });
}

function readableRoom() {
  sourcePixels = new Uint8ClampedArray(1000 * 800 * 4);
  for (let y = 0; y < 800; y++) for (let x = 0; x < 1000; x++) {
    const offset = (y * 1000 + x) * 4;
    const foreground = x >= 300 && x <= 650 && y >= 200 && y <= 600;
    sourcePixels[offset] = foreground ? 185 : 230;
    sourcePixels[offset + 1] = foreground ? 150 : 230;
    sourcePixels[offset + 2] = foreground ? 140 : 235;
    sourcePixels[offset + 3] = 255;
  }
  fireEvent.load(screen.getByAltText('Original room for foreground protection'));
}

async function waitForCandidate() {
  await waitFor(() => expect(screen.getByRole('button', { name: 'Apply selection' }).hasAttribute('disabled')).toBe(false));
}

describe('Keep in front mask editor', () => {
  beforeEach(() => {
    vi.stubGlobal('PointerEvent', MouseEvent);
    Object.defineProperty(HTMLElement.prototype, 'setPointerCapture', { configurable: true, value: vi.fn() });
    Object.defineProperty(HTMLElement.prototype, 'releasePointerCapture', { configurable: true, value: vi.fn() });
    Object.defineProperty(HTMLElement.prototype, 'hasPointerCapture', { configurable: true, value: vi.fn(() => true) });
    canvasPixels = new WeakMap();
    sourcePixels = null;
    sourceReads = vi.fn();
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockImplementation(function (this: HTMLCanvasElement) {
      const canvas = this;
      return {
        drawImage: vi.fn(),
        getImageData() { sourceReads(); if (!sourcePixels) throw new Error('Unreadable source image'); return { width: canvas.width, height: canvas.height, data: sourcePixels }; },
        clearRect() { const pixels = canvasPixels.get(canvas); pixels?.fill(0); },
        createImageData: (width: number, height: number) => ({ width, height, data: new Uint8ClampedArray(width * height * 4) }),
        putImageData(image: ImageData, left: number, top: number) {
          let pixels = canvasPixels.get(canvas);
          if (!pixels || pixels.length !== canvas.width * canvas.height * 4) { pixels = new Uint8ClampedArray(canvas.width * canvas.height * 4); canvasPixels.set(canvas, pixels); }
          for (let y = 0; y < image.height; y++) {
            pixels.set(image.data.subarray(y * image.width * 4, (y + 1) * image.width * 4), ((top + y) * canvas.width + left) * 4);
          }
        },
      } as unknown as CanvasRenderingContext2D;
    });
  });
  afterEach(() => vi.unstubAllGlobals());

  it('shows the original room and restores an existing mask without changing it', () => {
    const initial: OurTemplateImageForegroundMask = { version: 1, strokes: [{ mode: 'paint', size: 20, softness: 0, points: [{ x: 100, y: 200 }] }] };
    const onChange = vi.fn();
    render(<ControlledMaskEditor initial={initial} onChange={onChange} />);
    expect(screen.getByAltText('Original room for foreground protection').getAttribute('src')).toBe('/original-nursery.png');
    expect(screen.getByRole('status').textContent).toContain('1 brush stroke');
    expect(onChange).not.toHaveBeenCalled();
    const canvas = screen.getByLabelText('Painted foreground protection overlay') as HTMLCanvasElement;
    expect(canvasPixels.get(canvas)![(200 * canvas.width + 100) * 4 + 3]).toBe(Math.round(255 * 0.55));
  });

  it('measures the delayed dialog viewport before the first stroke and keeps rendering and coordinates aligned after resize', () => {
    let width = 1100, height = 560;
    const observe = vi.fn();
    let resized = () => {};
    vi.stubGlobal('ResizeObserver', class {
      constructor(callback: () => void) { resized = callback; }
      observe = observe;
      disconnect = vi.fn();
    });
    vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function (this: HTMLElement) {
      if (this.getAttribute('aria-label') === 'Foreground protection canvas') {
        return { x: 50, y: 30, left: 50, top: 30, width, height, right: 50 + width, bottom: 30 + height, toJSON: () => ({}) };
      }
      return { x: 0, y: 0, left: 0, top: 0, width: 0, height: 0, right: 0, bottom: 0, toJSON: () => ({}) };
    });
    const onChange = vi.fn();
    render(<ControlledMaskEditor onChange={onChange} />);
    const viewport = screen.getByRole('group', { name: 'Foreground protection canvas' });
    expect(observe).toHaveBeenCalledWith(viewport);
    const sourceLayer = screen.getByAltText('Original room for foreground protection').parentElement!;
    expect(sourceLayer.style.transform).toBe('translate(200px, 0px) scale(0.7)');
    pointerStroke(viewport, { x: 552.4, y: 177 });
    expect(onChange.mock.lastCall![0].strokes[0].points).toEqual([{ x: 432, y: 210 }]);
    width = 800; height = 400;
    act(() => resized());
    expect(sourceLayer.style.transform).toBe('translate(150px, 0px) scale(0.5)');
    pointerStroke(viewport, { x: 416, y: 135 });
    expect(onChange.mock.lastCall![0].strokes[1].points).toEqual([{ x: 432, y: 210 }]);
  });

  it('stores brush strokes in original image coordinates and draws the shared soft mask raster', () => {
    const onChange = vi.fn();
    render(<ControlledMaskEditor onChange={onChange} />);
    const viewport = canvasViewport();
    fireEvent.change(screen.getByLabelText('Brush size in original pixels'), { target: { value: '40' } });
    fireEvent.change(screen.getByLabelText('Brush edge softness'), { target: { value: '65' } });
    // The fitted source is 0.4 CSS pixels per original pixel, offset by (50,30).
    pointerStroke(viewport, { x: 90, y: 110 }, { x: 102, y: 118 });
    expect(onChange).toHaveBeenCalledTimes(1);
    const mask = onChange.mock.lastCall![0] as OurTemplateImageForegroundMask;
    expect(mask).toEqual({ version: 1, strokes: [{ mode: 'paint', size: 40, softness: 0.65, points: [{ x: 100, y: 200 }, { x: 130, y: 220 }] }] });
    const raster = rasterizeForegroundMask(mask, 1000, 800);
    expect(maskAlphaAtPixel(raster, 100, 200)).toBe(1);
    expect(maskAlphaAtPixel(raster, 82, 200)).toBeGreaterThan(0);
    expect(maskAlphaAtPixel(raster, 82, 200)).toBeLessThan(1);
    expect(maskAlphaAtPixel(raster, 70, 200)).toBe(0);
    const canvas = screen.getByLabelText('Painted foreground protection overlay') as HTMLCanvasElement;
    const overlay = canvasPixels.get(canvas)!;
    expect(overlay[(200 * 1000 + 82) * 4 + 3]).toBe(Math.round(raster.alpha[200 * 1000 + 82] * 0.55));
  });

  it('erases protected pixels and supports Undo, Redo and undoing Clear', () => {
    const onChange = vi.fn();
    render(<ControlledMaskEditor onChange={onChange} />);
    const viewport = canvasViewport();
    fireEvent.change(screen.getByLabelText('Brush size in original pixels'), { target: { value: '40' } });
    fireEvent.change(screen.getByLabelText('Brush edge softness'), { target: { value: '0' } });
    pointerStroke(viewport, { x: 250, y: 190 });
    fireEvent.click(screen.getByRole('button', { name: 'Erase' }));
    fireEvent.change(screen.getByLabelText('Brush size in original pixels'), { target: { value: '10' } });
    pointerStroke(viewport, { x: 250, y: 190 });
    let mask = onChange.mock.lastCall![0] as OurTemplateImageForegroundMask;
    expect(mask.strokes.map((stroke) => stroke.mode)).toEqual(['paint', 'erase']);
    expect(maskAlphaAtPixel(rasterizeForegroundMask(mask, 1000, 800), 500, 400)).toBe(0);
    expect(maskAlphaAtPixel(rasterizeForegroundMask(mask, 1000, 800), 510, 400)).toBe(1);
    fireEvent.click(screen.getByRole('button', { name: 'Undo mask edit' }));
    mask = onChange.mock.lastCall![0];
    expect(mask.strokes).toHaveLength(1);
    expect(maskAlphaAtPixel(rasterizeForegroundMask(mask, 1000, 800), 500, 400)).toBe(1);
    fireEvent.click(screen.getByRole('button', { name: 'Redo mask edit' }));
    expect(onChange.mock.lastCall![0].strokes).toHaveLength(2);
    fireEvent.click(screen.getByRole('button', { name: 'Clear mask' }));
    expect(onChange).toHaveBeenLastCalledWith(undefined);
    fireEvent.click(screen.getByRole('button', { name: 'Undo mask edit' }));
    expect(onChange.mock.lastCall![0].strokes).toHaveLength(2);
  });

  it('keeps source coordinates and brush size correct after zooming and panning', () => {
    const onChange = vi.fn();
    render(<ControlledMaskEditor onChange={onChange} />);
    const viewport = canvasViewport();
    fireEvent.change(screen.getByLabelText('Brush size in original pixels'), { target: { value: '12' } });
    fireEvent.change(screen.getByLabelText('Mask zoom'), { target: { value: '4' } });
    fireEvent.click(screen.getByRole('button', { name: 'Pan' }));
    pointerStroke(viewport, { x: 100, y: 100 }, { x: 116, y: 132 });
    expect(onChange).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Paint' }));
    pointerStroke(viewport, { x: 250, y: 190 }, { x: 266, y: 198 });
    expect(onChange.mock.lastCall![0].strokes).toEqual([{ mode: 'paint', size: 12, softness: 0.3, points: [{ x: 490, y: 380 }, { x: 500, y: 385 }] }]);
    const raster = rasterizeForegroundMask(onChange.mock.lastCall![0], 1000, 800);
    expect(maskAlphaAtPixel(raster, 490, 380)).toBe(1);
    expect(maskAlphaAtPixel(raster, 485, 380)).toBeGreaterThan(0);
    expect(maskAlphaAtPixel(raster, 485, 380)).toBeLessThan(1);
  });

  it('supports 64 times fitted zoom for individual-pixel detail painting', () => {
    const onChange = vi.fn();
    render(<ControlledMaskEditor onChange={onChange} />);
    const viewport = canvasViewport();
    fireEvent.change(screen.getByLabelText('Mask zoom'), { target: { value: '64' } });
    fireEvent.change(screen.getByLabelText('Brush size in original pixels'), { target: { value: '1' } });
    pointerStroke(viewport, { x: 250, y: 190 }, { x: 275.6, y: 190 });
    expect(onChange.mock.lastCall![0].strokes[0].points).toEqual([{ x: 500, y: 400 }, { x: 501, y: 400 }]);
  });

  it('uses a source-resolution mask overlay for 4096px detail zoom and a smaller overlay at Fit', () => {
    // Attribute sizing is enough here; avoid allocating a fake 64 MB RGBA canvas.
    vi.mocked(HTMLCanvasElement.prototype.getContext).mockReturnValue(null);
    const onChange = vi.fn();
    render(<ForegroundMaskEditor imageUrl="/large-canva.png" imageWidth={4096} imageHeight={4096} onChange={onChange} onClose={vi.fn()} />);
    const canvas = screen.getByLabelText('Painted foreground protection overlay') as HTMLCanvasElement;
    expect(canvas.width).toBe(2048); expect(canvas.height).toBe(2048);
    fireEvent.change(screen.getByLabelText('Mask zoom'), { target: { value: '4' } });
    expect(canvas.width).toBe(4096); expect(canvas.height).toBe(4096);
    fireEvent.change(screen.getByLabelText('Mask zoom'), { target: { value: '1' } });
    expect(canvas.width).toBe(2048); expect(canvas.height).toBe(2048);
    expect(onChange).not.toHaveBeenCalled();
  });

  it('toggles overlay visibility and changes view controls without changing the saved mask', () => {
    const onChange = vi.fn();
    render(<ControlledMaskEditor onChange={onChange} />);
    canvasViewport();
    fireEvent.click(screen.getByLabelText('Show mask'));
    expect(screen.getByLabelText('Painted foreground protection overlay').style.opacity).toBe('0');
    fireEvent.change(screen.getByLabelText('Mask zoom'), { target: { value: '8' } });
    fireEvent.click(screen.getByRole('button', { name: 'Fit view' }));
    expect((screen.getByLabelText('Mask zoom') as HTMLSelectElement).value).toBe('1');
    expect(onChange).not.toHaveBeenCalled();
  });

  it('discards a cancelled stroke and clears its temporary overlay', () => {
    const onChange = vi.fn();
    render(<ControlledMaskEditor onChange={onChange} />);
    const viewport = canvasViewport();
    fireEvent.pointerDown(viewport, { button: 0, pointerId: 1, clientX: 250, clientY: 190 });
    fireEvent.pointerMove(viewport, { pointerId: 1, clientX: 270, clientY: 190 });
    fireEvent.pointerCancel(viewport, { pointerId: 1 });
    expect(onChange).not.toHaveBeenCalled();
    const canvas = screen.getByLabelText('Painted foreground protection overlay') as HTMLCanvasElement;
    expect(canvasPixels.get(canvas)![(400 * 1000 + 500) * 4 + 3]).toBe(0);
  });

  it('clamps strokes dragged beyond the image to its last original pixel', () => {
    const onChange = vi.fn();
    render(<ControlledMaskEditor onChange={onChange} />);
    const viewport = canvasViewport();
    pointerStroke(viewport, { x: 448, y: 346 }, { x: 500, y: 400 });
    expect(onChange.mock.lastCall![0].strokes[0].points).toEqual([{ x: 995, y: 790 }, { x: 999, y: 799 }]);
  });

  it('drops the redo branch when a new stroke follows Undo', () => {
    const onChange = vi.fn();
    render(<ControlledMaskEditor onChange={onChange} />);
    const viewport = canvasViewport();
    pointerStroke(viewport, { x: 90, y: 110 });
    pointerStroke(viewport, { x: 130, y: 150 });
    fireEvent.click(screen.getByRole('button', { name: 'Undo mask edit' }));
    pointerStroke(viewport, { x: 170, y: 190 });
    expect(onChange.mock.lastCall![0].strokes.map((stroke: { points: Point[] }) => stroke.points[0])).toEqual([{ x: 100, y: 200 }, { x: 300, y: 400 }]);
    expect(screen.getByRole('button', { name: 'Redo mask edit' }).hasAttribute('disabled')).toBe(true);
  });

  it('blocks painting and mask history changes while disabled', () => {
    const onChange = vi.fn();
    render(<ControlledMaskEditor onChange={onChange} disabled />);
    const viewport = canvasViewport();
    pointerStroke(viewport, { x: 90, y: 110 });
    expect(screen.getByRole('button', { name: 'Paint' }).hasAttribute('disabled')).toBe(true);
    expect(screen.getByRole('button', { name: 'Erase' }).hasAttribute('disabled')).toBe(true);
    expect(screen.getByLabelText('Brush size in original pixels').hasAttribute('disabled')).toBe(true);
    expect(onChange).not.toHaveBeenCalled();
  });

  it('shows the brush limit before adding an unsavable stroke and still permits Clear', () => {
    const stroke = { mode: 'paint' as const, size: 1, softness: 0, points: [{ x: 100, y: 100 }] };
    const initial: OurTemplateImageForegroundMask = { version: 1, strokes: Array.from({ length: MAX_FOREGROUND_MASK_STROKES }, () => ({ ...stroke, points: [...stroke.points] })) };
    const onChange = vi.fn();
    render(<ControlledMaskEditor initial={initial} onChange={onChange} />);
    const viewport = canvasViewport();
    pointerStroke(viewport, { x: 250, y: 190 });
    expect(screen.getByRole('alert').textContent).toContain('brush limit');
    expect(onChange).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Clear mask' }));
    expect(onChange).toHaveBeenLastCalledWith(undefined);
  });

  it('previews a connected foreground suggestion before applying it, preserving existing painted objects', async () => {
    const initial: OurTemplateImageForegroundMask = { version: 1, strokes: [{ mode: 'paint', size: 20, softness: 0, points: [{ x: 200, y: 600 }] }] };
    const onChange = vi.fn();
    render(<ControlledMaskEditor initial={initial} onChange={onChange} />);
    const viewport = canvasViewport(); readableRoom();
    fireEvent.click(screen.getByRole('button', { name: 'Smart select' }));
    pointerStroke(viewport, { x: 250, y: 190 });
    await waitForCandidate();
    expect(onChange).not.toHaveBeenCalled();
    const candidateCanvas = screen.getByLabelText('Suggested foreground selection overlay') as HTMLCanvasElement;
    expect(canvasPixels.get(candidateCanvas)![(400 * 1000 + 500) * 4 + 3]).toBeGreaterThan(0);
    fireEvent.click(screen.getByRole('button', { name: 'Apply selection' }));
    const saved = onChange.mock.lastCall![0] as OurTemplateImageForegroundMask;
    expect(saved.strokes).toHaveLength(2); expect(saved.strokes[0]).toEqual(initial.strokes[0]);
    expect(saved.strokes[1].region?.runs.length).toBeGreaterThan(0);
    let raster = rasterizeForegroundMask(saved, 1000, 800);
    expect(maskAlphaAtPixel(raster, 500, 400)).toBe(1);
    expect(maskAlphaAtPixel(raster, 200, 600)).toBe(1);
    expect(maskAlphaAtPixel(raster, 100, 100)).toBe(0);
    fireEvent.click(screen.getByRole('button', { name: 'Undo mask edit' }));
    expect(onChange.mock.lastCall![0]).toEqual(initial);
    fireEvent.click(screen.getByRole('button', { name: 'Redo mask edit' }));
    fireEvent.click(screen.getByRole('button', { name: 'Erase' }));
    fireEvent.change(screen.getByLabelText('Brush size in original pixels'), { target: { value: '10' } });
    fireEvent.change(screen.getByLabelText('Brush edge softness'), { target: { value: '0' } });
    pointerStroke(viewport, { x: 250, y: 190 });
    raster = rasterizeForegroundMask(onChange.mock.lastCall![0], 1000, 800);
    expect(maskAlphaAtPixel(raster, 500, 400)).toBe(0);
    expect(maskAlphaAtPixel(raster, 530, 400)).toBe(1);
    expect(maskAlphaAtPixel(raster, 200, 600)).toBe(1);
  });

  it('recomputes sensitivity and cancels a suggestion without changing the protection or rereading the image', async () => {
    const onChange = vi.fn();
    render(<ControlledMaskEditor onChange={onChange} />);
    const viewport = canvasViewport(); readableRoom();
    fireEvent.click(screen.getByRole('button', { name: 'Smart select' }));
    pointerStroke(viewport, { x: 250, y: 190 });
    await waitForCandidate();
    fireEvent.change(screen.getByLabelText('Selection sensitivity'), { target: { value: '65' } });
    await waitForCandidate();
    expect(onChange).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Pan' }));
    expect(screen.getByRole('button', { name: 'Apply selection' }).hasAttribute('disabled')).toBe(false);
    fireEvent.click(screen.getByLabelText('Show mask'));
    expect(screen.getByLabelText('Suggested foreground selection overlay').style.opacity).toBe('0');
    fireEvent.click(screen.getByRole('button', { name: 'Cancel selection' }));
    expect(screen.queryByRole('region', { name: 'Suggested foreground selection' })).toBeNull();
    expect(screen.getByLabelText('Suggested foreground selection overlay').style.opacity).toBe('0');
    expect(onChange).not.toHaveBeenCalled(); expect(sourceReads).toHaveBeenCalledTimes(1);
  });

  it('restricts Smart select to the opening and explains a click outside it', async () => {
    const onChange = vi.fn();
    const opening: TemplateOpeningCorners = { topLeft: { x: 400, y: 300 }, topRight: { x: 600, y: 300 }, bottomRight: { x: 600, y: 500 }, bottomLeft: { x: 400, y: 500 } };
    render(<ControlledMaskEditor onChange={onChange} openingCorners={[opening]} />);
    const viewport = canvasViewport(); readableRoom();
    fireEvent.click(screen.getByRole('button', { name: 'Smart select' }));
    pointerStroke(viewport, { x: 170, y: 190 });
    expect(screen.getByRole('alert').textContent).toContain('inside a print opening');
    expect(onChange).not.toHaveBeenCalled();
    pointerStroke(viewport, { x: 250, y: 190 });
    await waitForCandidate();
    fireEvent.click(screen.getByRole('button', { name: 'Apply selection' }));
    const raster = rasterizeForegroundMask(onChange.mock.lastCall![0], 1000, 800);
    expect(maskAlphaAtPixel(raster, 500, 400)).toBe(1);
    expect(maskAlphaAtPixel(raster, 350, 400)).toBe(0);
  });

  it('fills enclosed manual-paint gaps and lets Undo restore the gap', () => {
    const initial: OurTemplateImageForegroundMask = { version: 1, strokes: [{ mode: 'paint', size: 12, softness: 0,
      points: [{ x: 420, y: 320 }, { x: 580, y: 320 }, { x: 580, y: 480 }, { x: 420, y: 480 }, { x: 420, y: 320 }] }] };
    const onChange = vi.fn();
    render(<ControlledMaskEditor initial={initial} onChange={onChange} />);
    fireEvent.click(screen.getByRole('button', { name: 'Fill gaps' }));
    let raster = rasterizeForegroundMask(onChange.mock.lastCall![0], 1000, 800);
    expect(maskAlphaAtPixel(raster, 500, 400)).toBe(1);
    expect(maskAlphaAtPixel(raster, 100, 100)).toBe(0);
    fireEvent.click(screen.getByRole('button', { name: 'Undo mask edit' }));
    raster = rasterizeForegroundMask(onChange.mock.lastCall![0], 1000, 800);
    expect(maskAlphaAtPixel(raster, 500, 400)).toBe(0);
    expect(maskAlphaAtPixel(raster, 420, 400)).toBe(1);
  });

  it('keeps manual brushes available when source pixels cannot be read for Smart select', () => {
    const onChange = vi.fn();
    render(<ControlledMaskEditor onChange={onChange} />);
    fireEvent.load(screen.getByAltText('Original room for foreground protection'));
    expect(screen.getByText(/Smart select could not read this room image/)).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Smart select' }).hasAttribute('disabled')).toBe(true);
    expect(screen.getByRole('button', { name: 'Paint' }).hasAttribute('disabled')).toBe(false);
    expect(onChange).not.toHaveBeenCalled();
  });
});
