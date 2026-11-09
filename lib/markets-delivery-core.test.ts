import { describe, expect, it } from 'vitest';
import { deliveryId, deliverySettingsFingerprint, hasDeliverySettings, positiveRemoteId, validateDeliveryProfileValues, validateDeliverySettings } from '@/lib/markets-delivery-core';
import type { DeliveryProfileValues, DeliverySettingsInput } from '@/lib/markets-delivery-types';

function profile(): DeliveryProfileValues {
  return { name: 'Selected markets', currencyCode: 'GBP', originCountryIso: 'GB', originPostalCode: 'SW1A 1AA', readinessStateId: '111', includeDeliveryInformation: false,
    deliveryInformation: '', destinations: [{ countryCode: 'GB', primaryCostMinor: 0, secondaryCostMinor: 0, minDeliveryDays: 2, maxDeliveryDays: 5, carrierId: null, mailClass: null }] };
}
const inherit: DeliverySettingsInput = { printProfileId: null, customisedProfileId: null, includeDeliveryInformation: null, deliveryInformation: null };

describe('Markets & Delivery validation', () => {
  it('stores only selected individual countries and permits deliberately free delivery', () => {
    const input = profile();
    input.destinations.push({ ...input.destinations[0], countryCode: 'US', primaryCostMinor: 850, secondaryCostMinor: 100 });
    const output = validateDeliveryProfileValues(input, 'GBP');
    expect(output.destinations.map((destination) => destination.countryCode)).toEqual(['GB', 'US']);
    expect(output.destinations[0].primaryCostMinor).toBe(0);
    expect(output.destinations[1].primaryCostMinor).toBe(850);
  });
  it.each(['', '*', 'region:eu', 'region:non_eu', 'ZZ'])('does not enable new broad or invalid coverage %s', (countryCode) => {
    const input = profile(); input.destinations[0].countryCode = countryCode;
    expect(() => validateDeliveryProfileValues(input, 'GBP')).toThrow();
  });
  it('preserves explicit worldwide coverage only when already imported', () => {
    const input = profile(); input.destinations[0].countryCode = '*';
    expect(validateDeliveryProfileValues(input, 'GBP', ['*']).destinations[0].countryCode).toBe('*');
  });
  it('preserves imported region targets explicitly instead of converting them to worldwide', () => {
    const input = profile(); input.destinations[0].countryCode = 'region:eu';
    expect(validateDeliveryProfileValues(input, 'GBP', ['region:eu']).destinations[0].countryCode).toBe('region:eu');
  });
  it('rejects omitted destinations and duplicate country rows', () => {
    const input = profile();
    expect(() => validateDeliveryProfileValues({ ...input, destinations: undefined }, 'GBP')).toThrow();
    expect(() => validateDeliveryProfileValues({ ...input, destinations: [] }, 'GBP')).toThrow();
    input.destinations.push({ ...input.destinations[0] });
    expect(() => validateDeliveryProfileValues(input, 'GBP')).toThrow(/more than once/);
  });
  it.each([-1, 0.5, Number.NaN, Number.POSITIVE_INFINITY, 2147483648, '400'])('rejects unsafe delivery charge %s', (primaryCostMinor) => {
    const input = profile();
    expect(() => validateDeliveryProfileValues({ ...input, destinations: [{ ...input.destinations[0], primaryCostMinor }] }, 'GBP')).toThrow();
  });
  it('rejects a stale currency and requires the actual dispatch postcode', () => {
    expect(() => validateDeliveryProfileValues(profile(), 'USD')).toThrow(/currency/);
    expect(() => validateDeliveryProfileValues({ ...profile(), originPostalCode: '' }, 'GBP')).toThrow(/postal code/);
  });
  it('keeps readiness separate from delivery transit and accepts a carrier service instead of a range', () => {
    const input = profile(); input.destinations[0] = { ...input.destinations[0], minDeliveryDays: null, maxDeliveryDays: null, carrierId: '34', mailClass: 'tracked' };
    const output = validateDeliveryProfileValues(input, 'GBP');
    expect(output.readinessStateId).toBe('111');
    expect(output.destinations[0]).toMatchObject({ minDeliveryDays: null, carrierId: '34', mailClass: 'tracked' });
  });
  it('distinguishes reset-to-template, inherit-profile wording, explicit empty text and disabled wording', () => {
    expect(validateDeliverySettings(null)).toBeNull();
    expect(validateDeliverySettings(inherit)).toEqual(inherit);
    expect(hasDeliverySettings(null)).toBe(false);
    expect(hasDeliverySettings(inherit)).toBe(false);
    const explicit = { ...inherit, includeDeliveryInformation: false, deliveryInformation: '' };
    expect(validateDeliverySettings(explicit)).toEqual(explicit);
    expect(hasDeliverySettings(explicit)).toBe(true);
  });
  it('retains independent physical profile choices', () => {
    expect(validateDeliverySettings({ ...inherit, printProfileId: '12', customisedProfileId: '13' })).toMatchObject({ printProfileId: '12', customisedProfileId: '13' });
    expect(() => validateDeliverySettings({ ...inherit, printProfileId: '../other-shop' })).toThrow();
  });
  it('validates local and remote identifiers without coercing unsafe IDs', () => {
    expect(deliveryId('123')).toBe(123);
    expect(positiveRemoteId('9223372036854775807', 'Etsy profile')).toBe('9223372036854775807');
    expect(positiveRemoteId(null, 'Etsy profile')).toBeNull();
    expect(() => deliveryId('2147483648')).toThrow();
    expect(() => positiveRemoteId('0', 'Etsy profile')).toThrow();
  });
});

describe('physical delivery sync fingerprints', () => {
  const input = { profileId: '12', shippingProfileId: '98', readinessStateId: '111', includeDeliveryInformation: true, deliveryInformation: 'Seller supplied delivery wording', profileRevision: 1 };
  it('is stable for the same effective settings and detects every relevant assignment change', () => {
    const fingerprint = deliverySettingsFingerprint(input);
    expect(deliverySettingsFingerprint({ ...input })).toBe(fingerprint);
    for (const change of [
      { profileId: '13' }, { shippingProfileId: '99' }, { readinessStateId: '112' }, { includeDeliveryInformation: false },
      { deliveryInformation: 'Changed wording' }, { profileRevision: 2 },
    ]) expect(deliverySettingsFingerprint({ ...input, ...change })).not.toBe(fingerprint);
  });
});
