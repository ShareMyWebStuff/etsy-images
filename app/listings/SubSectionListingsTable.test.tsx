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
