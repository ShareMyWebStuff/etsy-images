import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { DeliveryProfile, MarketsDeliverySettingsState } from '@/lib/markets-delivery-types';
import { MarketsDeliverySettings } from './MarketsDeliverySettings';

const context = { shopId: '66615491', sectionId: '14', subSectionId: '26', listingId: '518' };
function profile(id: string, name: string, countryCode: string, deliveryInformation: string): DeliveryProfile {
  return {
    id, name, shopId: context.shopId, currencyCode: 'GBP', originCountryIso: 'GB', originPostalCode: 'SW1A 1AA',
    readinessStateId: '10', includeDeliveryInformation: true, deliveryInformation, isCalculated: false,
    destinations: [{ countryCode, primaryCostMinor: 500, secondaryCostMinor: 100, minDeliveryDays: 2, maxDeliveryDays: 5, carrierId: null, mailClass: null }],
    etsyShippingProfileId: `99${id}`, revision: 1, syncStatus: 'SYNCED', linkedListingCount: 1,
    lastSyncedAt: '2026-11-08T09:00:00.000Z', error: null, archivedAt: null, updatedAt: '2026-11-08T09:00:00.000Z',
  };
}
function state(): MarketsDeliverySettingsState {
  const effective = { profileId: '1', shippingProfileId: '991', readinessStateId: '10', includeDeliveryInformation: true,
    deliveryInformation: 'Print delivery information', usesManagedProfile: true, inherited: true, pending: true,
    profileRevision: 1, profileSyncStatus: 'SYNCED' as const };
  return { shopId: context.shopId,
    profiles: [profile('1', 'United Kingdom', 'GB', 'Print delivery information'), profile('2', 'United States', 'US', 'Custom delivery information')],
    settings: null, templateSettings: { printProfileId: '1', customisedProfileId: '2', includeDeliveryInformation: null, deliveryInformation: null },
    effective: { print: effective, customised: { ...effective, profileId: '2', shippingProfileId: '992' } },
    isInherited: true, pending: true, baseDescription: 'Artwork details\nDelivery\nManually written paragraph.',
  };
}

afterEach(() => vi.unstubAllGlobals());

