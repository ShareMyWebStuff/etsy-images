import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';

import type { MultiListingWizardData } from '@/lib/multi-listing';
import { MultiListingWizard } from './MultiListingWizard';

const push = vi.fn();
vi.mock('next/navigation', () => ({ useRouter: () => ({ push }) }));

const data: MultiListingWizardData = {
  subSection: { id: '3', name: 'Sets', numberOfDownloads: 3, includeAllDownloads: false },
  defaultSourceSectionId: '1',
  sourceSections: [{
    id: '1',
    name: 'Animals',
    sources: [
      { id: '11', name: 'Donkey', description: 'Donkey print', primaryColour: 'Beige', secondaryColour: 'Black' },
      { id: '12', name: 'Cow', description: 'Cow print', primaryColour: 'White', secondaryColour: 'Black' },
      { id: '13', name: 'Sheep', description: 'Sheep print', primaryColour: 'White', secondaryColour: 'Beige' },
    ],
  }],
};

function validationResponse() {
  return new Response(JSON.stringify({
    willReplace: true,
    existing: {
      sourceIds: ['11', '12', '13'],
      title: 'Existing set',
      description: 'Existing description',
      price: '8.33',
      quantity: '999',
      primaryColour: 'Beige',
      secondaryColour: 'Black',
      tags: ['animal print'],
      imageNames: ['bedroom.jpg', 'playroom.jpg'],
    },
  }), { status: 200, headers: { 'Content-Type': 'application/json' } });
}

afterEach(() => {
  vi.unstubAllGlobals();
  push.mockReset();
});

describe('MultiListingWizard replacement confirmation', () => {
  it('does not proceed past validation until the user explicitly confirms replacement', async () => {
    const user = userEvent.setup();
    const fetchMock = vi.fn(() => Promise.resolve(validationResponse()));
    vi.stubGlobal('fetch', fetchMock);
    render(<MultiListingWizard
      data={data}
      shopId="66615491"
      sectionId="2"
      subSectionId="3"
      initialListingName="Farm set"
      numberOfItems={3}
      includeAllItems={false}
      etsyProductType="physical"
    />);

    await user.click(screen.getByRole('button', { name: 'Next' }));

    expect(await screen.findByRole('heading', { name: 'Replace the existing listing?' })).toBeTruthy();
    expect(screen.getByRole('alert').textContent).toContain('replace its generated files');
    expect(screen.queryByRole('heading', { name: 'Select source listings' })).toBeNull();
    expect(fetchMock).toHaveBeenCalledTimes(1);

    await user.click(screen.getByRole('button', { name: 'Replace existing listing' }));

    expect(await screen.findByRole('heading', { name: 'Select source listings' })).toBeTruthy();
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});
