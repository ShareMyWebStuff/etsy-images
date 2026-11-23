import { useState } from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  cropRegionToArtworkPlacement,
  defaultNativeListingPrintCropDraft,
  PRINT_CROP_RATIOS,
  validateNativeListingPrintCropDraft,
  type ListingPrintCropDraft,
} from '@/lib/listing-print-crops';
import { ListingPrintCropEditor } from './ListingPrintCropEditor';

const sourceDimensions = { width: 7200, height: 9000 };

function dragSelection(deltaX: number, deltaY: number) {
  vi.spyOn(screen.getByTestId('print-crop-source-frame'), 'getBoundingClientRect').mockReturnValue({
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
  vi.stubGlobal('fetch', vi.fn());
});
afterEach(() => vi.unstubAllGlobals());

describe('ListingPrintCropEditor', () => {
  it('emits all six original-size crops inline and keeps edits when the consumer rerenders', () => {
    let latest: ListingPrintCropDraft | null = null;
    function Review() {
      const [draft, setDraft] = useState<ListingPrintCropDraft | null>(null);
      latest = draft;
      return <>
        <ListingPrintCropEditor imageUrl="/review/fox.webp" imageAlt="Fox print artwork"
          sourceDimensions={{ ...sourceDimensions }} orientation="portrait"
          onChange={(value) => setDraft(value)} />
        <span aria-label="Crop position">{draft?.regions['2x3'].x}</span>
      </>;
    }
    render(<Review />);
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(screen.getByRole('status').textContent).toContain('Loading crop editor');
    expect(screen.getAllByRole('tab')).toHaveLength(6);
    expect(Object.keys(latest!.regions).sort()).toEqual(PRINT_CROP_RATIOS.map(({ key }) => key).sort());
    expect(latest!.regions['2x3'].width * 7200).toBeCloseTo(6000);

    const image = screen.getByRole('img', { name: 'Fox print artwork' }) as HTMLImageElement;
    Object.defineProperties(image, { naturalWidth: { value: 800 }, naturalHeight: { value: 1000 } });
    fireEvent.load(image);
    expect(screen.queryByRole('status')).toBeNull();
    expect(screen.getByRole('slider', { name: '2:3 crop area' }).style.boxShadow).toContain('100vmax #000');
    dragSelection(16, 200);
    expect(latest!.regions['2x3'].x * 7200).toBeCloseTo(888);
    expect(latest!.regions['2x3']).toMatchObject({ y: 0, height: 1 });
    expect(latest!.placements?.['2x3']).toEqual(cropRegionToArtworkPlacement(latest!.regions['2x3']));

    fireEvent.click(screen.getByRole('tab', { name: /^3:4/ }));
    fireEvent.keyDown(screen.getByRole('slider', { name: '3:4 crop area' }), { key: 'ArrowLeft' });
    expect(latest!.regions['3x4'].x).toBeCloseTo(0.03125 - 0.01);
    expect(latest!.regions['4x5']).toEqual({ x: 0, y: 0, width: 1, height: 1 });
    fireEvent.click(screen.getByRole('tab', { name: /^2:3/ }));
    expect(Number(screen.getByLabelText('Crop position').textContent) * 7200).toBeCloseTo(888);
    expect(validateNativeListingPrintCropDraft(latest!, 7200, 9000, 'portrait')).toBeTruthy();
    expect(fetch).not.toHaveBeenCalled();
  });

  it('keeps valid original crop metadata when its preview fails and reports the image error separately', () => {
    const onChange = vi.fn(), onImageLoad = vi.fn(), onImageError = vi.fn();
    render(<ListingPrintCropEditor imageUrl="/review/unavailable.webp" sourceDimensions={sourceDimensions}
      orientation="portrait" onChange={onChange} onImageLoad={onImageLoad} onImageError={onImageError} />);
    const initial = onChange.mock.calls.at(-1)![0] as ListingPrintCropDraft;
    expect(initial.regions['2x3'].width * 7200).toBeCloseTo(6000);
    fireEvent.error(screen.getByRole('img'));
    expect(screen.getByRole('alert').textContent).toContain('Unable to load the artwork preview');
    expect(onImageError).toHaveBeenCalledOnce();
    expect(onImageLoad).not.toHaveBeenCalled();
    expect(onChange.mock.calls.at(-1)![0]).toEqual(initial);
    expect(fetch).not.toHaveBeenCalled();
  });

  it('keeps unsupported artwork visible with an error and emits no usable crop draft', () => {
    const onChange = vi.fn();
    render(<ListingPrintCropEditor imageUrl="/review/square.webp" imageAlt="Square artwork"
      sourceDimensions={{ width: 3000, height: 3000 }} orientation="portrait" onChange={onChange} />);
    fireEvent.load(screen.getByRole('img', { name: 'Square artwork' }));
    expect(screen.getByRole('alert').textContent).toContain('Choose an image with a 2:3 or 4:5 aspect ratio');
    expect(onChange).toHaveBeenLastCalledWith(null);
    expect(screen.queryByTestId('print-crop-selection')).toBeNull();
    expect(fetch).not.toHaveBeenCalled();
  });

  it('resets per-row crops and ratio tabs while preserving saved landscape paper placements', () => {
    const onChange = vi.fn();
    const { rerender } = render(<ListingPrintCropEditor key="row-1" imageUrl="/review/first.webp"
      sourceDimensions={sourceDimensions} orientation="portrait" onChange={onChange} />);
    fireEvent.load(screen.getByRole('img'));
    dragSelection(20, 0);
    fireEvent.click(screen.getByRole('tab', { name: /^4:5/ }));
    const initial = defaultNativeListingPrintCropDraft(3000, 2000, 'landscape');
    initial.placements['4x5'] = { ...initial.placements['4x5'], x: 0 };
    rerender(<ListingPrintCropEditor key="row-2" imageUrl="/review/second.webp"
      sourceDimensions={{ width: 3000, height: 2000 }} orientation="landscape" initialDraft={initial} onChange={onChange} />);
    expect(screen.getByRole('tab', { name: /^3:2/ }).getAttribute('aria-selected')).toBe('true');
    expect(onChange.mock.calls.at(-1)![0]).toEqual({ regions: initial.regions, placements: initial.placements });
    fireEvent.load(screen.getByRole('img'));
    fireEvent.click(screen.getByRole('tab', { name: /^5:4/ }));
    expect(screen.getByTestId('print-crop-selection').style.left).toBe('0%');
    dragSelection(-1000, 1000);
    const changed = onChange.mock.calls.at(-1)![0] as ListingPrintCropDraft;
    expect(changed.placements?.['4x5'].x).toBeCloseTo(1 - initial.placements['4x5'].width);
    expect(changed.placements?.['4x5']).toMatchObject({ y: 0, height: 1 });
    expect(changed.regions).toEqual(initial.regions);
    expect(changed.placements?.['2x3']).toEqual(initial.placements['2x3']);
    expect(fetch).not.toHaveBeenCalled();
  });
});