describe('Markets & Delivery listing settings', () => {
  it('keeps digital-only listings free of physical settings and external loads', () => {
    const fetchMock = vi.fn(); vi.stubGlobal('fetch', fetchMock);
    render(<MarketsDeliverySettings target={{ type: 'listing', context }} printsEnabled={false} customisedEnabled={false} />);
    expect(screen.getByText('Digital downloads have no physical delivery profile or delivery information.')).toBeTruthy();
    expect(screen.queryByRole('combobox')).toBeNull();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('previews each physical product with profile wording while preserving the base description', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(Response.json({ data: state() })));
    render(<MarketsDeliverySettings target={{ type: 'listing', context }} printsEnabled customisedEnabled />);
    await screen.findByRole('checkbox', { name: 'Use template defaults' });
    expect(screen.getByTestId('delivery-preview-print').textContent).toBe('Artwork details\nDelivery\nManually written paragraph.\n\nDelivery\nPrint delivery information');
    expect(screen.getByTestId('delivery-preview-customised').textContent).toContain('Custom delivery information');
    expect((screen.getByRole('combobox', { name: 'Print / Frames delivery profile' }) as HTMLSelectElement).disabled).toBe(true);
    expect(screen.getByText('United Kingdom', { selector: 'p' })).toBeTruthy();
    expect(screen.getByText('Saved locally · pending Etsy sync.')).toBeTruthy();
  });

  it('saves an explicit override and resets by deleting the override', async () => {
    const initial = state();
    const fetchMock = vi.fn(async (_url: string, init?: RequestInit) => {
      if (init?.method !== 'PUT') return Response.json({ data: initial });
      const body = JSON.parse(String(init.body));
      return Response.json({ data: { ...initial, settings: body.settings, isInherited: body.settings === null } });
    });
    vi.stubGlobal('fetch', fetchMock);
    render(<MarketsDeliverySettings target={{ type: 'listing', context }} printsEnabled customisedEnabled />);
    fireEvent.click(await screen.findByRole('checkbox', { name: 'Use template defaults' }));
    fireEvent.change(screen.getByRole('combobox', { name: 'Print / Frames delivery profile' }), { target: { value: '2' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save Delivery Settings' }));
    await waitFor(() => expect(fetchMock.mock.calls.filter(([, init]) => init?.method === 'PUT')).toHaveLength(1));
    const saved = JSON.parse(String(fetchMock.mock.calls.find(([, init]) => init?.method === 'PUT')?.[1]?.body));
    expect(saved).toMatchObject({ ...context, settings: { printProfileId: '2', customisedProfileId: '2' } });
    await screen.findByText('Delivery settings saved. Sync this physical listing to apply changes on Etsy.');
    fireEvent.click(screen.getByRole('button', { name: 'Reset to template' }));
    await waitFor(() => expect(fetchMock.mock.calls.filter(([, init]) => init?.method === 'PUT')).toHaveLength(2));
    expect(JSON.parse(String(fetchMock.mock.calls.filter(([, init]) => init?.method === 'PUT')[1][1]?.body)).settings).toBeNull();
  });

  it('exposes only one profile selector when print and custom products share an Etsy listing', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(Response.json({ data: state() })));
    render(<MarketsDeliverySettings target={{ type: 'listing', context }} printsEnabled customisedEnabled sharedPhysicalListing />);
    await screen.findByRole('checkbox', { name: 'Use template defaults' });
    expect(screen.getAllByRole('combobox')).toHaveLength(1);
    expect(screen.getByText(/Framed and unframed options are variations/).textContent).toContain('share one delivery profile and its rates');
  });

  it('allows a multiple template to reset its delivery override to its followed template', async () => {
    const initial = state();
    initial.settings = { ...initial.templateSettings!, printProfileId: '2' };
    initial.baseDescription = '';
    const fetchMock = vi.fn(async (_url: string, init?: RequestInit) => Response.json({ data: init?.method === 'PUT'
      ? { ...initial, settings: null } : initial }));
    vi.stubGlobal('fetch', fetchMock);
    render(<MarketsDeliverySettings target={{ type: 'template', templateId: '42', shopId: context.shopId }} printsEnabled customisedEnabled />);
    fireEvent.click(await screen.findByRole('button', { name: 'Reset to followed template' }));
    await waitFor(() => expect(fetchMock.mock.calls.some(([url, init]) => url === '/api/etsy/markets-delivery/template' && init?.method === 'PUT')).toBe(true));
    expect(JSON.parse(String(fetchMock.mock.calls.find(([, init]) => init?.method === 'PUT')?.[1]?.body))).toEqual({
      templateId: '42', shopId: context.shopId, settings: null,
    });
  });

  it('shows changed Etsy text and requires an explicit description replacement review', async () => {
    const initial = state();
    initial.effective.print.descriptionConflict = 'The description changed directly in Etsy.';
    initial.effective.print.remoteDescription = 'The seller edited this on Etsy.';
    const fetchMock = vi.fn(async (_url: string, init?: RequestInit) => Response.json({ data: init?.method === 'PUT'
      ? { ...initial, effective: { ...initial.effective, print: { ...initial.effective.print, descriptionConflict: null } } } : initial }));
    vi.stubGlobal('fetch', fetchMock);
    render(<MarketsDeliverySettings target={{ type: 'listing', context }} printsEnabled customisedEnabled={false} />);
    expect(await screen.findByRole('alert')).toHaveProperty('textContent', 'Etsy description needs review — Print / Frames');
    expect(screen.getByText('The seller edited this on Etsy.')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Use saved local description on next sync' }));
    await waitFor(() => expect(fetchMock.mock.calls.some(([, init]) => init?.method === 'PUT')).toBe(true));
    const body = JSON.parse(String(fetchMock.mock.calls.find(([, init]) => init?.method === 'PUT')?.[1]?.body));
    expect(body).toEqual({ ...context, settings: null, confirmDescriptionOverwrite: true });
  });
});
