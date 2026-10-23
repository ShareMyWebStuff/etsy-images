import { fireEvent, render, screen, within } from '@testing-library/react';
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
});
