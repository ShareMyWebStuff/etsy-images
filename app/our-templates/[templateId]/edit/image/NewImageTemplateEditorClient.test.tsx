import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import type { OurCategoryEditorData } from '@/lib/our-categories';
import { defaultTemplateGridLayout } from '@/lib/template-grid-layout';
import { NewImageTemplateEditorClient } from './NewImageTemplateEditorClient';

vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

function multipleTemplateData(): OurCategoryEditorData {
  const grid = defaultTemplateGridLayout(1);
  return {
    categoryId: '12',
    shopId: '66615491',
    values: {
      name: 'Three print set',
      templateType: 'multiple',
      followedTemplateId: 2,
      itemCount: 3,
      roomTheme: 'Nursery',
      backgroundColour: '#F5F0E8',
      printsFrames: true,
      customisePrints: true,
      digitalDownload: true,
      customTop: true,
      customBottom: true,
      printFrameSectionId: 1,
      customisedSectionId: 2,
      downloadSectionId: 3,
      sizes: { a5: true },
      frames: { no_frame: true },
    },
    sizes: [{ key: 'a5', label: 'A5' }],
    frames: [{ key: 'no_frame', label: 'No Frame' }],
    etsySections: [],
    singleTemplates: [],
    followedImageTemplates: [],
    copySourceTemplates: [],
    imageTemplates: [{
      id: '67',
      name: 'Three frames',
      description: 'Three listing images in a room',
      originalFileName: 'three-frames.png',
      useOnPrints: true,
      useOnCustomised: true,
      useOnDigital: true,
      imageWidth: 1200,
      imageHeight: 800,
      openingRegions: [{
        id: 'area-1',
        name: 'Area 1',
        corners: {
          topLeft: { x: 100, y: 100 },
          topRight: { x: 1100, y: 100 },
          bottomRight: { x: 1100, y: 700 },
          bottomLeft: { x: 100, y: 700 },
        },
        grid,
      }],
      displayFonts: false,
      borderEnabled: false,
      borderSizePercent: 5,
      topText: '',
      bottomText: '',
      fontId: 'nunito-semibold',
      isLinked: false,
      linkedSourceCategoryId: null,
      linkedSourceImageTemplateId: null,
      linkedImageItemNumber: null,
      linkedSourceTemplateName: null,
      linkedSourceImageTemplateName: null,
      createdAt: new Date(0).toISOString(),
      updatedAt: new Date(0).toISOString(),
    }],
  };
}

describe('NewImageTemplateEditorClient for multiple templates', () => {
  it('allows each grid image to select any listing image in the multiple template', () => {
    const data = multipleTemplateData();
    render(<NewImageTemplateEditorClient data={data} initialTemplate={data.imageTemplates[0]} />);

    fireEvent.click(screen.getByRole('button', { name: 'Edit Area 1 Image 1' }));

    const listingImage = screen.getByLabelText('Listing Image');
    expect((listingImage as HTMLSelectElement).disabled).toBe(false);
    expect(within(listingImage).getAllByRole('option').map((option) => option.textContent)).toEqual([
      'Image 1',
      'Image 2',
      'Image 3',
    ]);
    fireEvent.change(listingImage, { target: { value: '3' } });
    expect((listingImage as HTMLSelectElement).value).toBe('3');
  });

  it('uses one paper ratio across a multi-image area and keeps rotated sheets the same size', () => {
    const data = multipleTemplateData();
    const region = data.imageTemplates[0].openingRegions[0];
    region.grid = { ...defaultTemplateGridLayout(2), rows: 1, columns: 2 };
    render(<NewImageTemplateEditorClient data={data} initialTemplate={data.imageTemplates[0]} />);

    expect(screen.queryByRole('button', { name: 'Landscape' })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Edit Area 1 Image 1' }));
    fireEvent.change(screen.getByLabelText('Print Ratio'), { target: { value: '2x3' } });
    fireEvent.click(screen.getByRole('button', { name: 'Complete' }));
    fireEvent.click(screen.getByRole('button', { name: 'Edit Area 1 Image 2' }));
    expect((screen.getByLabelText('Print Ratio') as HTMLSelectElement).value).toBe('2x3');
    fireEvent.change(screen.getByLabelText('Orientation'), { target: { value: 'landscape' } });
    fireEvent.click(screen.getByRole('button', { name: 'Complete' }));

    const portrait = screen.getByRole('button', { name: 'Edit Area 1 Image 1' });
    const landscape = screen.getByRole('button', { name: 'Edit Area 1 Image 2' });
    const portraitWidth = Number.parseFloat(portrait.style.width) / 100 * 1001;
    const portraitHeight = Number.parseFloat(portrait.style.height) / 100 * 601;
    const landscapeWidth = Number.parseFloat(landscape.style.width) / 100 * 1001;
    const landscapeHeight = Number.parseFloat(landscape.style.height) / 100 * 601;
    expect(portraitWidth).toBeCloseTo(landscapeHeight, 5);
    expect(portraitHeight).toBeCloseTo(landscapeWidth, 5);
  });

  it('uses the active single-image area orientation when editing image settings', () => {
    const data = multipleTemplateData();
    render(<NewImageTemplateEditorClient data={data} initialTemplate={data.imageTemplates[0]} />);
    fireEvent.click(screen.getByRole('button', { name: 'Landscape' }));
    fireEvent.click(screen.getByRole('button', { name: 'Edit Area 1 Image 1' }));
    const orientation = screen.getByLabelText('Orientation') as HTMLSelectElement;
    expect(orientation.value).toBe('landscape');
    expect(orientation.disabled).toBe(true);
  });

  it('includes both orientation bounds when saving an existing single-image area', async () => {
    const data = multipleTemplateData();
    const fetch = vi.spyOn(globalThis, 'fetch').mockResolvedValue({ ok: false, json: async () => ({ error: 'Save intercepted by test.' }) } as Response);
    render(<NewImageTemplateEditorClient data={data} initialTemplate={data.imageTemplates[0]} />);
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(fetch).toHaveBeenCalledOnce());
    const formData = fetch.mock.calls[0][1]?.body as FormData;
    const regions = JSON.parse(String(formData.get('openingRegions')));
    expect(regions[0].orientationCorners.portrait).toEqual(data.imageTemplates[0].openingRegions[0].corners);
    expect(regions[0].orientationCorners.landscape).toBeTruthy();
    expect(regions[0].orientationCorners.landscape).not.toEqual(regions[0].orientationCorners.portrait);
  });

  it('preserves a legacy landscape area and its image settings when saving orientation bounds', async () => {
    const data = multipleTemplateData();
    const region = data.imageTemplates[0].openingRegions[0];
    region.grid!.cells[0] = {
      ...region.grid!.cells[0], orientation: 'landscape', ratio: '2x3',
      borderEnabled: true, borderSizePercent: 7, topText: 'Existing heading', configured: true,
    };
    const fetch = vi.spyOn(globalThis, 'fetch').mockResolvedValue({ ok: false, json: async () => ({ error: 'Save intercepted by test.' }) } as Response);
    render(<NewImageTemplateEditorClient data={data} initialTemplate={data.imageTemplates[0]} />);
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(fetch).toHaveBeenCalledOnce());
    const formData = fetch.mock.calls[0][1]?.body as FormData;
    const saved = JSON.parse(String(formData.get('openingRegions')))[0];
    expect(saved.orientationCorners.landscape).toEqual(region.corners);
    expect(saved.corners).toEqual(saved.orientationCorners.portrait);
    expect(saved.orientationCorners.portrait).not.toEqual(region.corners);
    expect(saved.grid).toEqual(region.grid);
  });
});
