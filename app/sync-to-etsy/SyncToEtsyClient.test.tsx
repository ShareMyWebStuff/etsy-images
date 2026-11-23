import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { SyncToEtsyClient } from '@/app/sync-to-etsy/SyncToEtsyClient';
import type { SyncToEtsyData, SyncToEtsyListing } from '@/lib/sync-to-etsy';

const refresh = vi.hoisted(() => vi.fn());
vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh }) }));

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
  afterEach(() => { vi.unstubAllGlobals(); refresh.mockClear(); });

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

  it('updates section sync availability when refreshed server data arrives', () => {
    const pendingData: SyncToEtsyData = {
      ...data,
      localSections: [{ ...data.localSections[0], listings: [{ ...listing, canSync: false, isComplete: false }] }],
    };
    const view = render(<SyncToEtsyClient initialData={pendingData} shops={shops} />);
    expect((screen.getByRole('button', { name: 'Sync All' }) as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(screen.getByRole('button', { name: /Dinosaur Wall Art/ }));
    view.rerender(<SyncToEtsyClient initialData={data} shops={shops} />);
    expect((screen.getByRole('button', { name: 'Sync All' }) as HTMLButtonElement).disabled).toBe(false);
    expect((screen.getByRole('button', { name: 'Sync Print' }) as HTMLButtonElement).disabled).toBe(false);
    expect(screen.getByRole('button', { name: /Dinosaur Wall Art/ }).getAttribute('aria-expanded')).toBe('true');
  });

  it('refreshes readiness without sending an Etsy mutation or resetting the selected shop', () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    const view = render(<SyncToEtsyClient initialData={multiShopData} shops={shops} />);
    fireEvent.change(screen.getByRole('combobox', { name: 'Shop' }), { target: { value: '777' } });
    fireEvent.click(screen.getByRole('button', { name: 'Refresh listings' }));
    expect(refresh).toHaveBeenCalledTimes(1);
    expect(fetchMock).not.toHaveBeenCalled();
    view.rerender(<SyncToEtsyClient initialData={{ ...multiShopData }} shops={shops} />);
    expect((screen.getByRole('combobox', { name: 'Shop' }) as HTMLSelectElement).value).toBe('777');
    expect(screen.getByText('Bugs Wall Art')).toBeTruthy();
  });

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

  it.each(['local', 'etsy'])('shows free personalisation updates on a published listing in %s view', (view) => {
    const physical: SyncToEtsyListing = {
      ...listing, hasEtsyListing: true, isPublished: true, hasActiveEtsyListing: true,
      pendingChanges: ['Personalisation'],
    };
    const digital: SyncToEtsyListing = {
      ...physical, etsyCategory: 'Digital Downloads', etsyProductType: 'digital',
      etsyListingMode: 'download', syncVariants: ['download'], canSync: false, pendingChanges: [],
    };
    const updatedData: SyncToEtsyData = {
      localSections: [{ ...data.localSections[0], listings: [physical, digital] }],
      sections: [{ ...data.sections[0], listings: [physical] }],
    };
    render(<SyncToEtsyClient initialData={updatedData} shops={shops} />);
    if (view === 'etsy') fireEvent.click(screen.getByRole('tab', { name: 'Etsy View' }));
    fireEvent.click(screen.getByRole('button', { name: view === 'local' ? /Dinosaur Wall Art/ : /Kids & Nursery Prints/ }));
    const physicalRow = screen.getByRole('button', { name: 'Sync Print' }).closest('tr')!;
    expect(within(physicalRow).getByText('Published')).toBeTruthy();
    expect(within(physicalRow).getByText('Needs sync: Personalisation')).toBeTruthy();
    expect(within(physicalRow).getByRole('button', { name: 'Sync Print' }).hasAttribute('disabled')).toBe(false);
    expect(screen.getAllByText('Needs sync: Personalisation')).toHaveLength(1);
    expect(screen.queryByRole('button', { name: 'Sync Digital' })).toBeNull();
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

describe('publishing a section', () => {
  afterEach(() => { vi.unstubAllGlobals(); refresh.mockClear(); });
  const shops = [{ id: '66615491', name: 'First Shop' }, { id: '777', name: 'Second Shop' }];
  function draft(id: string, overrides: Partial<SyncToEtsyListing> = {}): SyncToEtsyListing {
    return { ...listing, id, listingName: `Artwork ${id}`, localDirectoryName: `Artwork ${id}`, hasEtsyListing: true,
      isSynced: true, canSync: false, pendingChanges: [], ...overrides };
  }
  const rows: SyncToEtsyListing[] = [
    draft('600'), draft('600', { syncVariants: ['download'], etsyCategory: 'Digital Downloads' }), draft('600'),
    draft('601'),
    draft('602', { isInactive: true, syncVariants: ['customised'] }),
    draft('603', { isPublished: true, hasActiveEtsyListing: true }),
    draft('603', { isPublished: true, hasActiveEtsyListing: true, syncVariants: ['download'], etsyCategory: 'Digital Downloads' }),
    draft('604', { isSynced: false }),
    draft('605', { listOnEtsy: false }),
    draft('606', { hasEtsyListing: false, isSynced: false }),
    draft('607', { pendingChanges: ['Images'] }),
    draft('608', { isComplete: false }),
    draft('609', { isPublished: true, hasActiveEtsyListing: true }),
    draft('609', { isSynced: false, syncVariants: ['download'], etsyCategory: 'Digital Downloads' }),
    draft('610', { isPublished: true, hasActiveEtsyListing: true }),
    draft('610', { syncVariants: ['download'], etsyCategory: 'Digital Downloads' }),
  ];
  const physicalRows = rows.filter((row) => !row.syncVariants.includes('download'))
    .filter((row, index, values) => values.findIndex((candidate) => candidate.id === row.id) === index);
  const sectionData: SyncToEtsyData = {
    localSections: [
      { ...data.localSections[0], listings: rows },
      { ...data.localSections[0], id: 'local:other', sectionName: 'Unrelated Local Section', listings: [draft('611')] },
      { ...data.localSections[0], id: 'local:second-shop', shopId: '777', sectionName: 'Second Shop Local Section', listings: [draft('612')] },
    ],
    sections: [
      { ...data.sections[0], listings: physicalRows },
      { ...data.sections[0], id: 'first:downloads', categoryId: '3', sectionName: 'Digital Downloads', listings: rows.filter((row) => row.syncVariants.includes('download')) },
      { ...data.sections[0], id: 'first:other', categoryId: '4', sectionName: 'Unrelated Prints', listings: [draft('611')] },
      { ...data.sections[0], id: 'second:prints', shopId: '777', sectionName: 'Second Shop Prints', listings: [draft('612')] },
    ],
  };
  function section(name: string) { return screen.getByRole('region', { name: `${name} section` }); }
  function chooseQuantity(dialog: HTMLElement, value: string | number) {
    fireEvent.change(within(dialog).getByRole('spinbutton', { name: 'Number of listings to publish' }), { target: { value: String(value) } });
  }
  function countValues(region: HTMLElement) {
    const counts = within(region).getByLabelText('Section publication counts');
    return ['Published:', 'Synced:', 'Not Synced:'].map((label) => Number(within(counts).getByText(label).nextElementSibling?.textContent));
  }
  function json(payload: unknown, ok = true) { return { ok, json: async () => payload }; }
  function deferred() {
    let resolve!: (response: ReturnType<typeof json>) => void;
    const promise = new Promise<ReturnType<typeof json>>((next) => { resolve = next; });
    return { promise, resolve };
  }
  function afterPublishing(ids: string[]): SyncToEtsyData {
    const update = (row: SyncToEtsyListing) => ids.includes(row.id) ? { ...row, isPublished: true, hasActiveEtsyListing: true, isInactive: false } : row;
    return { localSections: sectionData.localSections.map((entry) => ({ ...entry, listings: entry.listings.map(update) })),
      sections: sectionData.sections.map((entry) => ({ ...entry, listings: entry.listings.map(update) })) };
  }

  it.each([
    { view: 'Local View', name: 'Dinosaur Wall Art', expected: [1, 7, 3] },
    { view: 'Etsy View', name: 'Kids & Nursery Prints', expected: [3, 6, 2] },
  ])('shows disjoint unique-listing counts in $view without counting template variants twice', ({ view, name, expected }) => {
    render(<SyncToEtsyClient initialData={sectionData} mode="publish" shops={shops} />);
    if (view === 'Etsy View') fireEvent.click(screen.getByRole('tab', { name: view }));
    const target = section(name);
    expect(countValues(target)).toEqual(expected);
    expect(countValues(target).reduce((sum, value) => sum + value, 0)).toBe(11);
    expect((within(target).getByRole('button', { name: 'Publish section' }) as HTMLButtonElement).disabled).toBe(false);
    expect(screen.queryByRole('region', { name: 'Second Shop Local Section section' })).toBeNull();
    expect(screen.queryByRole('region', { name: 'Second Shop Prints section' })).toBeNull();
  });

  it('disables section Publish when every row is ineligible and does not add it to the sync screen', () => {
    const ineligible: SyncToEtsyData = { ...data, localSections: [{ ...data.localSections[0], listings: rows.filter((row) => !['600', '601', '610'].includes(row.id)) }] };
    const { rerender } = render(<SyncToEtsyClient initialData={ineligible} mode="publish" shops={shops} />);
    const publish = within(section('Dinosaur Wall Art')).getByRole('button', { name: 'Publish section' }) as HTMLButtonElement;
    expect(publish.disabled).toBe(true);
    fireEvent.click(publish); expect(screen.queryByRole('dialog')).toBeNull();
    rerender(<SyncToEtsyClient initialData={ineligible} mode="sync" shops={shops} />);
    expect(screen.queryByRole('button', { name: 'Publish section' })).toBeNull();
  });

  it('defaults to one listing and resets the quantity after cancelling without publishing', () => {
    const fetchMock = vi.fn(); vi.stubGlobal('fetch', fetchMock);
    render(<SyncToEtsyClient initialData={sectionData} mode="publish" shops={shops} />);
    fireEvent.click(within(section('Dinosaur Wall Art')).getByRole('button', { name: 'Publish section' }));
    const dialog = screen.getByRole('dialog', { name: 'Publish section?' });
    expect(dialog.textContent).toContain('Dinosaur Wall Art');
    const quantity = within(dialog).getByRole('spinbutton', { name: 'Number of listings to publish' }) as HTMLInputElement;
    expect([quantity.value, quantity.min, quantity.max, quantity.step]).toEqual(['1', '1', '3', '1']);
    expect(within(dialog).getByRole('button', { name: 'Publish 1 listing' })).toBeTruthy();
    expect(within(dialog).getAllByRole('listitem').map((item) => item.textContent)).toEqual(['Artwork 600 (Print, Digital)']);
    chooseQuantity(dialog, 2);
    expect(within(dialog).getAllByRole('listitem').map((item) => item.textContent)).toEqual(['Artwork 600 (Print, Digital)', 'Artwork 601 (Print)']);
    expect(fetchMock).not.toHaveBeenCalled();
    fireEvent.click(within(dialog).getByRole('button', { name: 'Cancel' }));
    expect(screen.queryByRole('dialog')).toBeNull(); expect(fetchMock).not.toHaveBeenCalled();
    fireEvent.click(within(section('Dinosaur Wall Art')).getByRole('button', { name: 'Publish section' }));
    const reopened = screen.getByRole('dialog', { name: 'Publish section?' });
    expect((within(reopened).getByRole('spinbutton', { name: 'Number of listings to publish' }) as HTMLInputElement).value).toBe('1');
    expect(within(reopened).getAllByRole('listitem')).toHaveLength(1);
    expect(within(reopened).getByRole('button', { name: 'Publish 1 listing' })).toBeTruthy();
    fireEvent.click(within(reopened).getByRole('button', { name: 'Cancel' }));
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it.each(['', '0', '-1', '1.5', '4'])('rejects invalid publication quantity "%s" without sending a request', (value) => {
    const fetchMock = vi.fn(); vi.stubGlobal('fetch', fetchMock);
    render(<SyncToEtsyClient initialData={sectionData} mode="publish" shops={shops} />);
    fireEvent.click(within(section('Dinosaur Wall Art')).getByRole('button', { name: 'Publish section' }));
    const dialog = screen.getByRole('dialog', { name: 'Publish section?' });
    chooseQuantity(dialog, value);
    const confirm = within(dialog).getByRole('button', { name: 'Publish listings' }) as HTMLButtonElement;
    expect(confirm.disabled).toBe(true);
    expect(within(dialog).getByRole('alert').textContent).toContain('Enter a whole number from 1 to 3');
    expect(within(dialog).queryAllByRole('listitem')).toHaveLength(0);
    fireEvent.click(confirm);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('rechecks fresh eligibility while confirmation is open before sending publication requests', async () => {
    const fetchMock = vi.fn().mockResolvedValue(json({ data: afterPublishing(['600', '601', '610']) })); vi.stubGlobal('fetch', fetchMock);
    const { rerender } = render(<SyncToEtsyClient initialData={sectionData} mode="publish" shops={shops} />);
    fireEvent.click(within(section('Dinosaur Wall Art')).getByRole('button', { name: 'Publish section' }));
    const confirmation = screen.getByRole('dialog', { name: 'Publish section?' });
    expect(within(confirmation).getByRole('button', { name: 'Publish 1 listing' })).toBeTruthy();
    rerender(<SyncToEtsyClient initialData={afterPublishing(['600', '601'])} mode="publish" shops={shops} />);
    await waitFor(() => expect(within(confirmation).getByRole('listitem').textContent).toContain('Artwork 610'));
    const confirm = within(confirmation).getByRole('button', { name: 'Publish 1 listing' });
    expect(within(confirmation).queryByText('Artwork 600')).toBeNull();
    expect(within(confirmation).queryByText('Artwork 601')).toBeNull();
    expect(fetchMock).not.toHaveBeenCalled();
    fireEvent.click(confirm);
    await waitFor(() => expect(fetchMock).toHaveBeenCalledExactlyOnceWith('/api/etsy/publish', expect.objectContaining({
      method: 'POST', body: JSON.stringify({ listingId: '610', variants: ['download'], requireSyncedDrafts: true }),
    })));
  });

  it('keeps an out-of-range choice after eligibility shrinks and requires an explicit correction', async () => {
    const fetchMock = vi.fn().mockResolvedValue(json({ data: afterPublishing(['600', '601']) })); vi.stubGlobal('fetch', fetchMock);
    const { rerender } = render(<SyncToEtsyClient initialData={sectionData} mode="publish" shops={shops} />);
    fireEvent.click(within(section('Dinosaur Wall Art')).getByRole('button', { name: 'Publish section' }));
    const dialog = screen.getByRole('dialog', { name: 'Publish section?' });
    chooseQuantity(dialog, 3);
    expect(within(dialog).getByRole('button', { name: 'Publish 3 listings' })).toBeTruthy();
    rerender(<SyncToEtsyClient initialData={afterPublishing(['600'])} mode="publish" shops={shops} />);
    const quantity = within(dialog).getByRole('spinbutton', { name: 'Number of listings to publish' }) as HTMLInputElement;
    await waitFor(() => expect(quantity.max).toBe('2'));
    expect(quantity.value).toBe('3');
    const invalidConfirm = within(dialog).getByRole('button', { name: 'Publish listings' }) as HTMLButtonElement;
    expect(invalidConfirm.disabled).toBe(true);
    fireEvent.click(invalidConfirm);
    expect(fetchMock).not.toHaveBeenCalled();
    chooseQuantity(dialog, 1);
    expect(within(dialog).getByRole('listitem').textContent).toContain('Artwork 601');
    fireEvent.click(within(dialog).getByRole('button', { name: 'Publish 1 listing' }));
    await waitFor(() => expect(fetchMock).toHaveBeenCalledExactlyOnceWith('/api/etsy/publish', expect.objectContaining({
      method: 'POST', body: JSON.stringify({ listingId: '601', variants: ['print'], requireSyncedDrafts: true }),
    })));
  });

  it.each([
    { view: 'Local View', name: 'Dinosaur Wall Art', ids: ['600', '601', '610'], variants: [['print', 'download'], ['print'], ['download']] },
    { view: 'Etsy View', name: 'Kids & Nursery Prints', ids: ['600', '601'], variants: [['print'], ['print']] },
  ])('publishes only eligible rows in the selected $view section and merges eligible variants per ID', async ({ view, name, ids, variants }) => {
    const fetchMock = vi.fn().mockResolvedValue(json({ data: afterPublishing(ids) })); vi.stubGlobal('fetch', fetchMock);
    render(<SyncToEtsyClient initialData={sectionData} mode="publish" shops={shops} />);
    if (view === 'Etsy View') fireEvent.click(screen.getByRole('tab', { name: view }));
    fireEvent.click(within(section(name)).getByRole('button', { name: 'Publish section' }));
    const confirmation = screen.getByRole('dialog', { name: 'Publish section?' });
    chooseQuantity(confirmation, ids.length);
    expect(within(confirmation).getAllByRole('listitem')).toHaveLength(ids.length);
    fireEvent.click(within(confirmation).getByRole('button', { name: `Publish ${ids.length} listings` }));
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(ids.length));
    expect(fetchMock.mock.calls.map(([url]) => url)).toEqual(ids.map(() => '/api/etsy/publish'));
    const sent = fetchMock.mock.calls.map(([, options]) => JSON.parse(String(options?.body)));
    expect(sent.map((body) => body.listingId)).toEqual(ids);
    sent.forEach((body, index) => expect([...body.variants].sort()).toEqual([...variants[index]].sort()));
    expect(sent.every((body) => body.requireSyncedDrafts === true)).toBe(true);
    expect(sent.every((body) => body.action !== 'inactive')).toBe(true);
    expect(sent.flatMap((body) => body.variants).filter((value) => value === 'customised')).toEqual([]);
    const progress = await screen.findByRole('dialog', { name: `Publish section — ${name}` });
    await waitFor(() => expect(within(progress).getByText(`${ids.length} of ${ids.length}`)).toBeTruthy());
    fireEvent.click(within(progress).getAllByRole('button', { name: 'Close' })[0]);
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    if (view === 'Local View') expect(countValues(section(name))).toEqual([4, 4, 3]);
  });

  it('publishes only the chosen first two listings sequentially and blocks duplicate or concurrent actions', async () => {
    const first = deferred(), second = deferred();
    const fetchMock = vi.fn().mockReturnValueOnce(first.promise).mockReturnValueOnce(second.promise); vi.stubGlobal('fetch', fetchMock);
    render(<SyncToEtsyClient initialData={sectionData} mode="publish" shops={shops} />);
    const otherPublish = within(section('Unrelated Local Section')).getByRole('button', { name: 'Publish section' }) as HTMLButtonElement;
    fireEvent.click(within(section('Dinosaur Wall Art')).getByRole('button', { name: 'Publish section' }));
    const confirmation = screen.getByRole('dialog', { name: 'Publish section?' });
    chooseQuantity(confirmation, 2);
    expect(within(confirmation).getAllByRole('listitem')).toHaveLength(2);
    expect(within(confirmation).queryByText('Artwork 610')).toBeNull();
    const confirm = within(confirmation).getByRole('button', { name: 'Publish 2 listings' });
    fireEvent.click(confirm); fireEvent.click(confirm);
    const progress = screen.getByRole('dialog', { name: 'Publish section — Dinosaur Wall Art' });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(within(progress).getByText('0 of 2')).toBeTruthy();
    expect(within(progress).getByText(/Publishing Artwork 600/)).toBeTruthy();
    expect(otherPublish.disabled).toBe(true);
    fireEvent.click(otherPublish); fireEvent.keyDown(progress, { key: 'Escape' });
    expect(progress.isConnected).toBe(true); expect(fetchMock).toHaveBeenCalledTimes(1);
    await act(async () => first.resolve(json({ data: afterPublishing(['600']) })));
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
    expect(within(progress).getByText('1 of 2')).toBeTruthy();
    expect(within(progress).getByText(/Publishing Artwork 601/)).toBeTruthy();
    await act(async () => second.resolve(json({ data: afterPublishing(['600', '601']) })));
    expect(within(progress).getByText('2 of 2')).toBeTruthy();
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(fetchMock.mock.calls.map(([, options]) => JSON.parse(String(options?.body)))).toEqual([
      { listingId: '600', variants: ['print', 'download'], requireSyncedDrafts: true },
      { listingId: '601', variants: ['print'], requireSyncedDrafts: true },
    ]);
  });

  it('stops at the first publication error without publishing later listings or losing completed progress', async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce(json({ data: afterPublishing(['600']) }))
      .mockResolvedValueOnce(json({ error: 'Etsy refused the draft.' }, false)); vi.stubGlobal('fetch', fetchMock);
    render(<SyncToEtsyClient initialData={sectionData} mode="publish" shops={shops} />);
    fireEvent.click(within(section('Dinosaur Wall Art')).getByRole('button', { name: 'Publish section' }));
    const confirmation = screen.getByRole('dialog', { name: 'Publish section?' });
    chooseQuantity(confirmation, 3);
    fireEvent.click(within(confirmation).getByRole('button', { name: 'Publish 3 listings' }));
    const progress = await screen.findByRole('dialog', { name: 'Publish section — Dinosaur Wall Art' });
    await waitFor(() => expect(within(progress).getByText(/Etsy refused the draft/)).toBeTruthy());
    expect(within(progress).getByText('1 of 3')).toBeTruthy();
    expect(progress.textContent).toContain('Artwork 601');
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(fetchMock.mock.calls.map(([, options]) => JSON.parse(String(options?.body)).listingId)).toEqual(['600', '601']);
  });

  it.each(['Local View', 'Etsy View'])('limits section publishing to the newly selected shop in %s', async (view) => {
    const fetchMock = vi.fn().mockResolvedValue(json({ data: sectionData })); vi.stubGlobal('fetch', fetchMock);
    render(<SyncToEtsyClient initialData={sectionData} mode="publish" shops={shops} />);
    fireEvent.change(screen.getByRole('combobox', { name: 'Shop' }), { target: { value: '777' } });
    if (view === 'Etsy View') fireEvent.click(screen.getByRole('tab', { name: view }));
    const name = view === 'Local View' ? 'Second Shop Local Section' : 'Second Shop Prints';
    fireEvent.click(within(section(name)).getByRole('button', { name: 'Publish section' }));
    fireEvent.click(within(screen.getByRole('dialog', { name: 'Publish section?' })).getByRole('button', { name: 'Publish 1 listing' }));
    await waitFor(() => expect(fetchMock).toHaveBeenCalledExactlyOnceWith('/api/etsy/publish', expect.objectContaining({
      method: 'POST', body: JSON.stringify({ listingId: '612', variants: ['print'], requireSyncedDrafts: true }),
    })));
  });

  it('recovers a combined row by publishing only its remaining synced draft variant', async () => {
    const combined = draft('700', { listingName: 'Combined artwork', syncVariants: ['print', 'download'], etsyListingMode: 'both',
      hasActiveEtsyListing: true, isSynced: false, isPublished: false,
      publication: { allProductsSynced: true, readyVariants: ['download'] } });
    const pending: SyncToEtsyData = {
      localSections: [{ ...data.localSections[0], listings: [combined] }],
      sections: [{ ...data.sections[0], listings: [combined] }],
    };
    const published = { ...combined, isPublished: true, publication: { allProductsSynced: true, readyVariants: [] } };
    const completed: SyncToEtsyData = {
      localSections: [{ ...data.localSections[0], listings: [published] }],
      sections: [{ ...data.sections[0], listings: [published] }],
    };
    const fetchMock = vi.fn().mockResolvedValue(json({ data: completed })); vi.stubGlobal('fetch', fetchMock);
    render(<SyncToEtsyClient initialData={pending} mode="publish" shops={shops} />);
    const target = section('Dinosaur Wall Art');
    expect(countValues(target)).toEqual([0, 1, 0]);
    const publish = within(target).getByRole('button', { name: 'Publish section' }) as HTMLButtonElement;
    expect(publish.disabled).toBe(false);
    fireEvent.click(publish);
    const confirmation = screen.getByRole('dialog', { name: 'Publish section?' });
    expect(confirmation.textContent).toContain('Combined artwork');
    expect(confirmation.textContent).toContain('Digital');
    fireEvent.click(within(confirmation).getByRole('button', { name: 'Publish 1 listing' }));
    await waitFor(() => expect(fetchMock).toHaveBeenCalledExactlyOnceWith('/api/etsy/publish', expect.objectContaining({
      method: 'POST', body: JSON.stringify({ listingId: '700', variants: ['download'], requireSyncedDrafts: true }),
    })));
    const progress = await screen.findByRole('dialog', { name: 'Publish section — Dinosaur Wall Art' });
    await waitFor(() => expect(within(progress).getByText('1 of 1')).toBeTruthy());
    fireEvent.click(within(progress).getAllByRole('button', { name: 'Close' })[0]);
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(countValues(section('Dinosaur Wall Art'))).toEqual([1, 0, 0]);
    expect((within(section('Dinosaur Wall Art')).getByRole('button', { name: 'Publish section' }) as HTMLButtonElement).disabled).toBe(true);
  });
});
