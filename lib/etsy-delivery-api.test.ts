import { describe, expect, it, vi } from 'vitest';
import { buildEtsyDeliveryDestinationBody, createEtsyDeliveryApi, type EtsyDeliveryDestinationValues } from '@/lib/etsy-delivery-api';

const destination: EtsyDeliveryDestinationValues = { countryCode: 'GB', primaryCostMinor: 450, secondaryCostMinor: 125, minDeliveryDays: 2, maxDeliveryDays: 5, carrierId: null, mailClass: null };
function makeApi(fetcher: typeof fetch, scopes = ['shops_r', 'shops_w']) {
  const wait = vi.fn().mockResolvedValue(undefined);
  return { api: createEtsyDeliveryApi({ fetch: fetcher, getAccessToken: async () => 'test-token', getApiKey: () => 'test-key:test-secret',
    getConnectionStatus: async () => ({ connected: true, scopes }), wait }), wait };
}

describe('Etsy delivery API safety', () => {
  it('always sends a selected country and exact shop currency amounts, including deliberate free delivery', () => {
    const body = buildEtsyDeliveryDestinationBody(destination, 'GBP');
    expect(Object.fromEntries(body)).toMatchObject({ destination_country_iso: 'GB', primary_cost: '4.50', secondary_cost: '1.25', min_delivery_days: '2', max_delivery_days: '5' });
    expect(body.has('destination_region')).toBe(false);
    expect(body.has('shipping_carrier_id')).toBe(false);
    expect(body.has('mail_class')).toBe(false);
    expect(buildEtsyDeliveryDestinationBody({ ...destination, primaryCostMinor: 0 }, 'GBP').get('primary_cost')).toBe('0.00');
    expect(buildEtsyDeliveryDestinationBody({ ...destination, primaryCostMinor: 450 }, 'JPY').get('primary_cost')).toBe('450');
  });
  it.each(['', '*', 'region:eu', 'region:non_eu'])('rejects a new implicit or broad destination %s', (countryCode) => {
    expect(() => buildEtsyDeliveryDestinationBody({ ...destination, countryCode }, 'GBP')).toThrow();
  });
  it('requires both service fields or a supported transit range', () => {
    expect(() => buildEtsyDeliveryDestinationBody({ ...destination, minDeliveryDays: null }, 'GBP')).toThrow();
    expect(() => buildEtsyDeliveryDestinationBody({ ...destination, maxDeliveryDays: 46 }, 'GBP')).toThrow();
    expect(() => buildEtsyDeliveryDestinationBody({ ...destination, carrierId: '1' }, 'GBP')).toThrow();
    const serviceBody = buildEtsyDeliveryDestinationBody({ ...destination, carrierId: '1', mailClass: 'first-class' }, 'GBP');
    expect(serviceBody.get('shipping_carrier_id')).toBe('1');
    expect(serviceBody.get('mail_class')).toBe('first-class');
    expect(serviceBody.has('min_delivery_days')).toBe(false);
    expect(serviceBody.has('max_delivery_days')).toBe(false);
  });
  it.each(['createProfile', 'createDestination', 'updateDestination'] as const)('%s sends transit days without service fields, including empty or zero placeholders', async (operation) => {
    const fetcher = vi.fn(async (_url: string | URL | Request, init?: RequestInit) => {
      const body = new URLSearchParams(String(init?.body));
      if ((body.has('shipping_carrier_id') || body.has('mail_class')) && (body.has('min_delivery_days') || body.has('max_delivery_days'))) {
        return Response.json({ error: "You can't provide a carrier or mail class and min/max delivery days at the same time." }, { status: 400 });
      }
      return Response.json({ shipping_profile_id: 2, shipping_profile_destination_id: 3 });
    });
    const { api } = makeApi(fetcher);
    if (operation === 'createProfile') {
      await api.createProfile('1', { name: 'Delivery', currencyCode: 'GBP', originCountryIso: 'GB', originPostalCode: 'IP28JJ', destinations: [destination] }, destination);
    } else if (operation === 'createDestination') await api.createDestination('1', '2', destination, 'GBP');
    else await api.updateDestination('1', '2', '3', destination, 'GBP');
    expect(fetcher).toHaveBeenCalledTimes(1);
    const sent = fetcher.mock.calls[0][1]?.body as URLSearchParams;
    expect(sent.get('destination_country_iso')).toBe('GB');
    expect(sent.get('min_delivery_days')).toBe('2');
    expect(sent.get('max_delivery_days')).toBe('5');
    expect(sent.has('shipping_carrier_id')).toBe(false);
    expect(sent.has('mail_class')).toBe(false);
  });
  it('checks the OAuth scope before making a request', async () => {
    const fetcher = vi.fn();
    const { api } = makeApi(fetcher, ['shops_r']);
    await expect(api.createDestination('1', '2', destination, 'GBP')).rejects.toMatchObject({ code: 'permission' });
    expect(fetcher).not.toHaveBeenCalled();
  });
  it('paginates destination and processing metadata reads', async () => {
    const fetcher = vi.fn().mockResolvedValueOnce(Response.json({ count: 101, results: Array.from({ length: 100 }, (_, i) => ({ shipping_profile_destination_id: i + 1 })) }))
      .mockResolvedValueOnce(Response.json({ count: 101, results: [{ shipping_profile_destination_id: 101 }] }));
    const { api } = makeApi(fetcher);
    expect(await api.listDestinations('1', '2')).toHaveLength(101);
    expect(String(fetcher.mock.calls[1][0])).toContain('offset=100');
  });
  it('honours Retry-After and never retries ambiguous creates', async () => {
    const fetcher = vi.fn().mockResolvedValueOnce(new Response('', { status: 429, headers: { 'retry-after': '3' } })).mockResolvedValueOnce(Response.json({ shipping_profile_destination_id: 5 }));
    const { api, wait } = makeApi(fetcher);
    await api.createDestination('1', '2', destination, 'GBP');
    expect(wait).toHaveBeenCalledWith(3000);
    const failingFetch = vi.fn().mockRejectedValue(new Error('Timeout'));
    await expect(makeApi(failingFetch).api.createDestination('1', '2', destination, 'GBP')).rejects.toMatchObject({ code: 'ambiguous_create', ambiguous: true });
    expect(failingFetch).toHaveBeenCalledTimes(1);
  });
  it('returns long rate-limit guidance instead of retrying sooner than Etsy permits', async () => {
    const fetcher = vi.fn().mockResolvedValue(new Response('', { status: 429, headers: { 'retry-after': '3600' } }));
    const { api, wait } = makeApi(fetcher);
    await expect(api.listProfiles('1')).rejects.toMatchObject({ code: 'rate_limit', retryAfterSeconds: 3600 });
    expect(wait).not.toHaveBeenCalled();
  });
  it('preserves an imported worldwide row only through explicit existing-row updates', async () => {
    const fetcher = vi.fn().mockResolvedValue(Response.json({ shipping_profile_destination_id: 4 }));
    const { api } = makeApi(fetcher);
    await api.updateDestination('1', '2', '4', { ...destination, countryCode: '*' }, 'GBP', true);
    const sent = fetcher.mock.calls[0][1].body as URLSearchParams;
    expect(sent.has('destination_country_iso')).toBe(false);
    expect(sent.has('destination_region')).toBe(false);
    expect(fetcher.mock.calls[0][1].method).toBe('PUT');
  });
});
