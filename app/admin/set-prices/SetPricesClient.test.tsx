import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import { PRICE_SECTIONS } from '@/lib/set-prices-core';
import type { PriceUpdateJobView, SetPricesData } from '@/lib/set-prices';
import { SetPricesClient } from './SetPricesClient';

vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

function makeData(latestJob: PriceUpdateJobView | null = null): SetPricesData {
  return {
    sections: PRICE_SECTIONS.map((section) => ({
      key: section.key,
      title: section.title,
      description: section.description,
      prices: section.options.map((option) => ({
        key: option.key,
        category: section.key,
        label: option.label,
        amountPence: option.defaultAmountPence,
        currencyCode: 'GBP',
        affectedListings: section.key === 'digital' ? 2 : 0,
        unsupportedMappings: 0,
      })),
    })),
    deliveryWarnings: [],
    pendingEtsy: { keys: [], affectedListings: 0, skippedListings: 0, deliveryWarnings: [] },
    latestJob,
  };
}

function withPrice(data: SetPricesData, key: string, amountPence: number): SetPricesData {
  return {
    ...data,
    sections: data.sections.map((section) => ({
      ...section,
      prices: section.prices.map((price) => price.key === key ? { ...price, amountPence } : price),
    })),
  };
}

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
}

beforeEach(() => {
  vi.spyOn(window.history, 'pushState').mockImplementation(() => undefined);
  vi.spyOn(window.history, 'back').mockImplementation(() => undefined);
  vi.spyOn(window.history, 'forward').mockImplementation(() => undefined);
});

afterEach(() => vi.unstubAllGlobals());

