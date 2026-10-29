import { fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { EtsyOrdersClient } from './EtsyOrdersClient';
import type { EtsyOrdersPageData } from '@/lib/etsy-orders';

const empty: EtsyOrdersPageData = {
  orders: [], reconnectUrl: '/api/etsy/connect', connected: true, hasTransactionsReadScope: true, hasTransactionsWriteScope: true,
};
const refreshed: EtsyOrdersPageData = { ...empty, orders: [{
  id: '6', etsyReceiptId: '123', etsyShopId: '1', name: 'Buyer', buyerEmail: '', address1: '', address2: '', city: '',
  state: '', postcode: '', countryIso: 'GB', isPaid: true, isShipped: true, isCanceled: false, isGift: false, giftMessage: '',
  etsyStatus: 'Completed', processingStatus: 'COMPLETED', orderedAt: null, updatedAtEtsy: null,
  printShrimpAttemptedAt: null, printShrimpSubmittedAt: null, printShrimpOrderId: 'ps-1', processError: null,
  printShrimpStatus: 'Shipped', printShrimpTracking: 'AB123GB', printShrimpCourier: 'Royal Mail',
  printShrimpLastCheckedAt: '2026-10-28T12:00:00Z', printShrimpSyncError: null, rawJson: {}, items: [], attempts: [],
}] };
afterEach(() => vi.unstubAllGlobals());

describe('Download new orders fulfilment results', () => {
  it.each([false, true])('shows live PrintShrimp status and tracking after refresh (warnings %s)', async (warning) => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ data: refreshed, summary: {
      downloaded: 1, refreshed: 0, printShrimpRefreshed: 1, etsyDispatchesUpdated: warning ? 0 : 1,
      fulfilmentWarnings: warning ? ['Etsy order 123: dispatch permission is missing.'] : [],
    } }) });
    vi.stubGlobal('fetch', fetchMock);
    render(<EtsyOrdersClient initialData={empty} />);
    fireEvent.click(screen.getByRole('button', { name: 'Download new orders' }));
    expect(await screen.findByText('PrintShrimp: Shipped')).toBeTruthy();
    expect(screen.getByText('Tracking: Royal Mail AB123GB')).toBeTruthy();
    expect(fetchMock).toHaveBeenCalledWith('/api/etsy/orders', { method: 'POST' });
    expect(screen.getByText(/checked 1 PrintShrimp orders/)).toBeTruthy();
    if (warning) expect(screen.getByRole('alert').textContent).toContain('dispatch permission is missing');
  });
});
