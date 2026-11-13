import { fireEvent, render, screen, waitFor } from '@testing-library/react';
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
