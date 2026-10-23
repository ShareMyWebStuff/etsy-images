import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { OurCategoryEditorData } from '@/lib/our-categories';
import { defaultTemplateGridLayout } from '@/lib/template-grid-layout';
import { OurCategoryEditorClient } from './OurCategoryEditorClient';

vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

const sizes = ['a5', 'a4', 'a3'].map((key) => ({ key, label: key.toUpperCase() }));
const frames = [
  { key: 'no_frame', label: 'No Frame' },
  { key: 'black', label: 'Black' },
  { key: 'white', label: 'White' },
  { key: 'oak', label: 'Oak' },
];

function openingRegion(imageItemNumber: number, index: number) {
  return {
    id: `area-${index}`,
    name: `Area ${index}`,
    imageItemNumber,
    corners: {
      topLeft: { x: 10, y: 10 },
      topRight: { x: 90, y: 10 },
      bottomRight: { x: 90, y: 90 },
      bottomLeft: { x: 10, y: 90 },
    },
  };
}

function data(): OurCategoryEditorData {
  return {
    categoryId: null,
    shopId: '66615491',
    values: {
      name: '',
      templateType: 'single',
      followedTemplateId: null,
      itemCount: 1,
      roomTheme: '',
      backgroundColour: '#F5F0E8',
      printsFrames: true,
      customisePrints: true,
      digitalDownload: true,
      customTop: true,
      customBottom: true,
      printFrameSectionId: null,
      customisedSectionId: null,
      downloadSectionId: null,
      sizes: Object.fromEntries(sizes.map(({ key }) => [key, true])),
      frames: Object.fromEntries(frames.map(({ key }) => [key, true])),
    },
    sizes,
    frames,
    etsySections: [
      { id: 1, title: 'Prints', useForPrintFrames: true, useForCustomisedPrints: false, useForDigitalDownloads: false },
      { id: 2, title: 'Personalised', useForPrintFrames: false, useForCustomisedPrints: true, useForDigitalDownloads: false },
      { id: 3, title: 'Downloads', useForPrintFrames: false, useForCustomisedPrints: false, useForDigitalDownloads: true },
    ],
    imageTemplates: [],
    singleTemplates: [],
    followedImageTemplates: [],
    copySourceTemplates: [],
  };
}

