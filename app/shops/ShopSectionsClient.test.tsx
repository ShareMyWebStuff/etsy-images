import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ShopSectionsPageData } from '@/lib/etsy-sync';
import { ShopSectionsClient } from './ShopSectionsClient';

const shopId = '66615491';
const data: ShopSectionsPageData = {
  shop: { id: shopId, shopName: 'Artwork Shop' },
  sections: [
    { id: '18', subSectionId: '30', sectionName: 'Japanese Artwork', noOfListings: 8,
      noToGenerate: 3, awaitingEtsySync: 2, etsyLive: 4,
      noOfActive: 77, noOfDraft: 66, hasEtsyShopSection: true },
    { id: '19', subSectionId: '31', sectionName: 'Ready Artwork', noOfListings: 5,
      noToGenerate: 0, awaitingEtsySync: 0, etsyLive: 5,
      noOfActive: 99, noOfDraft: 88, hasEtsyShopSection: false },
    { id: '20', subSectionId: null, sectionName: 'Empty Section', noOfListings: 0,
      noToGenerate: 0, awaitingEtsySync: 0, etsyLive: 0,
      noOfActive: 0, noOfDraft: 0, hasEtsyShopSection: false },
  ],
};

function row(name: string) {
  return screen.getByRole('cell', { name }).closest('tr')!;
}

afterEach(() => vi.unstubAllGlobals());

describe('ShopSectionsClient', () => {
  it('shows the new workflow counts with centred numbers and highlights only generation or live shortfalls', () => {
    render(<ShopSectionsClient initialData={data} shopId={shopId} />);
    const headings = screen.getAllByRole('columnheader');
    expect(headings.map((heading) => heading.textContent?.trim())).toEqual([
      'Section Name', 'No of Listings', 'No to Generate', 'Awaiting Etsy Sync', 'Etsy Live', 'Actions',
    ]);
    for (const heading of headings.slice(1, 5)) expect(heading.classList.contains('text-center')).toBe(true);
    for (const name of ['No of Active', 'No of Draft', 'Uploaded to Etsy', 'Section Names']) {
      expect(screen.queryByRole('columnheader', { name })).toBeNull();
    }
    const expectedRows = [
      { name: 'Japanese Artwork', counts: ['8', '3', '2', '4'], needsGeneration: true, belowLiveTotal: true },
      { name: 'Ready Artwork', counts: ['5', '0', '0', '5'], needsGeneration: false, belowLiveTotal: false },
      { name: 'Empty Section', counts: ['0', '0', '0', '0'], needsGeneration: false, belowLiveTotal: false },
    ];
    for (const expected of expectedRows) {
      const cells = within(row(expected.name)).getAllByRole('cell');
      expect(cells).toHaveLength(6);
      expect(cells.slice(1, 5).map((cell) => cell.textContent?.trim())).toEqual(expected.counts);
      for (const cell of cells.slice(1, 5)) expect(cell.classList.contains('text-center')).toBe(true);
      expect(cells[2].classList.contains('text-destructive')).toBe(expected.needsGeneration);
      expect(cells[4].classList.contains('text-destructive')).toBe(expected.belowLiveTotal);
      expect(cells[1].classList.contains('text-destructive')).toBe(false);
      expect(cells[3].classList.contains('text-destructive')).toBe(false);
    }
  });

  it('preserves scoped listing links and only lets empty sections be deleted', async () => {
    const updated = { ...data, sections: data.sections.filter((section) => section.id !== '20') };
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ data: updated }) });
    vi.stubGlobal('fetch', fetchMock);
    render(<ShopSectionsClient initialData={data} shopId={shopId} />);
    for (const section of data.sections) {
      const target = row(section.sectionName);
      expect(within(target).getByRole('link', { name: 'View Listings' }).getAttribute('href'))
        .toBe(`/listings?shopId=${shopId}&sectionId=${section.id}`);
      expect(within(target).queryByRole('button', { name: 'Delete Section' }) !== null).toBe(section.noOfListings === 0);
    }
    expect(fetchMock).not.toHaveBeenCalled();
    fireEvent.click(within(row('Empty Section')).getByRole('button', { name: 'Delete Section' }));
    await waitFor(() => expect(screen.queryByRole('cell', { name: 'Empty Section' })).toBeNull());
    expect(fetchMock).toHaveBeenCalledExactlyOnceWith('/api/shops/sections', expect.objectContaining({
      method: 'DELETE', body: JSON.stringify({ shopId, sectionId: '20' }),
    }));
    expect(screen.getAllByRole('row')).toHaveLength(3);
    expect(within(row('Japanese Artwork')).getAllByRole('cell')[2].textContent?.trim()).toBe('3');
  });

  it('refreshes counts from server props and replaces old rows and links when the shop changes', () => {
    const fetchMock = vi.fn(); vi.stubGlobal('fetch', fetchMock);
    const { rerender } = render(<ShopSectionsClient initialData={data} shopId={shopId} />);
    const fresh: ShopSectionsPageData = { ...data, sections: data.sections.map((section) => section.id === '18'
      ? { ...section, noToGenerate: 0, awaitingEtsySync: 0, etsyLive: 8 } : section) };
    rerender(<ShopSectionsClient initialData={fresh} shopId={shopId} />);
    const refreshedCells = within(row('Japanese Artwork')).getAllByRole('cell');
    expect(refreshedCells.slice(1, 5).map((cell) => cell.textContent?.trim())).toEqual(['8', '0', '0', '8']);
    expect(refreshedCells[2].classList.contains('text-destructive')).toBe(false);
    expect(refreshedCells[4].classList.contains('text-destructive')).toBe(false);

    const otherShop: ShopSectionsPageData = {
      shop: { id: '777', shopName: 'Botanical Shop' },
      sections: [{ ...data.sections[0], id: '27', sectionName: 'Botanical Artwork',
        noOfListings: 6, noToGenerate: 1, awaitingEtsySync: 3, etsyLive: 2 }],
    };
    rerender(<ShopSectionsClient initialData={otherShop} shopId="777" />);
    expect(screen.getByRole('heading', { name: 'Botanical Shop Sections' })).toBeTruthy();
    for (const section of data.sections) expect(screen.queryByRole('cell', { name: section.sectionName })).toBeNull();
    const current = row('Botanical Artwork');
    expect(within(current).getAllByRole('cell').slice(1, 5).map((cell) => cell.textContent?.trim())).toEqual(['6', '1', '3', '2']);
    expect(within(current).getByRole('link', { name: 'View Listings' }).getAttribute('href')).toBe('/listings?shopId=777&sectionId=27');
    expect(screen.getAllByRole('row')).toHaveLength(2);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it.each([
    { label: 'an empty shop', initialData: { ...data, sections: [] } },
    { label: 'missing shop data', initialData: null },
  ])('keeps the empty-state row across all six columns for $label', ({ initialData }) => {
    render(<ShopSectionsClient initialData={initialData} shopId={shopId} />);
    const empty = screen.getByRole('cell', { name: 'No sections found.' }) as HTMLTableCellElement;
    expect(empty.colSpan).toBe(6);
    expect(screen.getAllByRole('columnheader')).toHaveLength(6);
    expect(screen.getAllByRole('row')).toHaveLength(2);
    expect(screen.queryByRole('button', { name: 'Delete Section' })).toBeNull();
  });
});
