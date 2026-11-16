import { fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  createListingPrintCropSettings,
  cropRegionToArtworkPlacement,
  defaultNativeListingPrintCropDraft,
  type ListingArtworkOrientation,
  type ListingPrintCropDraft,
  type ListingPrintCropSettings,
} from '@/lib/listing-print-crops';
import { ListingPrintCropDialog } from './ListingPrintCropDialog';

const context = { shopId: '66615491', sectionId: '15', subSectionId: '27', listingId: '548' };

function settings(width: number, height: number, orientation: ListingArtworkOrientation = 'portrait') {
  return createListingPrintCropSettings(defaultNativeListingPrintCropDraft(width, height, orientation), {
    fileName: 'thumbnail.png', updatedAt: '2026-11-13T12:00:00.000Z', width, height,
  }, orientation);
}

function renderEditor(initialSettings: ListingPrintCropSettings | null, orientation: ListingArtworkOrientation = 'portrait', onSave = vi.fn()) {
  return {
    onSave,
    ...render(<ListingPrintCropDialog
      open onOpenChange={vi.fn()} imageUrl="/thumbnail.png" context={context}
      orientation={orientation} initialSettings={initialSettings} saving={false} onSave={onSave}
    />),
  };
}

function dragSelection(deltaX: number, deltaY: number) {
  const source = screen.getByTestId('print-crop-source-frame');
  vi.spyOn(source, 'getBoundingClientRect').mockReturnValue({
    x: 0, y: 0, left: 0, top: 0, width: 400, height: 500, right: 400, bottom: 500, toJSON: () => ({}),
  });
  const selection = screen.getByTestId('print-crop-selection');
  Object.assign(selection, { setPointerCapture: vi.fn(), hasPointerCapture: () => false });
  fireEvent.pointerDown(selection, { clientX: 100, clientY: 100, button: 0, pointerId: 1 });
  fireEvent.pointerMove(selection, { clientX: 100 + deltaX, clientY: 100 + deltaY, pointerId: 1 });
  fireEvent.pointerUp(selection, { pointerId: 1 });
}

beforeEach(() => {
  vi.stubGlobal('PointerEvent', MouseEvent);
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, json: async () => ({ dimensions: { width: 4000, height: 5000 } }) }));
});
afterEach(() => vi.unstubAllGlobals());