function dataWithTemplate(): OurCategoryEditorData {
  const initial = data();
  return {
    ...initial,
    categoryId: '1',
    values: {
      ...initial.values,
      name: 'Nursery',
      roomTheme: 'Woodland',
      printFrameSectionId: 1,
      customisedSectionId: 2,
      downloadSectionId: 3,
    },
    imageTemplates: [{
      id: '9',
      name: 'Room mockup',
      description: 'A room template',
      originalFileName: 'room.png',
      useOnPrints: true,
      useOnCustomised: true,
      useOnDigital: true,
      imageWidth: null,
      imageHeight: null,
      openingRegions: [],
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

function multipleData(): OurCategoryEditorData {
  const initial = data();
  const followedValues = {
    ...initial.values,
    name: 'Nursery print',
    roomTheme: 'Nursery',
    backgroundColour: '#FAF8F4' as const,
    printFrameSectionId: 1,
    customisedSectionId: 2,
    downloadSectionId: 3,
    sizes: { a5: true, a4: false, a3: true },
    frames: { no_frame: true, black: true, white: false, oak: false },
  };
  return {
    ...initial,
    values: {
      ...initial.values,
      templateType: 'multiple',
      itemCount: 3,
      printsFrames: false,
      customisePrints: false,
      digitalDownload: false,
      customTop: false,
      customBottom: false,
      sizes: { a5: false, a4: false, a3: false },
      frames: { no_frame: false, black: false, white: false, oak: false },
    },
    singleTemplates: [{ id: 2, name: 'Nursery print', values: followedValues }],
  };
}

beforeEach(() => {
  vi.spyOn(window.history, 'pushState').mockImplementation(() => undefined);
  vi.spyOn(window.history, 'forward').mockImplementation(() => undefined);
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('Our Template editor', () => {
  it('opens on the requested Image Templates tab', () => {
    render(<OurCategoryEditorClient initialData={dataWithTemplate()} initialTab="image-templates" />);

    expect(screen.getByRole('tab', { name: 'Image Templates' }).getAttribute('aria-selected')).toBe('true');
    expect(screen.getByText('Room mockup')).toBeTruthy();
    expect(screen.getByRole('row', { name: 'Drag Room mockup to reorder' }).getAttribute('aria-describedby'))
      .toBe('our-template-images-1');
  });

  it('configures a multiple template from the selected single template', async () => {
    const user = userEvent.setup();
    render(<OurCategoryEditorClient initialData={multipleData()} />);
    expect(screen.getByRole('heading', { name: 'Create Multiple Template' })).toBeTruthy();
    expect(screen.queryByLabelText('Room Theme')).toBeNull();
    expect((screen.getByLabelText('Followed Template') as HTMLSelectElement).value).toBe('');
    expect((screen.getByLabelText('No of Items') as HTMLSelectElement).value).toBe('3');
    expect(screen.queryByLabelText('Print / Frames')).toBeNull();
    await user.selectOptions(screen.getByLabelText('Followed Template'), '2');
    expect((screen.getByLabelText('Background Colour') as HTMLSelectElement).value).toBe('#FAF8F4');
    expect((screen.getByLabelText('Print / Frames') as HTMLInputElement).checked).toBe(true);
    expect((screen.getByLabelText('Etsy Print / Frame Section') as HTMLSelectElement).value).toBe('1');
    await user.click(screen.getByRole('tab', { name: 'Print Details' }));
    expect(screen.getByLabelText('A5')).toBeTruthy();
    expect(screen.queryByLabelText('A4')).toBeNull();
    expect(screen.getByLabelText('A3')).toBeTruthy();
    expect(screen.queryByLabelText('White')).toBeNull();
  });

  it('starts with requested product defaults and all print options enabled', async () => {
    const user = userEvent.setup();
    render(<OurCategoryEditorClient initialData={data()} />);
    expect((screen.getByLabelText('Print / Frames') as HTMLInputElement).checked).toBe(true);
    expect((screen.getByLabelText('Customised Prints') as HTMLInputElement).checked).toBe(true);
    expect((screen.getByLabelText('Digital Downloads') as HTMLInputElement).checked).toBe(true);
    expect((screen.getByLabelText('Background Colour') as HTMLSelectElement).value).toBe('#F5F0E8');
    expect((screen.getByLabelText('Customise the Top text') as HTMLInputElement).checked).toBe(true);
    expect((screen.getByLabelText('Customise the Bottom text') as HTMLInputElement).checked).toBe(true);

    await user.click(screen.getByRole('tab', { name: 'Print Details' }));
    for (const option of [...sizes, ...frames]) {
      expect((screen.getByLabelText(option.label) as HTMLInputElement).checked).toBe(true);
    }
  });

  it('shows the three-choice prompt when Back is used after a change', async () => {
    const user = userEvent.setup();
    render(<OurCategoryEditorClient initialData={data()} />);
    await user.type(screen.getByLabelText('Template Name'), 'Nursery');
    await user.click(screen.getByRole('button', { name: 'Back' }));
    expect(screen.getByRole('heading', { name: 'Save changes before leaving?' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Stay on page' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Cancel changes' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Save' })).toBeTruthy();
  });

  it('shows filtered Etsy section lists and one section creator with all usages enabled', async () => {
    const user = userEvent.setup();
    render(<OurCategoryEditorClient initialData={data()} />);
    const back = screen.getByRole('button', { name: 'Back' });
    const create = screen.getByRole('button', { name: 'Create' });
    expect(back.parentElement).toBe(create.parentElement);

    const printSelect = screen.getByLabelText('Etsy Print / Frame Section');
    const customSelect = screen.getByLabelText('Etsy Customised Section');
    const digitalSelect = screen.getByLabelText('Digital Download Section');
    expect(within(printSelect).queryByRole('option', { name: 'Prints' })).toBeTruthy();
    expect(within(printSelect).queryByRole('option', { name: 'Personalised' })).toBeNull();
    expect(within(customSelect).queryByRole('option', { name: 'Personalised' })).toBeTruthy();
    expect(within(customSelect).queryByRole('option', { name: 'Downloads' })).toBeNull();
    expect(within(digitalSelect).queryByRole('option', { name: 'Downloads' })).toBeTruthy();
    expect(within(digitalSelect).queryByRole('option', { name: 'Prints' })).toBeNull();

    expect(screen.queryByRole('button', { name: 'Create Print / Frame Section' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Create Customised Section' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Create Digital Download Section' })).toBeNull();
    await user.click(screen.getByRole('button', { name: 'Create Etsy Section' }));
    const dialog = screen.getByRole('dialog');
    expect(within(dialog).getByRole('heading', { name: 'Create Etsy Section' })).toBeTruthy();
    expect(within(dialog).getByLabelText('Section name')).toBeTruthy();
    expect((within(dialog).getByLabelText('Print / Frames') as HTMLInputElement).checked).toBe(true);
    expect((within(dialog).getByLabelText('Customised') as HTMLInputElement).checked).toBe(true);
    expect((within(dialog).getByLabelText('Digital Downloads') as HTMLInputElement).checked).toBe(true);
  });

  it('creates and selects an Etsy section for the requested product type', async () => {
    const user = userEvent.setup();
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue({
      ok: true,
      json: async () => ({
        section: {
          id: 4,
          title: 'Wall Art',
          useForPrintFrames: true,
          useForCustomisedPrints: true,
          useForDigitalDownloads: true,
        },
      }),
    } as Response);
    render(<OurCategoryEditorClient initialData={data()} />);

    await user.click(screen.getByRole('button', { name: 'Create Etsy Section' }));
    const dialog = screen.getByRole('dialog');
    await user.type(within(dialog).getByLabelText('Section name'), 'Wall Art');
    await user.click(within(dialog).getByRole('button', { name: 'Create' }));

    await waitFor(() => {
      expect((screen.getByLabelText('Etsy Print / Frame Section') as HTMLSelectElement).value).toBe('4');
      expect((screen.getByLabelText('Etsy Customised Section') as HTMLSelectElement).value).toBe('4');
      expect((screen.getByLabelText('Digital Download Section') as HTMLSelectElement).value).toBe('4');
    });
    expect(fetchMock).toHaveBeenCalledWith('/api/our-categories/etsy-sections', expect.objectContaining({
      method: 'POST',
      body: JSON.stringify({
        shopId: '66615491',
        title: 'Wall Art',
        usages: ['printFrames', 'customisedPrints', 'digitalDownloads'],
      }),
    }));
    expect(within(screen.getByLabelText('Digital Download Section')).queryByRole('option', { name: 'Wall Art' })).toBeTruthy();
  });

  it('orders Delete, Test, Make Copy, and Edit and opens their dialogs', async () => {
    const user = userEvent.setup();
    vi.spyOn(globalThis, 'fetch').mockResolvedValue({
      ok: true,
      json: async () => ({
        impact: {
          templateId: '9',
          templateType: 'single',
          dependentTemplateImageCount: 0,
          generatedListingImageCount: 0,
          affectedListingCount: 0,
          requiresCascade: false,
        },
      }),
    } as Response);
    render(<OurCategoryEditorClient initialData={dataWithTemplate()} />);
    await user.click(screen.getByRole('tab', { name: 'Image Templates' }));
    expect(screen.getByRole('link', { name: 'New Create' }).getAttribute('href')).toBe('/our-templates/1/edit/image');
    expect(screen.getByText(/Click and drag a row to change its order/)).toBeTruthy();
    const row = screen.getByText('Room mockup').closest('tr');
    expect(row).toBeTruthy();
    expect(row?.getAttribute('title')).toBe('Click and drag to reorder');
    const actions = within(row!).getAllByRole('button');
    expect(actions.map((button) => button.getAttribute('aria-label'))).toEqual([
      'Delete Room mockup',
      'Test Room mockup',
      'Make copy of Room mockup',
      'Edit Room mockup',
    ]);

    await user.click(actions[3]);
    expect(screen.getByRole('heading', { name: 'Edit Image Template' })).toBeTruthy();
    expect((screen.getByLabelText('Template Name') as HTMLInputElement).value).toBe('Room mockup');
    expect((screen.getByLabelText('Template Image') as HTMLInputElement).required).toBe(false);
    expect((screen.getByLabelText('Border') as HTMLInputElement).checked).toBe(false);
    expect(screen.queryByLabelText('Border Size (%)')).toBeNull();
    await user.click(screen.getByLabelText('Border'));
    const borderSize = screen.getByLabelText('Border Size (%)') as HTMLInputElement;
    expect(borderSize.value).toBe('5');
    expect(borderSize.min).toBe('2.5');
    expect(borderSize.max).toBe('10');
    expect(borderSize.step).toBe('0.5');
    expect((screen.getByLabelText('Top Text') as HTMLInputElement).value).toBe('');
    expect((screen.getByLabelText('Top Text') as HTMLInputElement).maxLength).toBe(40);
    expect((screen.getByLabelText('Bottom Text') as HTMLInputElement).value).toBe('');
    expect((screen.getByLabelText('Bottom Text') as HTMLInputElement).maxLength).toBe(40);
    expect((screen.getByLabelText('Font') as HTMLSelectElement).value).toBe('nunito-semibold');
    expect((screen.getByLabelText('Display fonts') as HTMLInputElement).checked).toBe(false);
    await user.click(screen.getByLabelText('Display fonts'));
    expect((screen.getByLabelText('Top Text') as HTMLInputElement).disabled).toBe(true);
    expect((screen.getByLabelText('Bottom Text') as HTMLInputElement).disabled).toBe(true);
    expect((screen.getByLabelText('Font') as HTMLSelectElement).disabled).toBe(true);
    expect((screen.getByLabelText('Template Image') as HTMLInputElement).disabled).toBe(true);
    expect((screen.getByLabelText('Border') as HTMLInputElement).disabled).toBe(false);
    await user.click(screen.getByRole('button', { name: 'Cancel' }));

    await user.click(actions[0]);
    expect(screen.getByRole('heading', { name: 'Delete Image Template?' })).toBeTruthy();
    expect(await screen.findByText(/This template image is not currently used/)).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Continue' })).toBeTruthy();
    await user.click(screen.getByRole('button', { name: 'Cancel' }));

    await user.click(actions[1]);
    expect(screen.getByRole('heading', { name: 'Test Room mockup' })).toBeTruthy();
    expect(screen.getByLabelText('Image to attach')).toBeTruthy();
  });

  it('makes an independent image-template copy at the bottom of the list', async () => {
    const user = userEvent.setup();
    const initial = dataWithTemplate();
    const copiedTemplate = {
      ...initial.imageTemplates[0],
      id: '10',
      name: 'Copied from Room mockup',
      createdAt: new Date(1).toISOString(),
      updatedAt: new Date(1).toISOString(),
    };
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue({
      ok: true,
      json: async () => ({ template: copiedTemplate }),
    } as Response);
    render(<OurCategoryEditorClient initialData={initial} />);

    await user.click(screen.getByRole('tab', { name: 'Image Templates' }));
    await user.click(screen.getByRole('button', { name: 'Make copy of Room mockup' }));

    expect(await screen.findByText('Copied from Room mockup')).toBeTruthy();
    const rows = screen.getAllByRole('row').slice(1);
    expect(within(rows.at(-1)!).getByText('Copied from Room mockup')).toBeTruthy();
    expect(fetchMock).toHaveBeenCalledWith('/api/our-categories/templates/9/copy', { method: 'POST' });
  });

  it('warns about and deletes generated listing images and linked multiple-template images', async () => {
    const user = userEvent.setup();
    const fetchMock = vi.spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          impact: {
            templateId: '9',
            templateType: 'single',
            dependentTemplateImageCount: 2,
            generatedListingImageCount: 3,
            affectedListingCount: 2,
            requiresCascade: true,
          },
        }),
      } as Response)
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          deletedId: '9',
          deletedTemplateIds: ['9', '20', '21'],
          deletedListingImageCount: 3,
        }),
      } as Response);
    render(<OurCategoryEditorClient initialData={dataWithTemplate()} />);

    await user.click(screen.getByRole('tab', { name: 'Image Templates' }));
    await user.click(screen.getByRole('button', { name: 'Delete Room mockup' }));

    expect(await screen.findByText(/used by 2 multiple-template images and has 3 generated listing images/)).toBeTruthy();
    await user.click(screen.getByRole('button', { name: 'Continue' }));

    await waitFor(() => expect(screen.queryByText('Room mockup')).toBeNull());
    expect(fetchMock).toHaveBeenNthCalledWith(1, '/api/our-categories/templates/9');
    expect(fetchMock).toHaveBeenNthCalledWith(2, '/api/our-categories/templates/9', { method: 'DELETE' });
  });

  it('shows a separate grid editor icon for templates created with New Create', async () => {
    const user = userEvent.setup();
    const initial = dataWithTemplate();
    initial.imageTemplates[0] = {
      ...initial.imageTemplates[0],
      openingRegions: [{ ...openingRegion(1, 1), grid: defaultTemplateGridLayout(1) }],
    };
    render(<OurCategoryEditorClient initialData={initial} />);

    await user.click(screen.getByRole('tab', { name: 'Image Templates' }));

    expect(screen.getByRole('link', { name: 'Edit Room mockup in grid editor' }).getAttribute('href'))
      .toBe('/our-templates/1/edit/image/9');
    expect(screen.queryByRole('button', { name: 'Edit Room mockup' })).toBeNull();
  });

  it('tests a generated font showcase without requesting an artwork image', async () => {
    const user = userEvent.setup();
    const initial = dataWithTemplate();
    initial.imageTemplates[0] = { ...initial.imageTemplates[0], displayFonts: true };
    render(<OurCategoryEditorClient initialData={initial} />);

    await user.click(screen.getByRole('tab', { name: 'Image Templates' }));
    await user.click(screen.getByRole('button', { name: 'Test Room mockup' }));

    expect(screen.getByText('This generated showcase displays every available font and does not require an attached image.')).toBeTruthy();
    expect(screen.queryByLabelText('Image to attach')).toBeNull();
    expect((screen.getByRole('button', { name: 'Test' }) as HTMLButtonElement).disabled).toBe(false);
  });

  it('requests the configured number of images when testing a multiple template', async () => {
    const user = userEvent.setup();
    const initial = multipleData();
    const existingTemplate = {
      ...dataWithTemplate().imageTemplates[0],
      openingRegions: [openingRegion(1, 1), openingRegion(2, 2), openingRegion(3, 3)],
    };
    render(<OurCategoryEditorClient initialData={{
      ...initial,
      categoryId: '10',
      values: {
        ...initial.values,
        name: 'Nursery set',
        followedTemplateId: 2,
        itemCount: 3,
      },
      imageTemplates: [existingTemplate],
    }} />);

    await user.click(screen.getByRole('tab', { name: 'Image Templates' }));
    await user.click(screen.getByRole('button', { name: 'Test Room mockup' }));

    expect(screen.getByText('Add the 3 images required by this image template.', { exact: false })).toBeTruthy();
    expect(screen.getByLabelText('Image 1')).toBeTruthy();
    expect(screen.getByLabelText('Image 2')).toBeTruthy();
    expect(screen.getByLabelText('Image 3')).toBeTruthy();
    expect(screen.queryByLabelText('Image 4')).toBeNull();
    expect((screen.getByRole('button', { name: 'Test' }) as HTMLButtonElement).disabled).toBe(true);
  });

  it('requests only the distinct images used by an image template, including a linked single image', async () => {
    const user = userEvent.setup();
    const initial = multipleData();
    const baseTemplate = dataWithTemplate().imageTemplates[0];
    const threeImageTemplate = {
      ...baseTemplate,
      id: '40',
      name: 'Three-image room',
      openingRegions: [
        openingRegion(2, 1),
        openingRegion(4, 2),
        openingRegion(6, 3),
        openingRegion(4, 4),
      ],
    };
    const linkedSingleTemplate = {
      ...baseTemplate,
      id: '41',
      name: 'Linked single room',
      openingRegions: [openingRegion(5, 1), openingRegion(5, 2)],
      isLinked: true,
      linkedSourceCategoryId: 2,
      linkedSourceImageTemplateId: 9,
      linkedImageItemNumber: 5,
      linkedSourceTemplateName: 'Nursery print',
      linkedSourceImageTemplateName: 'Room mockup',
    };
    render(<OurCategoryEditorClient initialData={{
      ...initial,
      categoryId: '16',
      values: { ...initial.values, name: 'Six print set', followedTemplateId: 2, itemCount: 6 },
      imageTemplates: [threeImageTemplate, linkedSingleTemplate],
    }} />);

    await user.click(screen.getByRole('tab', { name: 'Image Templates' }));
    await user.click(screen.getByRole('button', { name: 'Test Three-image room' }));
    expect(screen.getByLabelText('Image 2')).toBeTruthy();
    expect(screen.getByLabelText('Image 4')).toBeTruthy();
    expect(screen.getByLabelText('Image 6')).toBeTruthy();
    expect(screen.queryByLabelText('Image 1')).toBeNull();
    expect(screen.queryByLabelText('Image 3')).toBeNull();
    await user.click(screen.getByRole('button', { name: 'Cancel' }));

    await user.click(screen.getByRole('button', { name: 'Test Linked single room' }));
    expect(screen.getByText('Add the 1 image required by this image template.', { exact: false })).toBeTruthy();
    expect(screen.getByLabelText('Image 5')).toBeTruthy();
    expect(screen.queryByLabelText('Image 1')).toBeNull();
  });

  it('copies an image from a compatible single or same-size multiple template', async () => {
    const user = userEvent.setup();
    const initial = multipleData();
    const sourceImage = dataWithTemplate().imageTemplates[0];
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue({
      ok: true,
      json: async () => ({ template: { ...sourceImage, id: '30' } }),
    } as Response);
    render(<OurCategoryEditorClient initialData={{
      ...initial,
      categoryId: '12',
      values: { ...initial.values, name: 'Nursery set', followedTemplateId: 2 },
      followedImageTemplates: [sourceImage],
      copySourceTemplates: [
        { id: 2, name: 'Nursery print', templateType: 'single', itemCount: 1, imageTemplates: [sourceImage] },
        { id: 14, name: 'Other set', templateType: 'multiple', itemCount: 3, imageTemplates: [{ ...sourceImage, id: '19' }] },
      ],
    }} />);

    await user.click(screen.getByRole('tab', { name: 'Image Templates' }));
    const createButton = screen.getByRole('button', { name: 'Create' });
    expect(createButton.parentElement?.textContent).toContain('Copy FromLinkNew CreateCreate');
    expect(screen.getByRole('link', { name: 'New Create' }).getAttribute('href')).toBe('/our-templates/12/edit/image');
    await user.click(screen.getByRole('button', { name: 'Copy From' }));
    expect(screen.getByRole('heading', { name: 'Copy Image Template' })).toBeTruthy();
    expect(within(screen.getByLabelText('Copy from template')).getByRole('option', { name: 'Nursery print (Single)' })).toBeTruthy();
    expect(within(screen.getByLabelText('Copy from template')).getByRole('option', { name: 'Other set (3 items)' })).toBeTruthy();
    await user.selectOptions(screen.getByLabelText('Copy from template'), '14');
    expect((screen.getByLabelText('Copy image selection') as HTMLInputElement).value).toBe('All');
    await user.selectOptions(screen.getByLabelText('Image template to copy'), '19');
    expect((screen.getByRole('button', { name: 'Copy' }) as HTMLButtonElement).disabled).toBe(false);
    await user.selectOptions(screen.getByLabelText('Copy from template'), '2');
    await user.selectOptions(screen.getByLabelText('Image template to copy'), '9');
    await user.selectOptions(screen.getByLabelText('Copy to image number'), '2');
    await user.click(screen.getByRole('button', { name: 'Copy' }));

    expect(fetchMock).toHaveBeenCalledWith('/api/our-categories/12/templates/copy', expect.objectContaining({
      method: 'POST',
      body: JSON.stringify({ sourceCategoryId: '2', sourceTemplateId: '9', imageItemNumbers: [2] }),
    }));
  });

  it('requires a unique target image for every image in a smaller multiple template', async () => {
    const user = userEvent.setup();
    const initial = multipleData();
    const sourceImage = dataWithTemplate().imageTemplates[0];
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue({
      ok: true,
      json: async () => ({ template: { ...sourceImage, id: '32' } }),
    } as Response);
    render(<OurCategoryEditorClient initialData={{
      ...initial,
      categoryId: '16',
      values: { ...initial.values, name: 'Six print set', followedTemplateId: 2, itemCount: 6 },
      copySourceTemplates: [
        { id: 14, name: 'Three print set', templateType: 'multiple', itemCount: 3, imageTemplates: [sourceImage] },
      ],
    }} />);

    await user.click(screen.getByRole('tab', { name: 'Image Templates' }));
    await user.click(screen.getByRole('button', { name: 'Copy From' }));
    await user.selectOptions(screen.getByLabelText('Copy from template'), '14');
    await user.selectOptions(screen.getByLabelText('Image template to copy'), '9');
    const copyButton = screen.getByRole('button', { name: 'Copy' }) as HTMLButtonElement;
    expect(copyButton.disabled).toBe(true);
    expect(screen.getByText('Select 3 different target images before copying.')).toBeTruthy();
    await user.selectOptions(screen.getByLabelText('Copy source Image 1 to'), '2');
    await user.selectOptions(screen.getByLabelText('Copy source Image 2 to'), '4');
    await user.selectOptions(screen.getByLabelText('Copy source Image 3 to'), '4');
    expect(copyButton.disabled).toBe(true);
    await user.selectOptions(screen.getByLabelText('Copy source Image 3 to'), '6');
    expect(copyButton.disabled).toBe(false);
    await user.click(copyButton);

    expect(fetchMock).toHaveBeenCalledWith('/api/our-categories/16/templates/copy', expect.objectContaining({
      method: 'POST',
      body: JSON.stringify({ sourceCategoryId: '14', sourceTemplateId: '9', imageItemNumbers: [2, 4, 6] }),
    }));
  });

  it('links a followed image template to a selected image number and marks it as linked', async () => {
    const user = userEvent.setup();
    const initial = multipleData();
    const sourceImage = dataWithTemplate().imageTemplates[0];
    const linkedImage = {
      ...sourceImage,
      id: '31',
      name: 'Room mockup - Image 3',
      isLinked: true,
      linkedSourceCategoryId: 2,
      linkedSourceImageTemplateId: 9,
      linkedImageItemNumber: 3,
      linkedSourceTemplateName: 'Nursery print',
      linkedSourceImageTemplateName: 'Room mockup',
    };
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue({
      ok: true,
      json: async () => ({ template: linkedImage }),
    } as Response);
    render(<OurCategoryEditorClient initialData={{
      ...initial,
      categoryId: '12',
      values: { ...initial.values, name: 'Nursery set', followedTemplateId: 2 },
      followedImageTemplates: [sourceImage],
    }} />);

    await user.click(screen.getByRole('tab', { name: 'Image Templates' }));
    await user.click(screen.getByRole('button', { name: 'Link' }));
    expect(screen.getByRole('heading', { name: 'Link Image Template' })).toBeTruthy();
    await user.selectOptions(screen.getByLabelText('Image template to link'), '9');
    expect(within(screen.getByLabelText('Linked image number')).getAllByRole('option').map((option) => option.textContent)).toEqual([
      'Image 1',
      'Image 2',
      'Image 3',
    ]);
    await user.selectOptions(screen.getByLabelText('Linked image number'), '3');
    await user.click(screen.getByRole('button', { name: 'Select' }));

    expect(fetchMock).toHaveBeenCalledWith('/api/our-categories/12/templates/link', expect.objectContaining({
      method: 'POST',
      body: JSON.stringify({ sourceTemplateId: '9', imageItemNumber: 3 }),
    }));
    expect(screen.getByText('Linked')).toBeTruthy();
    expect(screen.getByText('Nursery print / Room mockup / Image 3')).toBeTruthy();
    expect((screen.getByRole('button', { name: 'Edit Room mockup - Image 3' }) as HTMLButtonElement).disabled).toBe(true);
  });
});
