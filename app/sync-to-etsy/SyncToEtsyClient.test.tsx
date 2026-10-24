import { fireEvent, render, screen, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

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
  it('defaults to Local View and shows each listing’s template Etsy section', () => {
    render(<SyncToEtsyClient initialData={data} />);

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
    render(<SyncToEtsyClient initialData={data} />);

    fireEvent.click(screen.getByRole('tab', { name: 'Etsy View' }));

    expect(screen.getByRole('tab', { name: 'Etsy View' }).getAttribute('aria-selected')).toBe('true');
    expect(screen.getByText('Kids & Nursery Prints')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Sync Category' })).toBeTruthy();
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

    render(<SyncToEtsyClient initialData={unorderedData} />);
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
