import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  ETSY_LEDGER_MAX_WINDOW_SECONDS,
  getEtsyLedgerDateWindows,
  getEtsyLedgerEntries,
  getEtsyReceipts,
  createEtsyReceiptShipment,
  EtsyShipmentError,
} from '@/lib/etsy-accounting-api';

describe('Etsy accounting pagination', () => {
  it('sends dispatch tracking through the shipment endpoint using POST', async () => {
    vi.stubEnv('ETSY_KEYSTRING', 'key'); vi.stubEnv('ETSY_SHARED_SECRET', 'secret');
    const fetchMock = vi.fn().mockResolvedValue(Response.json({ receipt_id: 123 }));
    vi.stubGlobal('fetch', fetchMock);
    await createEtsyReceiptShipment({ accessToken: 'token', shopId: '1', receiptId: '123', trackingCode: 'AB123GB', carrierName: 'royal-mail' });
    expect(fetchMock).toHaveBeenCalledWith('https://openapi.etsy.com/v3/application/shops/1/receipts/123/tracking', expect.objectContaining({
      method: 'POST', body: new URLSearchParams({ tracking_code: 'AB123GB', carrier_name: 'royal-mail' }),
    }));
  });

  it('preserves uncertainty after a dispatch timeout so a notification is not blindly repeated', async () => {
    vi.stubEnv('ETSY_KEYSTRING', 'key'); vi.stubEnv('ETSY_SHARED_SECRET', 'secret');
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('Timeout')));
    await expect(createEtsyReceiptShipment({ accessToken: 'token', shopId: '1', receiptId: '123', trackingCode: '', carrierName: '' })).rejects.toMatchObject({ status: null });
  });

  it('reports a definite Etsy permission rejection separately from an uncertain outcome', async () => {
    vi.stubEnv('ETSY_KEYSTRING', 'key'); vi.stubEnv('ETSY_SHARED_SECRET', 'secret');
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(Response.json({ error: 'Not authorised' }, { status: 403 })));
    await expect(createEtsyReceiptShipment({ accessToken: 'token', shopId: '1', receiptId: '123', trackingCode: '', carrierName: '' })).rejects.toBeInstanceOf(EtsyShipmentError);
  });
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  it('loads every page and sends incremental date filters without calling Etsy for real', async () => {
    vi.stubEnv('ETSY_KEYSTRING', 'key');
    vi.stubEnv('ETSY_SHARED_SECRET', 'secret');
    const firstPage = Array.from({ length: 100 }, (_, index) => ({ receipt_id: index + 1 }));
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ count: 101, results: firstPage }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ count: 101, results: [{ receipt_id: 101 }] }), { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);

    const receipts = await getEtsyReceipts({
      accessToken: 'token',
      shopId: '123',
      minCreated: 1_600_000_000,
      maxCreated: 1_650_000_000,
      minLastModified: 1_700_000_000,
      maxLastModified: 1_800_000_000,
    });

    expect(receipts).toHaveLength(101);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(String(fetchMock.mock.calls[0][0])).toContain('offset=0');
    expect(String(fetchMock.mock.calls[1][0])).toContain('offset=100');
    expect(String(fetchMock.mock.calls[0][0])).toContain('min_last_modified=1700000000');
    expect(String(fetchMock.mock.calls[0][0])).toContain('max_last_modified=1800000000');
    expect(String(fetchMock.mock.calls[0][0])).toContain('min_created=1600000000');
    expect(String(fetchMock.mock.calls[0][0])).toContain('max_created=1650000000');
  });

  it('splits ledger imports into consecutive Etsy-compatible 31-day windows', () => {
    const minCreated = 1_700_000_000;
    const maxCreated = minCreated + ETSY_LEDGER_MAX_WINDOW_SECONDS + 10;

    expect(getEtsyLedgerDateWindows(minCreated, maxCreated)).toEqual([
      {
        minCreated,
        maxCreated: minCreated + ETSY_LEDGER_MAX_WINDOW_SECONDS,
      },
      {
        minCreated: minCreated + ETSY_LEDGER_MAX_WINDOW_SECONDS + 1,
        maxCreated,
      },
    ]);
  });

  it('loads and combines ledger entries from every date window', async () => {
    vi.stubEnv('ETSY_KEYSTRING', 'key');
    vi.stubEnv('ETSY_SHARED_SECRET', 'secret');
    const minCreated = 1_700_000_000;
    const maxCreated = minCreated + ETSY_LEDGER_MAX_WINDOW_SECONDS + 1;
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ count: 1, results: [{ entry_id: 1 }] }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ count: 1, results: [{ entry_id: 2 }] }), { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);

    const entries = await getEtsyLedgerEntries({ accessToken: 'token', shopId: '123', minCreated, maxCreated });

    expect(entries).toHaveLength(2);
    expect(fetchMock).toHaveBeenCalledTimes(2);

    const firstUrl = new URL(String(fetchMock.mock.calls[0][0]));
    const secondUrl = new URL(String(fetchMock.mock.calls[1][0]));
    expect(firstUrl.searchParams.get('min_created')).toBe(String(minCreated));
    expect(firstUrl.searchParams.get('max_created')).toBe(String(minCreated + ETSY_LEDGER_MAX_WINDOW_SECONDS));
    expect(secondUrl.searchParams.get('min_created')).toBe(String(minCreated + ETSY_LEDGER_MAX_WINDOW_SECONDS + 1));
    expect(secondUrl.searchParams.get('max_created')).toBe(String(maxCreated));
  });
});
