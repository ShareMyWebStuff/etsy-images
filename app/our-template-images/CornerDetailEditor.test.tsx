import { useState } from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { TemplateOpeningCorners } from '@/lib/our-category-template-composite';
import { CornerDetailEditor } from './CornerDetailEditor';

const corners: TemplateOpeningCorners = {
  topLeft: { x: 100, y: 200 }, topRight: { x: 700, y: 210 },
  bottomRight: { x: 690, y: 700 }, bottomLeft: { x: 110, y: 690 },
};

function ControlledEditor({ onMove, onClose, initialCorners = corners, corner = 'topLeft' }: {
  onMove: (point: { x: number; y: number }) => void;
  onClose: () => void;
  initialCorners?: TemplateOpeningCorners;
  corner?: keyof TemplateOpeningCorners;
}) {
  const [currentCorners, setCorners] = useState(initialCorners);
  return <CornerDetailEditor imageUrl="/nursery.png" imageWidth={1000} imageHeight={800}
    opening={{ name: 'Nursery left', corners: currentCorners }} corner={corner}
    onMove={(point) => { onMove(point); setCorners((current) => ({ ...current, [corner]: point })); }}
    onClose={onClose} />;
}

function detailHandle(corner = 'Top left') {
  return screen.getByRole('button', { name: `${corner} corner of Nursery left in close-up` });
}

function dragHandle(handle: HTMLElement, from: { x: number; y: number }, to: { x: number; y: number }) {
  fireEvent.pointerDown(handle, { button: 0, pointerId: 1, clientX: from.x, clientY: from.y });
  fireEvent.pointerMove(handle, { pointerId: 1, clientX: to.x, clientY: to.y });
  fireEvent.pointerUp(handle, { pointerId: 1, clientX: to.x, clientY: to.y });
}

