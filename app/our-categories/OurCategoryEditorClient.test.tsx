import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { OurCategoryEditorData } from '@/lib/our-categories';
import { defaultTemplateGridLayout } from '@/lib/template-grid-layout';
import { OurCategoryEditorClient } from './OurCategoryEditorClient';

vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }));
// Delivery settings have their own request and interaction tests. Keep these
// template/image workflow tests scoped to the requests they exercise.
vi.mock('@/components/MarketsDeliverySettings', () => ({ MarketsDeliverySettings: () => null }));

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
  window.history.replaceState({}, '', '/');
  vi.spyOn(window.history, 'pushState').mockImplementation(() => undefined);
  vi.spyOn(window.history, 'forward').mockImplementation(() => undefined);
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('Our Template editor', () => {
  it('shows whole definitions with only Delete and parent Edit, retaining the row order handle', () => {
    const initial = dataWithTemplate();
    initial.imageTemplates[0] = { ...initial.imageTemplates[0], name: 'Old attachment name', templateImageDefinitionId: 'global-definition',
      definitionName: 'Current global name', definitionMode: 'combined' };
    render(<OurCategoryEditorClient initialData={initial} initialTab="image-templates" />);
    expect(screen.getAllByRole('columnheader').map(header => header.textContent)).toEqual(['Order', 'Name', 'Description', 'Used On', 'Actions']);
    const row = screen.getByRole('row', { name: 'Drag Current global name to reorder' });
    expect(row.getAttribute('title')).toBe('Click and drag to reorder');
    expect(within(row).getByText('A room template')).toBeTruthy();
    expect(within(row).getByText('Prints, Customised prints, Digital downloads')).toBeTruthy();
    expect(within(row).getAllByRole('button').map(button => button.getAttribute('aria-label'))).toEqual(['Delete Current global name']);
    const editUrl = new URL(within(row).getByRole('link', { name: 'Edit Current global name' }).getAttribute('href')!, window.location.origin);
    expect(editUrl.pathname).toBe('/our-template-images');
    expect(editUrl.searchParams.get('definition')).toBe('global-definition');
    expect(editUrl.searchParams.get('returnTo')).toBe('/our-templates/1/edit?tab=image-templates');
    expect(screen.queryByText('Old attachment name')).toBeNull();
    for (const name of ['Copy From', 'Link', 'Create', 'Test Current global name', 'Make copy of Current global name']) expect(screen.queryByRole('button', { name })).toBeNull();
    expect(screen.getByRole('button', { name: 'Create PNG' })).toBeTruthy();
  });

  it.each([
    '/our-templates/25/edit',
    '/our-templates/25/edit?tab=details&filter=Nursery#role-9',
  ])('carries the owning template Image Templates tab into its global Edit link from %s', currentUrl => {
    window.history.replaceState({}, '', currentUrl);
    const initial = dataWithTemplate(); initial.categoryId = '25';
    initial.imageTemplates[0] = { ...initial.imageTemplates[0], templateImageDefinitionId: 'global-definition', definitionName: 'Global room', isLinked: true, linkedSourceCategoryId: 7 };
    render(<OurCategoryEditorClient initialData={initial} initialTab="image-templates" />);
    const editUrl = new URL(screen.getByRole('link', { name: 'Edit Global room' }).getAttribute('href')!, window.location.origin);
    expect(editUrl.pathname).toBe('/our-template-images');
    expect(editUrl.searchParams.get('definition')).toBe('global-definition');
    expect(editUrl.searchParams.get('returnTo')).toBe('/our-templates/25/edit?tab=image-templates');
  });

  it('adds a multi-artwork global definition to a single template with its description and selected products', async () => {
    const user = userEvent.setup(), initial = dataWithTemplate();
    const attached = { ...initial.imageTemplates[0], templateImageDefinitionId: 'four-artworks', definitionName: 'Combined room',
      definitionMode: 'combined' as const, description: 'Four matching prints', useOnCustomised: false, useOnDigital: false };
    initial.imageTemplates = [];
    const candidate = { id: 'four-artworks', name: 'Combined room', mode: 'combined', createdAt: '2026-01-01', updatedAt: '2026-01-01',
      images: [{ id: 'scene-four', name: 'Four frames', width: 1200, height: 800, updatedAt: '2026-01-01', tags: [],
        openings: [1, 2, 3, 4].map(item => ({ ...openingRegion(item, item), orientation: item % 2 ? 'portrait' : 'landscape' })) }] };
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockImplementation(async (url, options) => {
      if (String(url) === '/api/our-template-image-definitions') return { ok: true, json: async () => ({ definitions: [candidate] }) } as Response;
      if (String(url) === '/api/our-template-image-tags') return { ok: true, json: async () => ({ tags: [] }) } as Response;
      if (options?.method === 'POST') return { ok: true, json: async () => ({ template: attached }) } as Response;
      throw new Error(`Unexpected request ${url}`);
    });
    render(<OurCategoryEditorClient initialData={initial} initialTab="image-templates" />);
    await user.click(screen.getByRole('button', { name: 'Add Our Template Image' }));
    await user.click(await screen.findByRole('button', { name: 'Select Combined room' }));
    const dialog = screen.getByRole('dialog', { name: 'Add Our Template Image' });
    expect(within(dialog).getByText(/4 distinct artwork items/)).toBeTruthy();
    await user.clear(within(dialog).getByLabelText('Description'));
    await user.type(within(dialog).getByLabelText('Description'), attached.description);
    await user.click(within(dialog).getByLabelText('Customised prints'));
    await user.click(within(dialog).getByLabelText('Digital downloads'));
    await user.click(within(dialog).getByRole('button', { name: 'Add template image' }));
    const row = await screen.findByRole('row', { name: 'Drag Combined room to reorder' });
    expect(within(row).getByText(attached.description)).toBeTruthy();
    expect(within(row).getByText('Prints')).toBeTruthy();
    const post = fetchMock.mock.calls.find(([, options]) => options?.method === 'POST')!;
    expect(post[0]).toBe('/api/our-categories/1/templates');
    const form = post[1]!.body as FormData;
    expect(form.get('templateImageDefinitionId')).toBe('four-artworks');
    expect(form.has('ourTemplateImageId')).toBe(false); expect(form.has('file')).toBe(false);
    expect(form.get('description')).toBe(attached.description);
    expect(form.get('useOnPrints')).toBe('true'); expect(form.get('useOnCustomised')).toBe('false'); expect(form.get('useOnDigital')).toBe('false');
  });
  it('defaults legacy orientation flags to both enabled and saves a valid selection after rejecting neither', async () => {
    const user = userEvent.setup();
    const initial = dataWithTemplate();
    const saved = { ...initial, values: { ...initial.values, portraitEnabled: true, landscapeEnabled: false } };
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue({ ok: true, json: async () => ({ data: saved }) } as Response);
    render(<OurCategoryEditorClient initialData={initial} />);
    expect((screen.getByRole('checkbox', { name: 'Portrait' }) as HTMLInputElement).checked).toBe(true);
    expect((screen.getByRole('checkbox', { name: 'Landscape' }) as HTMLInputElement).checked).toBe(true);
    await user.click(screen.getByRole('checkbox', { name: 'Portrait' }));
    expect((screen.getByRole('button', { name: 'Save' }) as HTMLButtonElement).disabled).toBe(false);
    await user.click(screen.getByRole('checkbox', { name: 'Landscape' }));
    expect(screen.getByRole('alert').textContent).toContain('Select at least one artwork orientation');
    const invalidSave = screen.getByRole('button', { name: 'Save' }) as HTMLButtonElement;
    expect(invalidSave.disabled).toBe(true);
    await user.click(invalidSave);
    expect(fetchMock).not.toHaveBeenCalled();
    await user.click(screen.getByRole('checkbox', { name: 'Portrait' }));
    await user.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(fetchMock).toHaveBeenCalledWith('/api/our-categories/1', expect.objectContaining({ method: 'PUT' })));
    const body = JSON.parse((fetchMock.mock.calls[0][1] as RequestInit).body as string);
    expect(body).toMatchObject({ name: initial.values.name, portraitEnabled: true, landscapeEnabled: false, printsFrames: true });
  });

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

  it('keeps only Delete and Edit actions and preserves the legacy PNG editor', async () => {
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
    expect(screen.getByText(/Drag a row to change the order of listing images/)).toBeTruthy();
    const row = screen.getByText('Room mockup').closest('tr');
    expect(row).toBeTruthy();
    expect(row?.getAttribute('title')).toBe('Click and drag to reorder');
    const actions = within(within(row!).getAllByRole('cell').at(-1)!).getAllByRole('button');
    expect(actions.map((button) => button.getAttribute('aria-label'))).toEqual([
      'Delete Room mockup',
      'Edit Room mockup',
    ]);

    await user.click(actions[1]);
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


});
