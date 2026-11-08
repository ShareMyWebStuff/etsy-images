import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { SyncToEtsyClient } from '@/app/sync-to-etsy/SyncToEtsyClient';
import type { SyncToEtsyData, SyncToEtsyListing } from '@/lib/sync-to-etsy';

const listing: SyncToEtsyListing = {
  id: '503',
  listingName: 'Set of 3 Test',
  subjectName: 'Dinosaurs',
  localDirectoryName: 'Set of 3 Test',
  subSectionId: '1',
  subSectionName: 'Single Listings',
  hasEtsyListing: false,
  hasActiveEtsyListing: false,
  isComplete: true,
  isSynced: false,
  isPublished: false,
  isInactive: false,
  canSync: true,
  pendingChanges: ['New print listing'],
  syncDisabledReason: null,
  etsyProductType: 'physical',
  etsyListingMode: 'physical',
  etsyCategory: 'Kids & Nursery Prints',
  categoryUses: ['Print / Frames'],
  syncVariants: ['print'],
  listOnEtsy: true,
};

const data: SyncToEtsyData = {
  localSections: [{
    id: 'local:1',
    shopId: '66615491',
    sectionName: 'Dinosaur Wall Art',
    showSubject: false,
    etsySections: [{
      categoryId: '2',
      sectionName: 'Kids & Nursery Prints',
      etsyShopSectionId: 123,
      hasEtsySection: true,
    }],
    listings: [listing],
  }],
  sections: [{
    id: '66615491:2',
    categoryId: '2',
    shopId: '66615491',
    sectionName: 'Kids & Nursery Prints',
    etsyShopSectionId: 123,
    hasEtsySection: true,
    showSubject: false,
    listings: [listing],
  }],
};

