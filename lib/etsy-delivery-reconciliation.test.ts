import { expect, it, vi } from 'vitest';
import { createEtsyDeliveryApi, type EtsyDeliveryDestination, type EtsyDeliveryProfile } from '@/lib/etsy-delivery-api';
import { etsyDeliveryFingerprint, syncEtsyDeliveryProfile, type EtsyDeliveryCheckpoint } from '@/lib/etsy-delivery-sync';

it('syncs and retries against the current profile without resurrecting a stale worldwide destination from the list endpoint', async () => {
  const shopId = '66615491';
  const profileId = '315358249230';
  const destination = (country: string, id: string, amount = 0): EtsyDeliveryDestination => ({
    shipping_profile_destination_id: id, shipping_profile_id: profileId,
    destination_country_iso: country, destination_region: 'none',
    primary_cost: { amount, divisor: 100, currency_code: 'GBP' },
    secondary_cost: { amount, divisor: 100, currency_code: 'GBP' },
    min_delivery_days: 2, max_delivery_days: 4, shipping_carrier_id: 0, mail_class: null,
  });
  const current: EtsyDeliveryProfile = {
    shipping_profile_id: profileId, title: 'Print delivery', profile_type: 'manual',
    origin_country_iso: 'GB', origin_postal_code: 'IP28JJ',
    shipping_profile_destinations: [destination('GB', '64389346961')],
  };
  const staleWorldwide = destination('', '64097858396');
  const writes: Array<{ method: string; path: string; body: URLSearchParams }> = [];
  const fetcher = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
    const path = new URL(String(input)).pathname.replace('/v3/application', '');
    const method = init?.method ?? 'GET';
    if (method === 'GET' && path === `/shops/${shopId}`) return Response.json({ currency_code: 'GBP' });
    if (method === 'GET' && path === `/shops/${shopId}/shipping-profiles/${profileId}`) return Response.json(current);
    if (method === 'GET' && path === `/shops/${shopId}/shipping-profiles/${profileId}/destinations`) {
      return Response.json({ count: current.shipping_profile_destinations.length + 1, results: [staleWorldwide, ...current.shipping_profile_destinations] });
    }
    const body = new URLSearchParams(String(init?.body ?? ''));
    writes.push({ method, path, body });
    if (method === 'DELETE' && path.endsWith('/destinations/64097858396')) {
      return Response.json({ error: 'Could not find a ShopShippingProfileDestination = 64097858396 associated with Shop 66615491.' }, { status: 404 });
    }
    if (method === 'POST' && path === `/shops/${shopId}/shipping-profiles/${profileId}/destinations` && body.get('destination_country_iso') === 'AU') {
      if (body.has('shipping_carrier_id') || body.has('mail_class')) return Response.json({ error: 'Cannot combine service fields and transit days.' }, { status: 400 });
      const created = destination('AU', '70000000001', 349);
      current.shipping_profile_destinations.push(created);
      return Response.json(created, { status: 201 });
    }
    return Response.json({ error: `Unexpected operation: ${method} ${path}` }, { status: 400 });
  });
  const api = createEtsyDeliveryApi({ fetch: fetcher, getAccessToken: async () => 'mock-token', getApiKey: () => 'mock-key',
    getConnectionStatus: async () => ({ connected: true, scopes: ['shops_r', 'shops_w'] }) });
  const profile = {
    shopId, etsyShippingProfileId: profileId, remoteFingerprint: etsyDeliveryFingerprint(current), pendingCreateToken: null,
    name: current.title!, currencyCode: 'GBP', originCountryIso: 'GB', originPostalCode: 'IP28JJ',
    destinations: ['GB', 'AU'].map(countryCode => ({ countryCode, primaryCostMinor: countryCode === 'GB' ? 0 : 349,
      secondaryCostMinor: countryCode === 'GB' ? 0 : 349, minDeliveryDays: 2, maxDeliveryDays: 4, carrierId: null, mailClass: null })),
  };
  let latest: EtsyDeliveryCheckpoint | undefined;
  const checkpoint = async (value: EtsyDeliveryCheckpoint) => { latest = value; };
  const result = await syncEtsyDeliveryProfile({ profile, api, checkpoint, forceRemoteOverwrite: true });
  expect(result.shipping_profile_destinations.map(row => row.destination_country_iso)).toEqual(['GB', 'AU']);
  expect(writes.map(row => row.method)).toEqual(['POST']);
  expect(writes[0].body.get('destination_country_iso')).toBe('AU');
  await syncEtsyDeliveryProfile({ profile: { ...profile, ...latest! }, api, checkpoint });
  expect(writes).toHaveLength(1);
});
