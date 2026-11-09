import { createHash } from 'node:crypto';
import { ISO_COUNTRY_CODES } from '@/lib/iso-country-codes';
import { buildEtsyDeliveryDestinationBody, validateEtsyDeliveryOrigin } from '@/lib/etsy-delivery-api';
import type { DeliveryProfileValues, DeliverySettingsInput, DeliveryDestinationInput, EffectiveListingDelivery } from '@/lib/markets-delivery-types';

export class MarketsDeliveryError extends Error {
  constructor(message: string, public readonly status = 400) { super(message); this.name = 'MarketsDeliveryError'; }
}

export function deliveryId(value: unknown, label = 'ID') {
  const parsed = typeof value === 'string' && /^\d+$/.test(value) ? Number(value) : typeof value === 'number' ? value : NaN;
  if (!Number.isSafeInteger(parsed) || parsed < 1 || parsed > 2147483647) throw new MarketsDeliveryError(`Choose a valid ${label}.`);
  return parsed;
}

export function positiveRemoteId(value: unknown, label: string): string | null {
  if (value === null || value === undefined || value === '') return null;
  if (typeof value !== 'string' || !/^\d{1,20}$/.test(value) || BigInt(value) < 1n) throw new MarketsDeliveryError(`Choose a valid ${label}.`);
  return value;
}

function record(value: unknown) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new MarketsDeliveryError('Enter valid delivery settings.');
  return value as Record<string, unknown>;
}

export function validateDeliveryProfileValues(value: unknown, currencyCode: string, allowedSpecialCountries: string[] = []): DeliveryProfileValues {
  const input = record(value);
  const name = typeof input.name === 'string' ? input.name.trim() : '';
  if (!name || name.length > 100) throw new MarketsDeliveryError('Enter a profile name between 1 and 100 characters.');
  if (input.currencyCode !== currencyCode) throw new MarketsDeliveryError('Delivery charges must use this shop’s currency. Reload the shop before saving.');
  const originCountryIso = typeof input.originCountryIso === 'string' ? input.originCountryIso.toUpperCase() : '';
  if (!ISO_COUNTRY_CODES.includes(originCountryIso)) throw new MarketsDeliveryError('Choose a valid dispatch origin country.');
  const originPostalCode = typeof input.originPostalCode === 'string' ? input.originPostalCode.trim() : '';
  if (originPostalCode.length > 32) throw new MarketsDeliveryError('The dispatch origin postal code is too long.');
  validateEtsyDeliveryOrigin({ name, originCountryIso, originPostalCode });
  if (typeof input.includeDeliveryInformation !== 'boolean') throw new MarketsDeliveryError('Choose whether delivery wording is included.');
  if (typeof input.deliveryInformation !== 'string' || input.deliveryInformation.length > 10000) throw new MarketsDeliveryError('Delivery wording must be text of 10,000 characters or fewer.');
  if (!Array.isArray(input.destinations) || input.destinations.length === 0 || input.destinations.length > ISO_COUNTRY_CODES.length + 3) {
    throw new MarketsDeliveryError('Select at least one explicit delivery destination.');
  }
  const seen = new Set<string>();
  const destinations = input.destinations.map((raw): DeliveryDestinationInput => {
    const destination = record(raw);
    const countryCode = typeof destination.countryCode === 'string' ? destination.countryCode : '';
    if (!ISO_COUNTRY_CODES.includes(countryCode) && !allowedSpecialCountries.includes(countryCode)) {
      throw new MarketsDeliveryError('Select individual destination countries. Worldwide or regional coverage may only be preserved from an imported profile.');
    }
    if (seen.has(countryCode)) throw new MarketsDeliveryError(`The destination ${countryCode} appears more than once.`);
    seen.add(countryCode);
    for (const key of ['primaryCostMinor', 'secondaryCostMinor'] as const) {
      if (!Number.isSafeInteger(destination[key]) || Number(destination[key]) < 0 || Number(destination[key]) > 2147483647) {
        throw new MarketsDeliveryError('Delivery charges must be non-negative whole minor currency units. Enter zero deliberately for free delivery.');
      }
    }
    const parsed: DeliveryDestinationInput = {
      countryCode, primaryCostMinor: Number(destination.primaryCostMinor), secondaryCostMinor: Number(destination.secondaryCostMinor),
      minDeliveryDays: destination.minDeliveryDays === null ? null : Number(destination.minDeliveryDays),
      maxDeliveryDays: destination.maxDeliveryDays === null ? null : Number(destination.maxDeliveryDays),
      carrierId: positiveRemoteId(destination.carrierId, 'shipping carrier'),
      mailClass: typeof destination.mailClass === 'string' && destination.mailClass.trim() ? destination.mailClass.trim() : null,
    };
    if (parsed.mailClass && parsed.mailClass.length > 100) throw new MarketsDeliveryError('Choose a valid delivery mail class.');
    buildEtsyDeliveryDestinationBody(parsed, currencyCode, countryCode === '*' || countryCode.startsWith('region:'));
    return parsed;
  });
  return {
    name, currencyCode, originCountryIso, originPostalCode,
    readinessStateId: positiveRemoteId(input.readinessStateId, 'processing profile'),
    includeDeliveryInformation: input.includeDeliveryInformation,
    deliveryInformation: input.deliveryInformation.trim(), destinations,
  };
}

export function validateDeliverySettings(value: unknown): DeliverySettingsInput | null {
  if (value === null) return null;
  const input = record(value);
  const profileId = (raw: unknown) => raw === null ? null : String(deliveryId(raw, 'delivery profile'));
  if (input.includeDeliveryInformation !== null && typeof input.includeDeliveryInformation !== 'boolean') throw new MarketsDeliveryError('Choose whether to include delivery wording or use the profile default.');
  if (input.deliveryInformation !== null && (typeof input.deliveryInformation !== 'string' || input.deliveryInformation.length > 10000)) throw new MarketsDeliveryError('Delivery wording must be text of 10,000 characters or fewer.');
  return {
    printProfileId: profileId(input.printProfileId), customisedProfileId: profileId(input.customisedProfileId),
    includeDeliveryInformation: input.includeDeliveryInformation as boolean | null,
    deliveryInformation: input.deliveryInformation === null ? null : String(input.deliveryInformation).trim(),
  };
}

export function deliverySettingsFingerprint(value: Pick<EffectiveListingDelivery, 'profileId' | 'shippingProfileId' | 'readinessStateId' | 'includeDeliveryInformation' | 'deliveryInformation' | 'profileRevision'>) {
  return createHash('sha256').update(JSON.stringify({
    profileId: value.profileId, shippingProfileId: value.shippingProfileId, readinessStateId: value.readinessStateId,
    includeDeliveryInformation: value.includeDeliveryInformation, deliveryInformation: value.deliveryInformation,
    profileRevision: value.profileRevision,
  })).digest('hex');
}

export function hasDeliverySettings(settings: DeliverySettingsInput | null) {
  return settings !== null && (settings.printProfileId !== null || settings.customisedProfileId !== null
    || settings.includeDeliveryInformation !== null || settings.deliveryInformation !== null);
}