describe('ListingPrintCropDialog', () => {
  it('shows the complete portrait 4:5 thumbnail with a full-height crop frame after loading its dimensions', async () => {
    renderEditor(null);
    const image = await screen.findByAltText('Complete listing thumbnail for crop selection');
    fireEvent.load(image);
    const crop = await screen.findByRole('slider', { name: '2:3 crop area' });
    expect(Number.parseFloat(crop.style.width)).toBeCloseTo(100 * 5 / 6);
    expect(crop.style.height).toBe('100%');
    expect(crop.style.top).toBe('0%');
    expect(image.style.width).toBe('100%');
    expect(image.style.height).toBe('100%');
    expect(Number.parseFloat(screen.getByTestId('print-crop-source-frame').parentElement!.style.aspectRatio)).toBeCloseTo(0.8);
    expect(screen.queryByRole('slider', { name: 'Artwork scale' })).toBeNull();
    expect(screen.getByText(/drag its border left or right/)).toBeTruthy();
    expect(fetch).toHaveBeenCalledWith(expect.stringContaining('/print-crops?'), expect.objectContaining({ signal: expect.any(AbortSignal) }));
  });

  it('moves portrait crop frames horizontally, keeps each ratio independent, and saves matching render placements', () => {
    const { onSave } = renderEditor(settings(4000, 5000));
    dragSelection(1000, 1000);
    const twoByThree = screen.getByRole('slider', { name: '2:3 crop area' });
    expect(Number.parseFloat(twoByThree.style.left)).toBeCloseTo(100 / 6);
    expect(twoByThree.style.top).toBe('0%');
    expect(twoByThree.style.height).toBe('100%');

    fireEvent.click(screen.getByRole('tab', { name: /^3:4/ }));
    fireEvent.keyDown(screen.getByRole('slider', { name: '3:4 crop area' }), { key: 'ArrowLeft' });
    fireEvent.click(screen.getByRole('tab', { name: /^4:5/ }));
    const native = screen.getByRole('slider', { name: '4:5 crop area' });
    expect(native.style.width).toBe('100%');
    expect(native.style.left).toBe('0%');
    expect(native.getAttribute('aria-disabled')).toBe('true');
    fireEvent.keyDown(native, { key: 'ArrowRight' });
    fireEvent.click(screen.getByRole('tab', { name: /^2:3/ }));
    expect(Number.parseFloat(screen.getByRole('slider', { name: '2:3 crop area' }).style.left)).toBeCloseTo(100 / 6);

    fireEvent.click(screen.getByRole('button', { name: 'Save Size' }));
    const saved = onSave.mock.calls[0][0] as ListingPrintCropDraft;
    expect(saved.regions['2x3']).toMatchObject({ y: 0, height: 1 });
    expect(saved.regions['2x3'].x).toBeCloseTo(1 / 6);
    expect(saved.regions['3x4'].x).toBeCloseTo(0.03125 - 0.01);
    expect(saved.regions['4x5']).toEqual({ x: 0, y: 0, width: 1, height: 1 });
    expect(saved.placements?.['2x3']).toEqual(cropRegionToArtworkPlacement(saved.regions['2x3']));
    expect(saved.placements?.['3x4']).toEqual(cropRegionToArtworkPlacement(saved.regions['3x4']));
  });

  it('keeps landscape crop frames at full thumbnail height and exposes side margins for wider paper', () => {
    const { onSave } = renderEditor(settings(5000, 4000, 'landscape'), 'landscape');
    const crop = screen.getByRole('slider', { name: '3:2 crop area' });
    expect(Number.parseFloat(crop.style.width)).toBeCloseTo(120);
    expect(crop.style.height).toBe('100%');
    expect(crop.style.top).toBe('0%');
    expect(Number.parseFloat(screen.getByTestId('print-crop-source-frame').style.width)).toBeCloseTo(100 / 1.4);
    expect(screen.getByText(/wider than the thumbnail/)).toBeTruthy();
    dragSelection(-1000, 1000);
    expect(Number.parseFloat(crop.style.left)).toBeCloseTo(-20);
    expect(crop.style.top).toBe('0%');
    fireEvent.click(screen.getByRole('button', { name: 'Save Size' }));
    const saved = onSave.mock.calls[0][0] as ListingPrintCropDraft;
    expect(saved.regions['2x3']).toMatchObject({ y: 0, width: 1.2, height: 1 });
    expect(saved.regions['2x3'].x).toBeCloseTo(-0.2);
    expect(saved.placements?.['2x3']).toEqual(cropRegionToArtworkPlacement(saved.regions['2x3']));
  });

  it('restores saved crop offsets instead of reusing legacy scaled artwork placements', () => {
    const initial = settings(4000, 5000);
    initial.regions['2x3'] = { ...initial.regions['2x3'], x: 0.02 };
    initial.placements['2x3'] = { x: 0.1, y: 0.1, width: 0.5, height: 0.5 };
    const { onSave } = renderEditor(initial);
    expect(Number.parseFloat(screen.getByRole('slider', { name: '2:3 crop area' }).style.left)).toBeCloseTo(2);
    fireEvent.click(screen.getByRole('button', { name: 'Save Size' }));
    const saved = onSave.mock.calls[0][0] as ListingPrintCropDraft;
    expect(saved.regions['2x3'].x).toBeCloseTo(0.02);
    expect(saved.placements?.['2x3']).toEqual(cropRegionToArtworkPlacement(saved.regions['2x3']));
  });

  it('preserves the existing vertical paper-placement movement for a 2:3 portrait thumbnail', () => {
    const { onSave } = renderEditor(settings(2000, 3000));
    fireEvent.click(screen.getByRole('tab', { name: /^4:5/ }));
    expect(screen.getByAltText('Complete listing thumbnail positioned on 4:5 paper')).toBeTruthy();
    dragSelection(1000, 1000);
    const placement = screen.getByTestId('print-crop-selection');
    expect(placement.style.left).toBe('0%');
    expect(placement.style.width).toBe('100%');
    expect(placement.style.top).toBe('0%');
    fireEvent.click(screen.getByRole('button', { name: 'Save Size' }));
    expect(onSave.mock.calls[0][0].placements['4x5']).toMatchObject({ x: 0, y: 0, width: 1 });
  });
});
