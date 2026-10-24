import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';

import { SyncToPrintShrimpClient } from '@/app/sync-to-printshrimp/SyncToPrintShrimpClient';
import type { SyncToPrintShrimpData } from '@/lib/printshrimp/sync';

const data: SyncToPrintShrimpData = {
  adapter: { configured: false, message: 'PrintShrimp API details have not been configured.' },
  localSections: [{
    id: 'local:10',
    sectionName: 'Local Sea Creatures',
    listings: [{
      id: '339',
      listingName: 'Green Sea Turtle',
      etsyPrintId: '1234',
      etsyCustomisedId: '5678',
      etsySku: 'SEA-CREATURES-GREEN-TURTLE',
      etsySectionNames: ['Kids Prints', 'Personalised Prints'],
      isComplete: true,
      hasAllSixFiles: true,
      status: 'NOT_SYNCED',
      lastSuccessfulSyncAt: null,
      sourceChanged: null,
      validationError: null,
      lastError: null,
      canSync: false,
      syncDisabledReason: 'PrintShrimp API details have not been configured.',
      ratioFiles: [
        { ratio: 'A', fileName: 'Turtle_A.jpeg', synced: false },
        { ratio: '4x5', fileName: 'Turtle_4x5.jpeg', synced: false },
        { ratio: '11x14', fileName: 'Turtle_11x14.jpeg', synced: false },
        { ratio: '3x4', fileName: 'Turtle_3x4.jpeg', synced: false },
        { ratio: '2x3', fileName: 'Turtle_2x3.jpeg', synced: false },
      ],
    }],
  }],
  sections: [{
    id: '10',
    sectionName: 'Kids Prints',
    listings: [{
      id: '339',
      listingName: 'Green Sea Turtle',
      etsyPrintId: '1234',
      etsyCustomisedId: '5678',
      etsySku: 'SEA-CREATURES-GREEN-TURTLE',
      etsySectionNames: ['Kids Prints'],
      isComplete: true,
      hasAllSixFiles: true,
      status: 'NOT_SYNCED',
      lastSuccessfulSyncAt: null,
      sourceChanged: null,
      validationError: null,
      lastError: null,
      canSync: false,
      syncDisabledReason: 'PrintShrimp API details have not been configured.',
      ratioFiles: [
        { ratio: 'A', fileName: 'Turtle_A.jpeg', synced: false },
        { ratio: '4x5', fileName: 'Turtle_4x5.jpeg', synced: false },
        { ratio: '11x14', fileName: 'Turtle_11x14.jpeg', synced: false },
        { ratio: '3x4', fileName: 'Turtle_3x4.jpeg', synced: false },
        { ratio: '2x3', fileName: 'Turtle_2x3.jpeg', synced: false },
      ],
    }],
  }],
};

describe('Sync to PrintShrimp page', () => {
  it('renders listing eligibility, identifiers, ratio files and disabled configuration state', async () => {
    const user = userEvent.setup();
    render(<SyncToPrintShrimpClient initialData={data} />);

    expect(screen.getByRole('heading', { name: 'Sync to PrintShrimp' })).toBeTruthy();
    expect(screen.getByRole('tab', { name: 'Local View' }).getAttribute('aria-selected')).toBe('true');
    expect(screen.getByRole('alert').textContent).toContain('not been configured');
    await user.click(screen.getByRole('button', { name: /Local Sea Creatures/ }));

    expect(screen.getByText('Green Sea Turtle')).toBeTruthy();
    expect(screen.getByText('Kids Prints / Personalised Prints')).toBeTruthy();
    expect(screen.getByText('Print 1234 / Customised 5678')).toBeTruthy();
    expect(screen.getByText('SEA-CREATURES-GREEN-TURTLE')).toBeTruthy();
    expect(screen.getByText(/A: Turtle_A.jpeg/)).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Sync' }).hasAttribute('disabled')).toBe(true);
  });

  it('switches to Etsy section grouping', async () => {
    const user = userEvent.setup();
    render(<SyncToPrintShrimpClient initialData={data} />);

    await user.click(screen.getByRole('tab', { name: 'Etsy View' }));

    expect(screen.getByRole('tab', { name: 'Etsy View' }).getAttribute('aria-selected')).toBe('true');
    expect(screen.getByText('Kids Prints')).toBeTruthy();
    expect(screen.queryByText('Local Sea Creatures')).toBeNull();
  });
});
