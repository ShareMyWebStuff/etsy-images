import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import type { DeliveryAffectedListing, DeliveryProfile, MarketsDeliveryPageData } from '@/lib/markets-delivery-types';
import { MarketsDeliveryClient } from './MarketsDeliveryClient';

function profile(overrides: Partial<DeliveryProfile> = {}): DeliveryProfile {
  return {
    id: 'profile-1', shopId: '66615491', name: 'UK prints', currencyCode: 'GBP',
    originCountryIso: 'GB', originPostalCode: 'SW1A 1AA', readinessStateId: null,
    includeDeliveryInformation: false, deliveryInformation: '',
    destinations: [{ countryCode: 'GB', primaryCostMinor: 325, secondaryCostMinor: 110, minDeliveryDays: 2, maxDeliveryDays: 5, carrierId: null, mailClass: null }],
    etsyShippingProfileId: '12345', revision: 2, syncStatus: 'PENDING', linkedListingCount: 0,
    lastSyncedAt: null, error: null, archivedAt: null, isCalculated: false, updatedAt: '2026-11-08T10:00:00.000Z',
    ...overrides,
  };
}

function pageData(profiles = [profile()]): MarketsDeliveryPageData {
  return {
    shopId: '66615491', shops: [{ id: '66615491', name: 'Nursery Art', currencyCode: 'GBP' }, { id: '999', name: 'Other shop', currencyCode: 'USD' }],
    currencyCode: 'GBP', profiles,
    connection: { connected: true, canRead: true, canWrite: true, message: null },
    pricing: { available: false, message: 'No reliable destination-specific PrintShrimp quote is available.' },
  };
}

function response(payload: unknown, ok = true) {
  return { ok, json: async () => payload } as Response;
}

const affected: DeliveryAffectedListing[] = [{
  listingId: '518', listingName: 'Woodland fox', templateName: 'Nursery', variant: 'print', etsyListingId: '4541741363', inherited: true,
  descriptionPreview: 'A woodland print.\n\nDelivery\nShips to selected countries.',
}];

