import { fireEvent, render, screen } from '@testing-library/react';
import { useState } from 'react';
import { describe, expect, it, vi } from 'vitest';

import type { TemplateOpeningRegion } from '@/lib/our-category-template-composite';
import { defaultTemplateGridLayout } from '@/lib/template-grid-layout';
import { TemplateGridAreaEditor } from './TemplateGridAreaEditor';

function region(id = 'saved-area', imageCount = 1): TemplateOpeningRegion {
  return {
    id,
    name: `Area ${id}`,
    corners: {
      topLeft: { x: 100, y: 100 }, topRight: { x: 300, y: 100 },
      bottomRight: { x: 300, y: 400 }, bottomLeft: { x: 100, y: 400 },
    },
    orientationCorners: {
      portrait: {
        topLeft: { x: 100, y: 100 }, topRight: { x: 300, y: 100 },
        bottomRight: { x: 300, y: 400 }, bottomLeft: { x: 100, y: 400 },
      },
      landscape: {
        topLeft: { x: 40, y: 150 }, topRight: { x: 390, y: 150 },
        bottomRight: { x: 390, y: 350 }, bottomLeft: { x: 40, y: 350 },
      },
    },
    grid: defaultTemplateGridLayout(imageCount),
  };
}

function renderAreas(initialRegions: TemplateOpeningRegion[], onChange = vi.fn()) {
  function Harness() {
    const [regions, setRegions] = useState(initialRegions);
    return <TemplateGridAreaEditor
      imageUrl="/template.png"
      initialImageSize={{ width: 1000, height: 800 }}
      regions={regions}
      onImageSize={vi.fn()}
      onRegionsChange={(next) => { setRegions(next); onChange(next); }}
      onEditRegion={vi.fn()}
      onEditCell={vi.fn()}
      onRequestDeleteRegion={vi.fn()}
      onRemoveImage={vi.fn()}
    />;
  }
  return render(<Harness />);
}

describe('TemplateGridAreaEditor', () => {
  it('explains image load failures while preserving saved areas and clears the message after loading', () => {
    const onChange = vi.fn();
    renderAreas([region()], onChange);
    const image = screen.getByAltText('Template area selection');
    Object.defineProperties(image, { naturalWidth: { value: 1000 }, naturalHeight: { value: 800 } });
    fireEvent.error(image);
    expect(screen.getByRole('alert').textContent).toContain('Unable to load the template image.');
    expect(screen.getByTestId('artwork-area-saved-area')).toBeTruthy();
    expect(onChange).not.toHaveBeenCalled();
    fireEvent.load(image);
    expect(screen.queryByRole('alert')).toBeNull();
    expect(onChange).not.toHaveBeenCalled();
  });

  it('shows saved artwork areas immediately when editing an existing template image', () => {
    const grid = defaultTemplateGridLayout(1);
    grid.cells[0] = { ...grid.cells[0], configured: true };

    render(<TemplateGridAreaEditor
      imageUrl="/api/our-categories/templates/59/image"
      initialImageSize={{ width: 1254, height: 1254 }}
      regions={[{
        id: 'saved-area',
        name: 'Area 1',
        corners: {
          topLeft: { x: 178, y: 65 },
          topRight: { x: 1004, y: 65 },
          bottomRight: { x: 1004, y: 1147 },
          bottomLeft: { x: 178, y: 1147 },
        },
        grid,
      }]}
      onImageSize={vi.fn()}
      onRegionsChange={vi.fn()}
      onEditRegion={vi.fn()}
      onEditCell={vi.fn()}
      onRequestDeleteRegion={vi.fn()}
      onRemoveImage={vi.fn()}
    />);

    expect(screen.getByRole('button', { name: 'Edit Area 1' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Edit Area 1 Image 1' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Resize Area 1 from se' })).toBeTruthy();
  });

  it('toggles between separately saved portrait and landscape bounds beneath the area controls', () => {
    renderAreas([region()]);
    const area = screen.getByTestId('artwork-area-saved-area');
    expect(Number.parseFloat(area.style.width)).toBeCloseTo(20.1);
    expect(Number.parseFloat(area.style.height)).toBeCloseTo(37.625);
    fireEvent.click(screen.getByRole('button', { name: 'Landscape' }));
    expect(area.getAttribute('data-orientation')).toBe('landscape');
    expect(Number.parseFloat(area.style.width)).toBeCloseTo(35.1);
    expect(Number.parseFloat(area.style.height)).toBeCloseTo(25.125);
    expect(screen.getByRole('button', { name: 'Landscape' }).getAttribute('aria-pressed')).toBe('true');
    fireEvent.click(screen.getByRole('button', { name: 'Portrait' }));
    expect(Number.parseFloat(area.style.width)).toBeCloseTo(20.1);
    expect(Number.parseFloat(area.style.height)).toBeCloseTo(37.625);
  });

  it('resizes the selected orientation without changing the other saved bounds', () => {
    vi.stubGlobal('PointerEvent', MouseEvent);
    const onChange = vi.fn();
    const original = region();
    renderAreas([original], onChange);
    const image = screen.getByAltText('Template area selection');
    vi.spyOn(image, 'getBoundingClientRect').mockReturnValue({ x: 0, y: 0, left: 0, top: 0, width: 1000, height: 800, right: 1000, bottom: 800, toJSON: () => ({}) });
    const surface = image.parentElement!;
    Object.assign(surface, { setPointerCapture: vi.fn(), hasPointerCapture: () => false });
    fireEvent.click(screen.getByRole('button', { name: 'Landscape' }));
    fireEvent.pointerDown(screen.getByRole('button', { name: 'Resize Area saved-area from se' }), { button: 0, clientX: 390, clientY: 350 });
    fireEvent.pointerMove(surface, { clientX: 440, clientY: 380 });
    fireEvent.pointerUp(surface);
    const updated = onChange.mock.calls.at(-1)?.[0][0] as TemplateOpeningRegion;
    expect(updated.orientationCorners?.portrait).toEqual(original.orientationCorners?.portrait);
    expect(updated.corners).toEqual(original.corners);
    expect(updated.orientationCorners?.landscape.bottomRight).toEqual({ x: 440, y: 380 });
    vi.unstubAllGlobals();
  });

  it('keeps the multi-image area view and allows additional areas beyond four', () => {
    renderAreas(Array.from({ length: 5 }, (_, index) => region(String(index + 1), 2)));
    expect(screen.queryByRole('button', { name: 'Landscape' })).toBeNull();
    expect((screen.getByRole('button', { name: 'Add Area' }) as HTMLButtonElement).disabled).toBe(false);
    expect(screen.getAllByRole('button', { name: /Edit Area \d Image/ })).toHaveLength(10);
  });
});