describe('SyncToEtsyClient views', () => {
  afterEach(() => vi.unstubAllGlobals());

  const shops = [
    { id: '66615491', name: 'First Shop' },
    { id: '777', name: 'Second Shop' },
    { id: '888', name: 'Empty Shop' },
  ];
  const secondListing: SyncToEtsyListing = {
    ...listing, id: '504', listingName: 'Butterfly', localDirectoryName: 'Butterfly', hasEtsyListing: true,
    etsyCategory: 'Butterfly Prints',
  };
  const multiShopData: SyncToEtsyData = {
    localSections: [...data.localSections, {
      ...data.localSections[0], id: 'local:2', shopId: '777', sectionName: 'Bugs Wall Art',
      listings: [secondListing, { ...secondListing, etsyCategory: 'Digital Downloads', syncVariants: ['download'] }],
    }],
    sections: [...data.sections, {
      ...data.sections[0], id: '777:3', shopId: '777', sectionName: 'Butterfly Prints', listings: [secondListing],
    }],
  };

  it.each(['sync', 'publish'] as const)('filters %s sections by shop in both local and Etsy views', (mode) => {
    render(<SyncToEtsyClient initialData={multiShopData} mode={mode} shops={shops} />);
    expect((screen.getByRole('combobox', { name: 'Shop' }) as HTMLSelectElement).value).toBe('66615491');
    expect(screen.getByRole('tab', { name: 'Local View' }).getAttribute('aria-selected')).toBe('true');
    expect(screen.getByText('Dinosaur Wall Art')).toBeTruthy();
    expect(screen.queryByText('Bugs Wall Art')).toBeNull();

    fireEvent.change(screen.getByRole('combobox', { name: 'Shop' }), { target: { value: '777' } });
    expect(screen.getByText('Bugs Wall Art')).toBeTruthy();
    expect(screen.queryByText('Dinosaur Wall Art')).toBeNull();
    fireEvent.click(screen.getByRole('tab', { name: 'Etsy View' }));
    expect(screen.getByText('Butterfly Prints')).toBeTruthy();
    expect(screen.queryByText('Kids & Nursery Prints')).toBeNull();
    expect(screen.queryByText('Bugs Wall Art')).toBeNull();

    fireEvent.change(screen.getByRole('combobox', { name: 'Shop' }), { target: { value: '66615491' } });
    expect(screen.getByText('Kids & Nursery Prints')).toBeTruthy();
    expect(screen.queryByText('Butterfly Prints')).toBeNull();
  });

  it.each(['sync', 'publish'] as const)('offers registered shops with no listings and shows an empty state in %s', (mode) => {
    render(<SyncToEtsyClient initialData={multiShopData} mode={mode} shops={shops} />);
    expect(screen.getByRole('option', { name: 'Empty Shop' })).toBeTruthy();
    fireEvent.change(screen.getByRole('combobox', { name: 'Shop' }), { target: { value: '888' } });
    expect(screen.getByText('No listings are available for this shop.')).toBeTruthy();
    expect(screen.queryByText('Dinosaur Wall Art')).toBeNull();
    expect(screen.queryByText('Bugs Wall Art')).toBeNull();
  });

  it('checks statuses only for the selected shop, without repeating listings across template categories', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ data: multiShopData }) });
    vi.stubGlobal('fetch', fetchMock);
    render(<SyncToEtsyClient initialData={multiShopData} mode="publish" shops={shops} />);
    fireEvent.change(screen.getByRole('combobox', { name: 'Shop' }), { target: { value: '777' } });
    fireEvent.click(screen.getByRole('button', { name: 'Check statuses' }));
    await waitFor(() => expect(fetchMock).toHaveBeenCalledWith('/api/etsy/check-statuses', expect.objectContaining({
      method: 'POST', body: JSON.stringify({ listingIds: ['504'] }),
    })));
    await waitFor(() => expect(screen.getByRole('button', { name: 'Check statuses' })).toBeTruthy());
    expect((screen.getByRole('combobox', { name: 'Shop' }) as HTMLSelectElement).value).toBe('777');
    expect(screen.queryByText('Dinosaur Wall Art')).toBeNull();
  });

  it('keeps the selected shop after syncing a listing and refreshing the data', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ data: multiShopData }) });
    vi.stubGlobal('fetch', fetchMock);
    render(<SyncToEtsyClient initialData={multiShopData} shops={shops} />);
    fireEvent.change(screen.getByRole('combobox', { name: 'Shop' }), { target: { value: '777' } });
    fireEvent.click(screen.getByRole('tab', { name: 'Etsy View' }));
    fireEvent.click(screen.getByRole('button', { name: /Butterfly Prints/ }));
    fireEvent.click(screen.getByRole('button', { name: 'Sync Print' }));
    await waitFor(() => expect(fetchMock).toHaveBeenCalledWith('/api/etsy/upload', expect.objectContaining({
      method: 'POST', body: JSON.stringify({ listingId: '504', variants: ['print'] }),
    })));
    await waitFor(() => expect(screen.getByRole('button', { name: 'Sync Print' })).toBeTruthy());
    expect((screen.getByRole('combobox', { name: 'Shop' }) as HTMLSelectElement).value).toBe('777');
    expect(screen.queryByText('Kids & Nursery Prints')).toBeNull();
  });

  it.each(['reactivate', 'inactive'] as const)('limits the %s action to the selected digital row of a shared local listing', async (action) => {
    const digital: SyncToEtsyListing = {
      ...listing, listingName: 'Aphid', hasEtsyListing: true, isInactive: action === 'reactivate',
      isPublished: action === 'inactive', etsyCategory: 'Digital Downloads', syncVariants: ['download'],
    };
    const physical: SyncToEtsyListing = {
      ...listing, listingName: 'Aphid', hasEtsyListing: true, isSynced: true,
    };
    const initialData: SyncToEtsyData = { ...data, localSections: [{ ...data.localSections[0], listings: [digital, physical] }] };
    const updatedData: SyncToEtsyData = { ...initialData, localSections: [{
      ...initialData.localSections[0], listings: [{ ...digital, isPublished: action === 'reactivate', isInactive: action === 'inactive' }, physical],
    }] };
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ data: updatedData }) });
    vi.stubGlobal('fetch', fetchMock);
    render(<SyncToEtsyClient initialData={initialData} mode="publish" shops={shops} />);
    fireEvent.click(screen.getByRole('button', { name: /Dinosaur Wall Art/ }));
    fireEvent.click(screen.getByRole('button', { name: action === 'reactivate' ? 'Re-activate' : 'Make Inactive' }));
    const dialog = screen.getByRole('dialog');
    expect(within(dialog).getByText(/Aphid \(Digital Downloads\)/)).toBeTruthy();
    fireEvent.click(within(dialog).getByRole('button', { name: action === 'reactivate' ? 'Yes' : 'Confirm' }));
    await waitFor(() => expect(fetchMock).toHaveBeenCalledWith('/api/etsy/publish', expect.objectContaining({
      method: 'POST', body: JSON.stringify({ listingId: listing.id, ...(action === 'inactive' ? { action: 'inactive' } : {}), variants: ['download'] }),
    })));
    await waitFor(() => expect(screen.getByRole('button', { name: 'Publish' })).toBeTruthy());
    const physicalRow = screen.getByRole('cell', { name: 'Kids & Nursery Prints' }).closest('tr')!;
    expect(within(physicalRow).getByText('Synced')).toBeTruthy();
    expect(within(physicalRow).getByRole('button', { name: 'Publish' })).toBeTruthy();
  });

  it('defaults to Local View and shows each listing’s template Etsy section', () => {
    render(<SyncToEtsyClient initialData={data} shops={shops} />);

    expect(screen.getByRole('tab', { name: 'Local View' }).getAttribute('aria-selected')).toBe('true');
    expect(screen.getByText('Dinosaur Wall Art')).toBeTruthy();
    expect(screen.queryByText('Etsy sections used by templates')).toBeNull();

    fireEvent.click(screen.getByRole('button', { name: /Dinosaur Wall Art/ }));

    expect(screen.getByText('Etsy sections used by templates')).toBeTruthy();
    expect(screen.getByRole('columnheader', { name: 'Etsy Section' })).toBeTruthy();
    expect(screen.getAllByText('Kids & Nursery Prints').length).toBeGreaterThan(0);
    expect(screen.getByRole('button', { name: 'Sync Print' })).toBeTruthy();
  });

  it('preserves the existing category-grouped screen as Etsy View', () => {
    render(<SyncToEtsyClient initialData={data} shops={shops} />);

    fireEvent.click(screen.getByRole('tab', { name: 'Etsy View' }));

    expect(screen.getByRole('tab', { name: 'Etsy View' }).getAttribute('aria-selected')).toBe('true');
    expect(screen.getByText('Kids & Nursery Prints')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Sync Category' })).toBeTruthy();
  });

  it('identifies the failed listing and category in Sync All and shows the current pause', async () => {
    let respond!: (response: { ok: boolean; json: () => Promise<{ error: string }> }) => void;
    const fetchMock = vi.fn().mockImplementation(() => new Promise((resolve) => { respond = resolve; }));
    vi.stubGlobal('fetch', fetchMock);
    render(<SyncToEtsyClient initialData={data} shops={shops} />);
    fireEvent.click(screen.getByRole('button', { name: 'Sync All' }));
    expect(screen.getByText('There is a 10-second pause between each listing.')).toBeTruthy();
    respond({ ok: false, json: async () => ({ error: 'All quantities are zero' }) });
    await waitFor(() => expect(within(screen.getByRole('dialog')).getByText(`${listing.listingName} (${listing.etsyCategory}): All quantities are zero`)).toBeTruthy());
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(screen.getAllByRole('button', { name: 'Close' }).length).toBeGreaterThan(0);
  });

  it.each(['local', 'etsy'])('allows a published listing with template changes to resync in %s view', async (view) => {
    const updatedListing = {
      ...listing, hasEtsyListing: true, isPublished: true, hasActiveEtsyListing: true,
      canSync: true, pendingChanges: ['Template'],
    };
    const updatedData = {
      ...data,
      localSections: [{ ...data.localSections[0], listings: [updatedListing] }],
      sections: [{ ...data.sections[0], listings: [updatedListing] }],
    };
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ data: updatedData }) });
    vi.stubGlobal('fetch', fetchMock);
    render(<SyncToEtsyClient initialData={updatedData} shops={shops} />);
    if (view === 'etsy') fireEvent.click(screen.getByRole('tab', { name: 'Etsy View' }));
    fireEvent.click(screen.getByRole('button', { name: view === 'local' ? /Dinosaur Wall Art/ : /Kids & Nursery Prints/ }));
    const button = screen.getByRole('button', { name: 'Sync Print' });
    expect(button.hasAttribute('disabled')).toBe(false);
    fireEvent.click(button);
    await waitFor(() => expect(fetchMock).toHaveBeenCalledWith('/api/etsy/upload', expect.objectContaining({
      body: JSON.stringify({ listingId: listing.id, variants: ['print'] }),
    })));
    await waitFor(() => expect(button.hasAttribute('disabled')).toBe(false));
  });

  it('orders listings by listing name and then Etsy section', () => {
    const unorderedData: SyncToEtsyData = {
      ...data,
      localSections: [{
        ...data.localSections[0],
        etsySections: [
          ...data.localSections[0].etsySections,
          {
            categoryId: '3',
            sectionName: 'Digital Downloads',
            etsyShopSectionId: 456,
            hasEtsySection: true,
          },
        ],
        listings: [
          { ...listing, id: '2', listingName: 'Zebra Print', etsyCategory: 'Digital Downloads', syncVariants: ['download'] },
          { ...listing, id: '1', listingName: 'Alpha Print', etsyCategory: 'Kids & Nursery Prints' },
          { ...listing, id: '1', listingName: 'Alpha Print', etsyCategory: 'Digital Downloads', syncVariants: ['download'] },
        ],
      }],
    };

    render(<SyncToEtsyClient initialData={unorderedData} shops={shops} />);
    fireEvent.click(screen.getByRole('button', { name: /Dinosaur Wall Art/ }));

    const rows = screen.getAllByRole('row').slice(1);
    expect(rows).toHaveLength(3);
    expect(within(rows[0]).getByText('Alpha Print')).toBeTruthy();
    expect(within(rows[0]).getByText('Digital Downloads')).toBeTruthy();
    expect(within(rows[1]).getByText('Alpha Print')).toBeTruthy();
    expect(within(rows[1]).getByText('Kids & Nursery Prints')).toBeTruthy();
    expect(within(rows[2]).getByText('Zebra Print')).toBeTruthy();
  });
});