describe('MarketsDeliveryClient', () => {
  it('shows imported broad coverage and protects calculated profiles from unsupported edits', () => {
    render(<MarketsDeliveryClient initialData={pageData([profile({
      name: 'Worldwide calculated', isCalculated: true, syncStatus: 'SYNCED',
      destinations: [{ countryCode: '*', primaryCostMinor: 0, secondaryCostMinor: 0, minDeliveryDays: 2, maxDeliveryDays: 5, carrierId: null, mailClass: null }],
    })])} />);
    expect(screen.getByText('Everywhere Else / worldwide')).toBeTruthy();
    expect(screen.getByText(/Imported worldwide or regional coverage is enabled/)).toBeTruthy();
    expect((screen.getByRole('button', { name: 'Edit Worldwide calculated' }) as HTMLButtonElement).disabled).toBe(true);
    expect((screen.getByRole('button', { name: 'Duplicate Worldwide calculated' }) as HTMLButtonElement).disabled).toBe(true);
    expect((screen.getByRole('button', { name: 'Sync Worldwide calculated to Etsy' }) as HTMLButtonElement).disabled).toBe(true);
    expect(screen.getByText('Cost unavailable')).toBeTruthy();
    expect(screen.getByText(/Framed and unframed variations share/)).toBeTruthy();
  });

  it('starts with no countries, origin or claims and saves explicit destination charges locally in minor units', async () => {
    const user = userEvent.setup({ delay: null });
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(response({ data: pageData() }));
    render(<MarketsDeliveryClient initialData={pageData([])} />);
    await user.click(screen.getByRole('button', { name: 'Create profile' }));
    const dialog = screen.getByRole('dialog');
    expect((within(dialog).getByLabelText('Origin country') as HTMLSelectElement).value).toBe('');
    expect((within(dialog).getByLabelText('Delivery information') as HTMLTextAreaElement).value).toBe('');
    expect((within(dialog).getByLabelText('Include delivery information in description by default') as HTMLInputElement).checked).toBe(false);
    expect(within(dialog).getByText('Selected: No countries selected')).toBeTruthy();
    await user.type(within(dialog).getByLabelText('Profile name'), 'UK only');
    await user.selectOptions(within(dialog).getByLabelText('Origin country'), 'GB');
    await user.type(within(dialog).getByLabelText('Origin postal code'), 'SW1A 1AA');
    await user.click(within(dialog).getByRole('button', { name: 'Add United Kingdom' }));
    expect((within(dialog).getByLabelText('First-item charge for GB') as HTMLInputElement).value).toBe('');
    await user.type(within(dialog).getByLabelText('First-item charge for GB'), '3.25');
    await user.type(within(dialog).getByLabelText('Additional-item charge for GB'), '1.10');
    await user.type(within(dialog).getByLabelText('Minimum transit days for GB'), '2');
    await user.type(within(dialog).getByLabelText('Maximum transit days for GB'), '5');
    await user.click(within(dialog).getByRole('button', { name: 'Save locally' }));
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    const body = JSON.parse(fetchMock.mock.calls[0][1]?.body as string);
    expect(body).toMatchObject({ shopId: '66615491', action: 'create', values: { name: 'UK only', currencyCode: 'GBP', originCountryIso: 'GB', includeDeliveryInformation: false, deliveryInformation: '', destinations: [{ countryCode: 'GB', primaryCostMinor: 325, secondaryCostMinor: 110 }] } });
    expect(body.values.destinations).toHaveLength(1);
    expect(screen.getByRole('status').textContent).toContain('Saved locally');
  });

  it('requires explicit free delivery or charges for a selected destination', async () => {
    const user = userEvent.setup({ delay: null });
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(response({ data: pageData() }));
    render(<MarketsDeliveryClient initialData={pageData()} />);
    await user.click(screen.getByRole('button', { name: 'Edit UK prints' }));
    const dialog = screen.getByRole('dialog');
    await user.click(within(dialog).getByRole('button', { name: 'Add United States' }));
    await user.type(within(dialog).getByLabelText('Minimum transit days for US'), '3');
    await user.type(within(dialog).getByLabelText('Maximum transit days for US'), '7');
    await user.click(within(dialog).getByRole('button', { name: 'Save locally' }));
    expect(within(dialog).getByRole('alert').textContent).toContain('first-item charge');
    expect(fetchMock).not.toHaveBeenCalled();
    await user.click(within(dialog).getByLabelText('Free delivery for United States (US) (both charges zero)'));
    expect((within(dialog).getByLabelText('First-item charge for US') as HTMLInputElement).disabled).toBe(true);
    await user.click(within(dialog).getByRole('button', { name: 'Save locally' }));
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    const body = JSON.parse(fetchMock.mock.calls[0][1]?.body as string);
    expect(body.values.destinations.find((destination: { countryCode: string }) => destination.countryCode === 'US')).toMatchObject({ primaryCostMinor: 0, secondaryCostMinor: 0 });
  });

  it('previews shared changes and the complete physical description before an acknowledged local save', async () => {
    const user = userEvent.setup({ delay: null });
    const data = pageData([profile({ linkedListingCount: 1 })]);
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(response({ data, affectedListings: affected }));
    render(<MarketsDeliveryClient initialData={data} />);
    await user.click(screen.getByRole('button', { name: 'Edit UK prints' }));
    const dialog = screen.getByRole('dialog');
    await user.click(within(dialog).getByRole('button', { name: 'Save locally' }));
    expect(within(dialog).getByRole('alert').textContent).toContain('Preview the affected listings');
    expect(fetchMock).not.toHaveBeenCalled();
    await user.click(within(dialog).getByRole('button', { name: 'Preview affected listings' }));
    await waitFor(() => expect(within(dialog).getByText(/Woodland fox — Print/)).toBeTruthy());
    expect(within(dialog).getByText('A woodland print. Delivery Ships to selected countries.')).toBeTruthy();
    expect(JSON.parse(fetchMock.mock.calls[0][1]?.body as string)).toMatchObject({ action: 'impact', profileId: 'profile-1', values: { name: 'UK prints' } });
    await user.click(within(dialog).getByLabelText('I have reviewed the affected listings for these changes.'));
    await user.click(within(dialog).getByRole('button', { name: 'Save locally' }));
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
    expect(JSON.parse(fetchMock.mock.calls[1][1]?.body as string)).toMatchObject({ action: 'update', profileId: 'profile-1', expectedRevision: 2, confirmAffected: true });
  });

  it('blocks archiving assigned profiles without calling Etsy or the local mutation route', async () => {
    const user = userEvent.setup({ delay: null });
    const fetchMock = vi.spyOn(globalThis, 'fetch');
    render(<MarketsDeliveryClient initialData={pageData([profile({ linkedListingCount: 2 })])} />);
    await user.click(screen.getByRole('button', { name: 'Archive UK prints' }));
    const dialog = screen.getByRole('dialog');
    expect(within(dialog).getByText(/Choose replacement profiles/)).toBeTruthy();
    expect((within(dialog).getByRole('button', { name: 'Archive locally' }) as HTMLButtonElement).disabled).toBe(true);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('requires affected-listing review and a separate explicit sync action', async () => {
    const user = userEvent.setup({ delay: null });
    const data = pageData([profile({ linkedListingCount: 1 })]);
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(response({ data, affectedListings: affected }));
    render(<MarketsDeliveryClient initialData={data} />);
    await user.click(screen.getByRole('button', { name: 'Sync UK prints to Etsy' }));
    const dialog = screen.getByRole('dialog');
    await waitFor(() => expect(within(dialog).getByText(/Woodland fox — Print/)).toBeTruthy());
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(JSON.parse(fetchMock.mock.calls[0][1]?.body as string).action).toBe('impact');
    expect((within(dialog).getByRole('button', { name: 'Sync to Etsy' }) as HTMLButtonElement).disabled).toBe(true);
    await user.click(within(dialog).getByLabelText('I reviewed the destinations and affected listings and want to sync this profile to Etsy.'));
    await user.click(within(dialog).getByRole('button', { name: 'Sync to Etsy' }));
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
    expect(JSON.parse(fetchMock.mock.calls[1][1]?.body as string)).toMatchObject({ action: 'sync', profileId: 'profile-1', confirmAffected: true });
  });

  it('keeps conflict feedback visible and requires explicit overwrite or remote import', async () => {
    const user = userEvent.setup({ delay: null });
    const data = pageData();
    const fetchMock = vi.spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(response({ data, affectedListings: [] }))
      .mockResolvedValueOnce(response({ data: pageData([profile({ syncStatus: 'CONFLICT', error: 'Changed in Etsy.' })]), error: 'Changed in Etsy.' }, false));
    render(<MarketsDeliveryClient initialData={data} />);
    await user.click(screen.getByRole('button', { name: 'Sync UK prints to Etsy' }));
    const dialog = screen.getByRole('dialog');
    await waitFor(() => expect(within(dialog).getByText('No local physical listings use this profile.')).toBeTruthy());
    await user.click(within(dialog).getByLabelText('I reviewed the destinations and affected listings and want to sync this profile to Etsy.'));
    await user.click(within(dialog).getByRole('button', { name: 'Sync to Etsy' }));
    await waitFor(() => expect(within(dialog).getByRole('button', { name: 'Replace local with Etsy version' })).toBeTruthy());
    expect(within(dialog).getByRole('alert').textContent).toContain('Changed in Etsy');
    await waitFor(() => expect((within(dialog).getByRole('button', { name: 'Overwrite Etsy and sync' }) as HTMLButtonElement).disabled).toBe(true));
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('invalidates shared-change approval when the draft changes after preview', async () => {
    const user = userEvent.setup({ delay: null });
    const data = pageData([profile({ linkedListingCount: 1 })]);
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(response({ data, affectedListings: affected }));
    render(<MarketsDeliveryClient initialData={data} />);
    await user.click(screen.getByRole('button', { name: 'Edit UK prints' }));
    const dialog = screen.getByRole('dialog');
    await user.click(within(dialog).getByRole('button', { name: 'Preview affected listings' }));
    const acknowledgment = await within(dialog).findByLabelText('I have reviewed the affected listings for these changes.');
    await user.click(acknowledgment);
    await user.type(within(dialog).getByLabelText('Profile name'), ' revised');
    expect((acknowledgment as HTMLInputElement).checked).toBe(false);
    await user.click(within(dialog).getByRole('button', { name: 'Save locally' }));
    expect(within(dialog).getByRole('alert').textContent).toContain('Preview the affected listings');
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('imports only after the explicit import action and loads another shop with its own currency', async () => {
    const user = userEvent.setup({ delay: null });
    const data = pageData();
    const otherShop = { ...data, shopId: '999', currencyCode: 'USD', profiles: [] };
    const fetchMock = vi.spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(response({ data, importedCount: 1 }))
      .mockResolvedValueOnce(response({ data: otherShop }));
    render(<MarketsDeliveryClient initialData={data} />);
    await user.click(screen.getByRole('button', { name: 'Import from Etsy' }));
    expect(fetchMock).not.toHaveBeenCalled();
    const dialog = screen.getByRole('dialog');
    expect(within(dialog).getByText(/Existing unsynced local changes are preserved/)).toBeTruthy();
    await user.click(within(dialog).getByRole('button', { name: 'Import profiles' }));
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    expect(JSON.parse(fetchMock.mock.calls[0][1]?.body as string)).toMatchObject({ action: 'import', shopId: '66615491' });
    await user.selectOptions(screen.getByLabelText('Shop'), '999');
    await waitFor(() => expect(screen.getByText('USD')).toBeTruthy());
    expect(fetchMock.mock.calls[1][0]).toBe('/api/etsy/markets-delivery?shopId=999');
    expect(screen.queryByText('UK prints')).toBeNull();
  });

  it('shows a reconnect action when required Etsy permissions are missing', () => {
    const data = pageData();
    data.connection = { connected: true, canRead: false, canWrite: false, message: 'Reconnect Etsy with shops_r and shops_w permissions.' };
    render(<MarketsDeliveryClient initialData={data} />);
    expect((screen.getByRole('link', { name: 'Reconnect Etsy' }) as HTMLAnchorElement).getAttribute('href')).toBe('/connect-etsy');
    expect((screen.getByRole('button', { name: 'Import from Etsy' }) as HTMLButtonElement).disabled).toBe(true);
    expect((screen.getByRole('button', { name: 'Sync UK prints to Etsy' }) as HTMLButtonElement).disabled).toBe(true);
    expect((screen.getByRole('button', { name: 'Create profile' }) as HTMLButtonElement).disabled).toBe(false);
  });

  it('requires confirmed shop currency before creating or syncing charges', async () => {
    const user = userEvent.setup({ delay: null });
    const data = pageData();
    data.currencyCode = null;
    render(<MarketsDeliveryClient initialData={data} />);
    expect((screen.getByRole('button', { name: 'Create profile' }) as HTMLButtonElement).disabled).toBe(true);
    expect((screen.getByRole('button', { name: 'Sync UK prints to Etsy' }) as HTMLButtonElement).disabled).toBe(true);
    expect(screen.getByText(/The shop currency is not confirmed/)).toBeTruthy();
    await user.click(screen.getByRole('button', { name: 'Edit UK prints' }));
    const dialog = screen.getByRole('dialog');
    expect((within(dialog).getByLabelText('Currency') as HTMLInputElement).value).toBe('GBP');
    expect((within(dialog).getByRole('button', { name: 'Save locally' }) as HTMLButtonElement).disabled).toBe(true);
  });

  it('requires an explicit currency change and fresh rates instead of converting saved charges', async () => {
    const user = userEvent.setup({ delay: null });
    const data = pageData();
    data.currencyCode = 'USD';
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(response({ data }));
    render(<MarketsDeliveryClient initialData={data} />);
    expect((screen.getByRole('button', { name: 'Sync UK prints to Etsy' }) as HTMLButtonElement).disabled).toBe(true);
    await user.click(screen.getByRole('button', { name: 'Edit UK prints' }));
    const dialog = screen.getByRole('dialog');
    await user.click(within(dialog).getByRole('button', { name: 'Use USD and clear rates for review' }));
    expect((within(dialog).getByLabelText('Currency') as HTMLInputElement).value).toBe('USD');
    expect((within(dialog).getByLabelText('First-item charge for GB') as HTMLInputElement).value).toBe('');
    expect((within(dialog).getByLabelText('Free delivery for United Kingdom (GB) (both charges zero)') as HTMLInputElement).checked).toBe(false);
    await user.type(within(dialog).getByLabelText('First-item charge for GB'), '2.00');
    await user.type(within(dialog).getByLabelText('Additional-item charge for GB'), '1.00');
    await user.click(within(dialog).getByRole('button', { name: 'Save locally' }));
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    expect(JSON.parse(fetchMock.mock.calls[0][1]?.body as string).values).toMatchObject({ currencyCode: 'USD', destinations: [{ primaryCostMinor: 200, secondaryCostMinor: 100 }] });
  });
});