describe('Set Prices screen', () => {
  it('renders all four sections and all 26 accessible product fields with saved prices', () => {
    render(<SetPricesClient initialData={makeData()} />);
    expect(screen.getByRole('heading', { name: 'Digital Downloads' })).toBeTruthy();
    expect(screen.getByRole('heading', { name: 'Unframed Prints' })).toBeTruthy();
    expect(screen.getByRole('heading', { name: 'Framed Prints' })).toBeTruthy();
    expect(screen.getByRole('heading', { name: 'Customisation' })).toBeTruthy();
    expect(screen.getAllByRole('textbox')).toHaveLength(26);
    expect((screen.getByLabelText('1 Image Download') as HTMLInputElement).value).toBe('3.49');
    expect((screen.getByLabelText('Fee') as HTMLInputElement).value).toBe('4.99');
    expect(screen.getAllByLabelText('24 × 36 inches')).toHaveLength(2);
    expect(screen.getAllByLabelText('20 × 28 inches')).toHaveLength(2);
    expect(screen.getByRole('button', { name: 'Save prices' }).hasAttribute('disabled')).toBe(true);
  });

  it('validates inline, saves locally, opens Etsy confirmation, and supports Not now', async () => {
    const user = userEvent.setup();
    const initial = makeData();
    const saved = withPrice(initial, 'digital_1', 399);
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({ result: {
      data: saved,
      changedKeys: ['digital_1'],
      affectedListings: 2,
      skippedListings: 0,
      deliveryWarnings: [],
    } }));
    vi.stubGlobal('fetch', fetchMock);
    render(<SetPricesClient initialData={initial} />);
    const input = screen.getByLabelText('1 Image Download');
    await user.clear(input);
    await user.type(input, '3.999');
    expect(screen.getByText(/positive GBP amount/i)).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Save prices' }).hasAttribute('disabled')).toBe(false);
    await user.clear(input);
    await user.type(input, '3.99');
    await user.click(screen.getByRole('button', { name: 'Save prices' }));
    expect(await screen.findByRole('heading', { name: 'Apply saved prices to Etsy?' })).toBeTruthy();
    expect(screen.getByText(/2 Etsy listings can be updated/i)).toBeTruthy();
    await user.click(screen.getByRole('button', { name: 'Not now' }));
    await waitFor(() => expect(screen.queryByRole('heading', { name: 'Apply saved prices to Etsy?' })).toBeNull());
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect((input as HTMLInputElement).value).toBe('3.99');
    expect(screen.getByRole('button', { name: 'Save prices' }).hasAttribute('disabled')).toBe(true);
  });

  it('retains entered values and displays the server error when local saving fails', async () => {
    const user = userEvent.setup();
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse({ error: 'Database unavailable.' }, 500)));
    render(<SetPricesClient initialData={makeData()} />);
    const input = screen.getByLabelText('3 Downloads');
    await user.clear(input);
    await user.type(input, '5.25');
    await user.click(screen.getByRole('button', { name: 'Save prices' }));
    expect((await screen.findByRole('alert')).textContent).toContain('Database unavailable.');
    expect((input as HTMLInputElement).value).toBe('5.25');
  });

  it('retains a Not now decision for later Etsy review', async () => {
    const user = userEvent.setup();
    const data = makeData();
    data.pendingEtsy = { keys: ['digital_1'], affectedListings: 2, skippedListings: 0, deliveryWarnings: [] };
    render(<SetPricesClient initialData={data} />);
    await user.click(screen.getByRole('button', { name: 'Review Etsy updates (1)' }));
    expect(screen.getByRole('heading', { name: 'Apply saved prices to Etsy?' })).toBeTruthy();
    expect(screen.getByText(/2 Etsy listings can be updated/i)).toBeTruthy();
    await user.click(screen.getByRole('button', { name: 'Not now' }));
    expect(screen.queryByRole('heading', { name: 'Apply saved prices to Etsy?' })).toBeNull();
  });

  it('protects in-app links with Keep editing and Leave without saving actions', async () => {
    const user = userEvent.setup();
    render(<><a href="/shops">Go to shops</a><SetPricesClient initialData={makeData()} /></>);
    const input = screen.getByLabelText('6 Downloads');
    await user.clear(input);
    await user.type(input, '8.00');
    await user.click(screen.getByRole('link', { name: 'Go to shops' }));
    expect(screen.getByRole('heading', { name: 'Save changes before leaving?' })).toBeTruthy();
    await user.click(screen.getByRole('button', { name: 'Keep editing' }));
    expect(screen.queryByRole('heading', { name: 'Save changes before leaving?' })).toBeNull();
    expect((input as HTMLInputElement).value).toBe('8.00');
    await user.click(screen.getByRole('link', { name: 'Go to shops' }));
    await user.click(screen.getByRole('button', { name: 'Leave without saving' }));
    expect(window.history.back).toHaveBeenCalled();
  });

  it('supports Save and leave, remains on failure, and guards browser Back/refresh', async () => {
    const user = userEvent.setup();
    const initial = makeData();
    const saved = withPrice(initial, 'digital_12', 1099);
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(jsonResponse({ error: 'Save failed.' }, 500))
      .mockResolvedValueOnce(jsonResponse({ result: { data: saved, changedKeys: ['digital_12'], affectedListings: 2, skippedListings: 0, deliveryWarnings: [] } }));
    vi.stubGlobal('fetch', fetchMock);
    render(<><a href="/shops">Go elsewhere</a><SetPricesClient initialData={initial} /></>);
    const input = screen.getByLabelText('12 Downloads');
    await user.clear(input);
    await user.type(input, '10.99');

    const unload = new Event('beforeunload', { cancelable: true });
    window.dispatchEvent(unload);
    expect(unload.defaultPrevented).toBe(true);
    fireEvent.popState(window);
    expect(window.history.forward).toHaveBeenCalled();
    expect(screen.getByRole('heading', { name: 'Save changes before leaving?' })).toBeTruthy();
    await user.click(screen.getByRole('button', { name: 'Save and leave' }));
    expect(await screen.findByText('Save failed.', { selector: '[role="alert"]' })).toBeTruthy();
    expect(screen.getByRole('heading', { name: 'Save changes before leaving?' })).toBeTruthy();
    await user.click(screen.getByRole('button', { name: 'Save and leave' }));
    await waitFor(() => expect(window.history.back).toHaveBeenCalled());
  });

  it('shows real partial-failure progress and retries only failed listings', async () => {
    const user = userEvent.setup();
    const failedJob: PriceUpdateJobView = {
      id: 'job-1', changedKeys: ['digital_1'], status: 'completed', total: 2, processed: 2, succeeded: 1, failed: 1, skipped: 0, currentListing: null, completedAt: new Date().toISOString(),
      items: [
        { id: '1', listingId: '1', listingName: 'Succeeded listing', status: 'updated', attempts: 1, message: null },
        { id: '2', listingId: '2', listingName: 'Failed listing', status: 'failed', attempts: 1, message: 'Etsy unavailable.' },
      ],
    };
    const waitingJob = { ...failedJob, status: 'waiting' as const, processed: 1, failed: 0, completedAt: null, items: failedJob.items.map((item) => item.id === '2' ? { ...item, status: 'waiting' as const, message: null } : item) };
    const completedJob = { ...failedJob, succeeded: 2, failed: 0, items: failedJob.items.map((item) => ({ ...item, status: 'updated' as const, message: null, attempts: item.id === '2' ? 2 : item.attempts })) };
    const actions: string[] = [];
    vi.stubGlobal('fetch', vi.fn(async (_url: string, init?: RequestInit) => {
      const action = JSON.parse(String(init?.body)).action as string;
      actions.push(action);
      return jsonResponse({ job: action === 'retry' ? waitingJob : completedJob });
    }));
    render(<SetPricesClient initialData={makeData(failedJob)} />);
    expect(screen.getByText('Etsy unavailable.')).toBeTruthy();
    await user.click(screen.getByRole('button', { name: /retry failed/i }));
    await waitFor(() => expect(actions).toEqual(['retry', 'process']));
    await waitFor(() => expect(screen.queryByText('Etsy unavailable.')).toBeNull());
  });
});