describe('corner detail editing', () => {
  beforeEach(() => {
    vi.stubGlobal('PointerEvent', MouseEvent);
    Object.defineProperty(HTMLElement.prototype, 'setPointerCapture', { configurable: true, value: vi.fn() });
    Object.defineProperty(HTMLElement.prototype, 'releasePointerCapture', { configurable: true, value: vi.fn() });
    Object.defineProperty(HTMLElement.prototype, 'hasPointerCapture', { configurable: true, value: vi.fn(() => true) });
  });
  afterEach(() => vi.unstubAllGlobals());

  it('opens a magnified preview and changes magnification without moving the original corner', () => {
    const onMove = vi.fn(); const onClose = vi.fn();
    render(<ControlledEditor onMove={onMove} onClose={onClose} />);
    expect(screen.getByRole('group', { name: 'Zoomed corner preview' })).toBeTruthy();
    expect((screen.getByLabelText('Corner magnification') as HTMLSelectElement).value).toBe('4');
    fireEvent.change(screen.getByLabelText('Corner magnification'), { target: { value: '2' } });
    fireEvent.change(screen.getByLabelText('Corner magnification'), { target: { value: '8' } });
    expect(onMove).not.toHaveBeenCalled();
    expect(onClose).not.toHaveBeenCalled();
  });

  it('maps a zoomed drag back to integer coordinates in the original image', () => {
    const onMove = vi.fn();
    render(<ControlledEditor onMove={onMove} onClose={vi.fn()} />);
    // At 4x, 20 CSS pixels right and 12 CSS pixels up move five and three source pixels.
    dragHandle(detailHandle(), { x: 600, y: 400 }, { x: 620, y: 388 });
    expect(onMove).toHaveBeenLastCalledWith({ x: 105, y: 197 });
    expect(onMove).toHaveBeenCalledTimes(1);
  });

  it('uses the newly selected zoom and retains the edited position when beginning another drag', () => {
    const onMove = vi.fn();
    render(<ControlledEditor onMove={onMove} onClose={vi.fn()} />);
    fireEvent.change(screen.getByLabelText('Corner magnification'), { target: { value: '2' } });
    dragHandle(detailHandle(), { x: 200, y: 300 }, { x: 210, y: 306 });
    expect(onMove).toHaveBeenLastCalledWith({ x: 105, y: 203 });
    fireEvent.change(screen.getByLabelText('Corner magnification'), { target: { value: '8' } });
    dragHandle(detailHandle(), { x: 420, y: 250 }, { x: 428, y: 234 });
    expect(onMove).toHaveBeenLastCalledWith({ x: 106, y: 201 });
    expect(onMove).toHaveBeenCalledTimes(2);
  });

  it('keeps a continuous drag stable as controlled corner updates are rendered', () => {
    const onMove = vi.fn();
    render(<ControlledEditor onMove={onMove} onClose={vi.fn()} />);
    fireEvent.pointerDown(detailHandle(), { button: 0, pointerId: 1, clientX: 100, clientY: 100 });
    fireEvent.pointerMove(detailHandle(), { pointerId: 1, clientX: 108, clientY: 104 });
    expect(onMove).toHaveBeenLastCalledWith({ x: 102, y: 201 });
    fireEvent.pointerMove(detailHandle(), { pointerId: 1, clientX: 116, clientY: 112 });
    expect(onMove).toHaveBeenLastCalledWith({ x: 104, y: 203 });
    fireEvent.pointerUp(detailHandle(), { pointerId: 1 });
  });

  it('moves exactly one original pixel per arrow key regardless of magnification', () => {
    const onMove = vi.fn();
    render(<ControlledEditor onMove={onMove} onClose={vi.fn()} />);
    fireEvent.change(screen.getByLabelText('Corner magnification'), { target: { value: '8' } });
    fireEvent.keyDown(detailHandle(), { key: 'ArrowRight' });
    expect(onMove).toHaveBeenLastCalledWith({ x: 101, y: 200 });
    fireEvent.keyDown(detailHandle(), { key: 'ArrowDown' });
    expect(onMove).toHaveBeenLastCalledWith({ x: 101, y: 201 });
    fireEvent.keyDown(detailHandle(), { key: 'ArrowLeft' });
    expect(onMove).toHaveBeenLastCalledWith({ x: 100, y: 201 });
    fireEvent.keyDown(detailHandle(), { key: 'ArrowUp' });
    expect(onMove).toHaveBeenLastCalledWith({ x: 100, y: 200 });
  });

  it('clamps precision edits to the original image edges', () => {
    const onMove = vi.fn();
    render(<ControlledEditor initialCorners={{ ...corners, topLeft: { x: 1, y: 1 } }} onMove={onMove} onClose={vi.fn()} />);
    dragHandle(detailHandle(), { x: 300, y: 300 }, { x: 280, y: 260 });
    expect(onMove).toHaveBeenLastCalledWith({ x: 0, y: 0 });
    fireEvent.keyDown(detailHandle(), { key: 'ArrowLeft' });
    expect(onMove).toHaveBeenLastCalledWith({ x: 0, y: 0 });
  });

  it('clamps the bottom-right corner to the last pixel instead of image width or height', () => {
    const onMove = vi.fn();
    render(<ControlledEditor initialCorners={{ ...corners, bottomRight: { x: 998, y: 798 } }} corner="bottomRight" onMove={onMove} onClose={vi.fn()} />);
    dragHandle(detailHandle('Bottom right'), { x: 100, y: 100 }, { x: 180, y: 160 });
    expect(onMove).toHaveBeenLastCalledWith({ x: 999, y: 799 });
  });

  it('double-clicks the zoomed corner to return without a coordinate change', () => {
    const onMove = vi.fn(); const onClose = vi.fn();
    render(<ControlledEditor onMove={onMove} onClose={onClose} />);
    fireEvent.doubleClick(detailHandle());
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(onMove).not.toHaveBeenCalled();
  });

  it('returns with the back button or Enter without moving a corner', () => {
    const onMove = vi.fn(); const onClose = vi.fn();
    render(<ControlledEditor onMove={onMove} onClose={onClose} />);
    fireEvent.click(screen.getByRole('button', { name: 'Back to full image' }));
    expect(onClose).toHaveBeenCalledTimes(1);
    fireEvent.keyDown(detailHandle(), { key: 'Enter' });
    expect(onClose).toHaveBeenCalledTimes(2);
    expect(onMove).not.toHaveBeenCalled();
  });

  it('stops applying pointer movement after a cancelled drag', () => {
    const onMove = vi.fn();
    render(<ControlledEditor onMove={onMove} onClose={vi.fn()} />);
    fireEvent.pointerDown(detailHandle(), { button: 0, pointerId: 1, clientX: 200, clientY: 300 });
    fireEvent.pointerCancel(detailHandle(), { pointerId: 1 });
    fireEvent.pointerMove(detailHandle(), { pointerId: 1, clientX: 240, clientY: 340 });
    expect(onMove).not.toHaveBeenCalled();
  });
});
