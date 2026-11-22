import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { SubSectionListingsTable } from '@/app/listings/SubSectionListingsTable';
import type { SubSectionListingsPageData } from '@/lib/listing-table';

const data: SubSectionListingsPageData = {
  shop: { id: '66615491', shopName: 'Test Shop' },
  section: { id: '3', sectionName: 'Sets of 3' },
  subSection: {
    id: '8',
    name: 'Sea Creatures',
    numberOfDownloads: 3,
    includeAllDownloads: false,
  },
  templates: [],
  listings: [{
    id: '500',
    listingName: 'Sea Creatures Set',
    artworkOrientation: null,
    sourceSectionName: 'Kids & Nursery Prints',
    templateProducts: {
      printsFrames: true,
      customisedPrints: true,
      digitalDownload: true,
    },
    status: 'incomplete',
    isComplete: false,
    price: 'GBP 29.99',
    hasPrice: true,
    quantity: 999,
    hasEtsyListingId: false,
  }],
};

describe('SubSectionListingsTable categories', () => {
  it('opens the whole-section gallery between Generate and Edit even when the displayed subsection is empty', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ sectionName: data.section.sectionName,
      listings: [{ id: '701', listingName: 'Artwork from another subsection', hasThumbnail: true,
        thumbnailUpdatedAt: '2026-11-22T09:00:00.000Z', subSectionId: '9' }] }) });
    vi.stubGlobal('fetch', fetchMock);
    render(<SubSectionListingsTable data={{ ...data, listings: [] }} shopId="66615491" sectionId="3" subSectionId="8" />);
    const gallery = screen.getByRole('button', { name: 'View section images' });
    const generate = screen.getByRole('button', { name: 'Generate' });
    const edit = screen.getByRole('button', { name: 'Edit listing' });
    expect(generate.parentElement).toBe(gallery.parentElement);
    expect(gallery.nextElementSibling).toBe(edit);
    expect(generate.nextElementSibling).toBe(gallery);
    expect((gallery as HTMLButtonElement).disabled).toBe(false);
    expect(fetchMock).not.toHaveBeenCalled();
    fireEvent.click(gallery);
    const dialog = await screen.findByRole('dialog', { name: `Images: ${data.section.sectionName}` });
    expect(await screen.findByText('Artwork from another subsection')).toBeTruthy();
    expect(fetchMock).toHaveBeenCalledWith('/api/shops/listings/gallery?shopId=66615491&sectionId=3', expect.objectContaining({ cache: 'no-store' }));
    const image = screen.getByRole('img', { name: 'Artwork from another subsection artwork thumbnail' }) as HTMLImageElement;
    const source = new URL(image.src);
    expect(source.searchParams.get('subSectionId')).toBe('9');
    expect(source.searchParams.get('preview')).toBe('1');
    fireEvent.keyDown(dialog, { key: 'Escape' });
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    await waitFor(() => expect(document.activeElement).toBe(gallery));
  });

  it('places thumbnail preview before Delete and opens the selected row original with scoped/versioned URL', async () => {
    const thumbnailData: SubSectionListingsPageData = {
      ...data, subSection: { ...data.subSection, numberOfDownloads: 1 },
      listings: [
        { ...data.listings[0], hasThumbnail: true, thumbnailUpdatedAt: '2026-11-21T16:00:00.000Z' },
        { ...data.listings[0], id: '501', listingName: 'Fox print', hasThumbnail: true, thumbnailUpdatedAt: '2026-11-21T16:05:00.000Z' },
      ],
    };
    render(<SubSectionListingsTable data={thumbnailData} shopId="66615491" sectionId="3" subSectionId="8" />);
    const preview = screen.getByRole('button', { name: 'Preview thumbnail for Fox print' });
    const remove = screen.getByRole('button', { name: 'Delete Fox print' });
    expect(preview.parentElement).toBe(remove.parentElement);
    expect(preview.compareDocumentPosition(remove) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(screen.queryByRole('img')).toBeNull();
    fireEvent.click(preview);
    expect(screen.getByRole('dialog', { name: 'Thumbnail: Fox print' })).toBeTruthy();
    const image = screen.getByRole('img', { name: 'Fox print artwork thumbnail' }) as HTMLImageElement;
    const url = new URL(image.src);
    expect(url.pathname).toBe('/api/shops/listings/thumbnail');
    expect(Object.fromEntries(url.searchParams)).toEqual({
      shopId: '66615491', sectionId: '3', subSectionId: '8', listingId: '501', v: '2026-11-21T16:05:00.000Z',
    });
    expect(url.searchParams.has('preview')).toBe(false);
    expect(screen.getByRole('status').textContent).toBe('Loading thumbnail...');
    fireEvent.load(image);
    expect(screen.queryByText('Loading thumbnail...')).toBeNull();
    fireEvent.keyDown(screen.getByRole('dialog'), { key: 'Escape' });
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    await waitFor(() => expect(document.activeElement).toBe(preview));
    fireEvent.click(preview);
    fireEvent.click(screen.getByRole('button', { name: 'Close' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
  });

  it('disables previews for missing or unknown thumbnails without rendering an image or fetching', () => {
    const fetchMock = vi.fn(); vi.stubGlobal('fetch', fetchMock);
    const missingData: SubSectionListingsPageData = {
      ...data, subSection: { ...data.subSection, numberOfDownloads: 1 },
      listings: [
        { ...data.listings[0], hasThumbnail: false },
        { ...data.listings[0], id: '501', listingName: 'Unknown thumbnail' },
      ],
    };
    render(<SubSectionListingsTable data={missingData} shopId="66615491" sectionId="3" subSectionId="8" />);
    for (const name of ['Sea Creatures Set', 'Unknown thumbnail']) {
      const preview = screen.getByRole('button', { name: `Preview thumbnail for ${name}` }) as HTMLButtonElement;
      expect(preview.disabled).toBe(true);
      fireEvent.click(preview);
    }
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(screen.queryByRole('img')).toBeNull();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('shows a recoverable image error and retries the same original with a fresh URL', () => {
    const thumbnailData: SubSectionListingsPageData = {
      ...data, subSection: { ...data.subSection, numberOfDownloads: 1 }, listings: [{ ...data.listings[0], hasThumbnail: true }],
    };
    render(<SubSectionListingsTable data={thumbnailData} shopId="66615491" sectionId="3" subSectionId="8" />);
    fireEvent.click(screen.getByRole('button', { name: 'Preview thumbnail for Sea Creatures Set' }));
    const image = screen.getByRole('img', { name: 'Sea Creatures Set artwork thumbnail' }) as HTMLImageElement;
    const original = new URL(image.src);
    fireEvent.error(image);
    expect(screen.getByRole('alert').textContent).toContain('Unable to load');
    expect(screen.queryByText('Loading thumbnail...')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Retry image' }));
    const retried = screen.getByRole('img', { name: 'Sea Creatures Set artwork thumbnail' }) as HTMLImageElement;
    const retryUrl = new URL(retried.src);
    expect(retryUrl.pathname).toBe(original.pathname);
    expect(retryUrl.searchParams.get('listingId')).toBe('500');
    expect(retryUrl.searchParams.get('retry')).toBe('1');
    expect(retryUrl.searchParams.has('preview')).toBe(false);
    expect(screen.queryByRole('alert')).toBeNull();
    expect(screen.getByRole('status').textContent).toBe('Loading thumbnail...');
    fireEvent.load(retried);
    expect(screen.queryByRole('status')).toBeNull();
  });

  it('closes the preview when its destination changes or the selected listing disappears', async () => {
    const thumbnailData: SubSectionListingsPageData = {
      ...data, subSection: { ...data.subSection, numberOfDownloads: 1 }, listings: [{ ...data.listings[0], hasThumbnail: true }],
    };
    const { rerender } = render(<SubSectionListingsTable data={thumbnailData} shopId="66615491" sectionId="3" subSectionId="8" />);
    fireEvent.click(screen.getByRole('button', { name: 'Preview thumbnail for Sea Creatures Set' }));
    expect(screen.getByRole('dialog')).toBeTruthy();
    const movedData: SubSectionListingsPageData = {
      ...thumbnailData, section: { id: '4', sectionName: 'New section' }, subSection: { ...thumbnailData.subSection, id: '9' },
    };
    rerender(<SubSectionListingsTable data={movedData} shopId="66615491" sectionId="4" subSectionId="9" />);
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(screen.queryByRole('img')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Preview thumbnail for Sea Creatures Set' }));
    const image = screen.getByRole('img') as HTMLImageElement;
    expect(new URL(image.src).searchParams.get('sectionId')).toBe('4');
    expect(new URL(image.src).searchParams.get('subSectionId')).toBe('9');
    rerender(<SubSectionListingsTable data={{ ...movedData, listings: [] }} shopId="66615491" sectionId="4" subSectionId="9" />);
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(screen.queryByRole('img')).toBeNull();
  });

  it('reviews a ZIP before inserting and refreshes the table without closing the review', async () => {
    const emptyData: SubSectionListingsPageData = { ...data, subSection: { ...data.subSection, numberOfDownloads: 1 }, listings: [] };
    const importedData: SubSectionListingsPageData = { ...emptyData, listings: [{ ...data.listings[0], listingName: 'Imported Otter' }] };
    const review = { sessionId: '10000000-0000-4000-8000-000000000001', templateName: 'Woodland print', total: 1, cursor: 0,
      insertedCount: 0, skippedCount: 0, expiresAt: new Date(Date.now() + 1_800_000).toISOString(), current: {
        index: 0, rowNumber: 2, title: 'Imported Otter', description: 'Otter beside the river.', relativeFilename: 'otter.png',
        originalFileName: 'otter.png', width: 80, height: 100, orientation: 'portrait', error: null,
      } };
    const fetchMock = vi.fn().mockImplementation(async (url: string, options?: RequestInit) => {
      if (options?.method === 'DELETE') return { ok: true, json: async () => ({ closed: true }) };
      if (options?.body instanceof FormData) return { ok: true, json: async () => ({ review }) };
      if (options?.method === 'POST') return { ok: true, json: async () => ({ data: importedData,
        review: { ...review, cursor: 1, insertedCount: 1, current: null } }) };
      if (url.startsWith('/api/shops/listings?')) return { ok: true, json: async () => ({ data: importedData }) };
      return { ok: true, json: async () => ({ templates: [{ id: '15', name: 'Woodland print', templateType: 'single', itemCount: 1 }] }) };
    });
    vi.stubGlobal('fetch', fetchMock);
    const { container } = render(<SubSectionListingsTable data={emptyData} shopId="66615491" sectionId="3" subSectionId="8" />);
    fireEvent.click(screen.getByRole('button', { name: 'Import' }));
    await screen.findByRole('option', { name: 'Woodland print' });
    fireEvent.change(screen.getByLabelText('Import template'), { target: { value: '15' } });
    fireEvent.change(screen.getByLabelText('ZIP archive'), { target: { files: [new File(['ZIP'], 'otter.zip')] } });
    fireEvent.click(screen.getByRole('button', { name: 'Import listings' }));
    expect(await screen.findByText('Otter beside the river.')).toBeTruthy();
    expect(container.querySelector('[data-listing-id="500"]')).toBeNull();
    expect(fetchMock).toHaveBeenCalledTimes(2);
    fireEvent.click(screen.getByRole('button', { name: 'Insert' }));
    await waitFor(() => expect(container.querySelector('[data-listing-id="500"]')?.textContent).toContain('Imported Otter'));
    expect(screen.getByRole('dialog')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Done' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(screen.getByRole('status').textContent).toBe('1 listing inserted. 0 skipped.');
  });

  it('disables table mutation buttons while importing and releases them on a server error', async () => {
    const singleData: SubSectionListingsPageData = { ...data, subSection: { ...data.subSection, numberOfDownloads: 1 } };
    let respond!: (response: unknown) => void;
    const fetchMock = vi.fn().mockResolvedValueOnce({ ok: true, json: async () => ({ templates: [
      { id: '15', name: 'Woodland print', templateType: 'single', itemCount: 1 },
    ] }) }).mockImplementationOnce(() => new Promise((resolve) => { respond = resolve; }));
    vi.stubGlobal('fetch', fetchMock);
    render(<SubSectionListingsTable data={singleData} shopId="66615491" sectionId="3" subSectionId="8" />);
    const generate = screen.getByRole('button', { name: 'Generate' }) as HTMLButtonElement;
    const add = screen.getByRole('button', { name: 'Add listing' }) as HTMLButtonElement;
    const remove = screen.getByRole('button', { name: 'Delete Sea Creatures Set' }) as HTMLButtonElement;
    fireEvent.click(screen.getByRole('button', { name: 'Import' }));
    await screen.findByRole('option', { name: 'Woodland print' });
    fireEvent.change(screen.getByLabelText('Import template'), { target: { value: '15' } });
    fireEvent.change(screen.getByLabelText('ZIP archive'), { target: { files: [new File(['ZIP'], 'otter.zip')] } });
    fireEvent.click(screen.getByRole('button', { name: 'Import listings' }));
    expect(generate.disabled).toBe(true); expect(add.disabled).toBe(true); expect(remove.disabled).toBe(true);
    fireEvent.click(generate); fireEvent.click(add); fireEvent.click(remove);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    await act(async () => respond({ ok: false, json: async () => ({ error: 'CSV row 2: image missing.' }) }));
    expect(screen.getByRole('alert').textContent).toContain('CSV row 2');
    expect(generate.disabled).toBe(false); expect(add.disabled).toBe(false); expect(remove.disabled).toBe(false);
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('loads newly created templates when opening Create Listing without losing the draft', async () => {
    const initialData: SubSectionListingsPageData = {
      ...data,
      subSection: { ...data.subSection, numberOfDownloads: 1 },
    };
    const refreshedData: SubSectionListingsPageData = {
      ...initialData,
      templates: [
        { id: 15, name: 'Contemporary wall art', templateType: 'single', itemCount: 1 },
        { id: 16, name: 'Contemporary set of 3', templateType: 'multiple', itemCount: 3 },
      ],
    };
    let respond!: (response: unknown) => void;
    const fetchMock = vi.fn().mockImplementation(() => new Promise((resolve) => { respond = resolve; }));
    vi.stubGlobal('fetch', fetchMock);
    render(<SubSectionListingsTable data={initialData} shopId="66615491" sectionId="15" subSectionId="27" />);
    fireEvent.click(screen.getByRole('button', { name: 'Add listing' }));
    expect(screen.getByRole('status').textContent).toBe('Loading templates...');
    fireEvent.change(screen.getByLabelText('Listing name'), { target: { value: 'Jellyfish' } });
    respond({ ok: true, json: async () => ({ data: refreshedData }) });
    expect(await screen.findByRole('option', { name: 'Contemporary wall art' })).toBeTruthy();
    expect(screen.queryByRole('option', { name: 'Contemporary set of 3' })).toBeNull();
    expect((screen.getByLabelText('Listing name') as HTMLInputElement).value).toBe('Jellyfish');
    expect(fetchMock).toHaveBeenCalledWith('/api/shops/listings?shopId=66615491&sectionId=15&subSectionId=27', expect.objectContaining({ cache: 'no-store' }));
    fireEvent.change(screen.getByLabelText('Template'), { target: { value: '15' } });
    expect((screen.getByRole('button', { name: 'Create' }) as HTMLButtonElement).disabled).toBe(false);
    fireEvent.change(screen.getByLabelText('No of Items'), { target: { value: '3' } });
    expect(screen.queryByRole('option', { name: 'Contemporary wall art' })).toBeNull();
    expect(screen.getByRole('option', { name: 'Contemporary set of 3' })).toBeTruthy();
  });

  it('shows template refresh failures and allows retry before creating a listing', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce({ ok: false, json: async () => ({ error: 'Unable to load templates. Try again.' }) })
      .mockResolvedValueOnce({ ok: true, json: async () => ({ data: { ...data, templates: [
        { id: 16, name: 'Contemporary set of 3', templateType: 'multiple', itemCount: 3 },
      ] } }) });
    vi.stubGlobal('fetch', fetchMock);
    render(<SubSectionListingsTable data={data} shopId="66615491" sectionId="3" subSectionId="8" />);
    fireEvent.click(screen.getByRole('button', { name: 'Add listing' }));
    expect((await screen.findByRole('alert')).textContent).toBe('Unable to load templates. Try again.');
    expect((screen.getByRole('button', { name: 'Create' }) as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(screen.getByRole('button', { name: 'Retry loading templates' }));
    expect(await screen.findByRole('option', { name: 'Contemporary set of 3' })).toBeTruthy();
    expect(screen.queryByRole('alert')).toBeNull();
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('edits a listing with its current settings and saves the selected template', async () => {
    const editData: SubSectionListingsPageData = {
      ...data,
      templates: [
        { id: 10, name: 'Current template', itemCount: 3, templateType: 'multiple' },
        { id: 11, name: 'Single template', itemCount: 1, templateType: 'single' },
      ],
      listings: [{ ...data.listings[0], numberOfItems: 3, ourCategoryId: 10 }],
    };
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ data: editData }) });
    vi.stubGlobal('fetch', fetchMock);
    render(<SubSectionListingsTable data={editData} shopId="66615491" sectionId="3" subSectionId="8" />);
    fireEvent.click(screen.getByRole('button', { name: 'Edit listing' }));
    await waitFor(() => expect((screen.getByLabelText('Template') as HTMLSelectElement).disabled).toBe(false));
    expect((screen.getByLabelText('Listing name') as HTMLInputElement).value).toBe('Sea Creatures Set');
    expect((screen.getByLabelText('Template') as HTMLSelectElement).value).toBe('10');
    fireEvent.change(screen.getByLabelText('Listing name'), { target: { value: 'New name' } });
    fireEvent.change(screen.getByLabelText('No of Items'), { target: { value: '1' } });
    expect(screen.queryByRole('option', { name: 'Current template' })).toBeNull();
    fireEvent.change(screen.getByLabelText('Template'), { target: { value: '11' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(fetchMock).toHaveBeenCalledWith('/api/shops/listings', expect.objectContaining({
      method: 'PATCH',
      body: JSON.stringify({ shopId: '66615491', listingId: '500', sectionId: '3', subSectionId: '8', listingName: 'New name', numberOfItems: 1, includeAllItems: false, ourCategoryId: 11 }),
    })));
    await waitFor(() => expect(screen.queryByRole('heading', { name: 'Edit Listing' })).toBeNull());
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('shows the template category and its product type', () => {
    render(
      <SubSectionListingsTable
        data={data}
        shopId="66615491"
        sectionId="3"
        subSectionId="8"
      />,
    );

    expect(screen.getByText('Category')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Kids & Nursery Prints' }));
    expect(screen.getByLabelText('Print / Frames enabled')).toBeTruthy();
    expect(screen.getByLabelText('Customised Prints enabled')).toBeTruthy();
    expect(screen.getByLabelText('Digital Download enabled')).toBeTruthy();
  });

  it('confirms the section name before generating', () => {
    render(
      <SubSectionListingsTable
        data={data}
        shopId="66615491"
        sectionId="3"
        subSectionId="8"
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: 'Generate' }));
    expect(screen.getByText(/regenerate only changed items or every item/i).textContent).toContain('Sets of 3');
    expect(screen.getByRole('button', { name: 'Only Changed' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'All' })).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(screen.queryByRole('heading', { name: 'Generate listings?' })).toBeNull();
  });

  it('generates every listing sequentially and refreshes the table', async () => {
    const secondListing = {
      ...data.listings[0],
      id: '501',
      listingName: 'Second Set',
    };
    const sectionData = { ...data, listings: [data.listings[0], secondListing] };
    const fetchMock = vi.fn()
      .mockResolvedValueOnce({ ok: true, json: async () => ({ generation: { regenerated: true } }) })
      .mockResolvedValueOnce({ ok: true, json: async () => ({ generation: { regenerated: true } }) })
      .mockResolvedValueOnce({ ok: true, json: async () => ({ data: sectionData }) });
    vi.stubGlobal('fetch', fetchMock);

    render(
      <SubSectionListingsTable
        data={sectionData}
        shopId="66615491"
        sectionId="3"
        subSectionId="8"
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: 'Generate' }));
    fireEvent.click(screen.getByRole('button', { name: 'All' }));

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(3));
    const firstRequest = JSON.parse(String(fetchMock.mock.calls[0][1]?.body));
    const secondRequest = JSON.parse(String(fetchMock.mock.calls[1][1]?.body));
    expect(firstRequest).toMatchObject({ listingId: '500', action: 'all' });
    expect(secondRequest).toMatchObject({ listingId: '501', action: 'all' });
    expect(String(fetchMock.mock.calls[2][0])).toContain('/api/shops/listings?');
    expect(await screen.findByText('2 listings generated successfully.')).toBeTruthy();
  });

  it('asks the server to regenerate only changed listings and reports skipped items', async () => {
    const secondListing = {
      ...data.listings[0],
      id: '501',
      listingName: 'Second Set',
    };
    const sectionData = { ...data, listings: [data.listings[0], secondListing] };
    const fetchMock = vi.fn()
      .mockResolvedValueOnce({ ok: true, json: async () => ({ generation: { regenerated: false } }) })
      .mockResolvedValueOnce({ ok: true, json: async () => ({ generation: { regenerated: true } }) })
      .mockResolvedValueOnce({ ok: true, json: async () => ({ data: sectionData }) });
    vi.stubGlobal('fetch', fetchMock);

    render(
      <SubSectionListingsTable
        data={sectionData}
        shopId="66615491"
        sectionId="3"
        subSectionId="8"
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: 'Generate' }));
    fireEvent.click(screen.getByRole('button', { name: 'Only Changed' }));

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(3));
    const firstRequest = JSON.parse(String(fetchMock.mock.calls[0][1]?.body));
    const secondRequest = JSON.parse(String(fetchMock.mock.calls[1][1]?.body));
    expect(firstRequest).toMatchObject({ listingId: '500', action: 'changed' });
    expect(secondRequest).toMatchObject({ listingId: '501', action: 'changed' });
    expect(await screen.findByText('1 listing was regenerated; 1 listing was already up to date.')).toBeTruthy();
  });
});
