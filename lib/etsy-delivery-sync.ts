import { createHash } from 'node:crypto';
import type { DeliveryProfileValues } from '@/lib/markets-delivery-types';
import {
  buildEtsyDeliveryDestinationBody, createEtsyDeliveryApi, deliveryCurrencyDivisor, EtsyDeliveryError,
  etsyDeliveryDestinationCountry, validateEtsyDeliveryOrigin,
  type EtsyDeliveryApi, type EtsyDeliveryDestination, type EtsyDeliveryDestinationValues, type EtsyDeliveryProfile,
} from '@/lib/etsy-delivery-api';

export type EtsyDeliverySyncProfile = Pick<DeliveryProfileValues,
  'name' | 'currencyCode' | 'originCountryIso' | 'originPostalCode' | 'destinations'> & {
  id?: string;
  shopId: string;
  etsyShippingProfileId: string | null;
  remoteFingerprint: string | null;
  pendingCreateToken: string | null;
};
export type EtsyDeliveryCheckpoint = {
  etsyShippingProfileId: string | null;
  remoteFingerprint: string | null;
  remoteSnapshot: EtsyDeliveryProfile | null;
  pendingCreateToken: string | null;
};
type PendingCreate = {
  version: 1;
  kind: 'profile' | 'destination';
  shopId: string;
  beforeIds: string[];
  desiredFingerprint: string;
  countryCode: string;
  attemptedAt: string;
};

function stable(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stable).join(',')}]`;
  if (value && typeof value === 'object') return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stable((value as Record<string, unknown>)[key])}`).join(',')}}`;
  return JSON.stringify(value) ?? 'null';
}
function hash(value: unknown) { return createHash('sha256').update(stable(value)).digest('hex'); }

function canonicalDestination(destination: EtsyDeliveryDestination) {
  return {
    id: String(destination.shipping_profile_destination_id), country: etsyDeliveryDestinationCountry(destination),
    primary: destination.primary_cost, secondary: destination.secondary_cost,
    carrier: destination.shipping_carrier_id == null ? '0' : String(destination.shipping_carrier_id),
    mailClass: destination.mail_class || null, minDays: destination.min_delivery_days ?? null, maxDays: destination.max_delivery_days ?? null,
  };
}
export function etsyDeliveryFingerprint(profile: EtsyDeliveryProfile) {
  return hash({
    id: String(profile.shipping_profile_id), title: profile.title ?? '', origin: profile.origin_country_iso,
    postcode: profile.origin_postal_code ?? '', type: profile.profile_type ?? 'manual', deleted: Boolean(profile.is_deleted),
    destinations: (profile.shipping_profile_destinations ?? []).map(canonicalDestination).sort((a, b) => a.id.localeCompare(b.id)),
    upgrades: profile.shipping_profile_upgrades ?? [],
    domesticHandlingFee: profile.domestic_handling_fee ?? 0, internationalHandlingFee: profile.international_handling_fee ?? 0,
  });
}

/** A destination may be replaced by Etsy; only its ID may change without changing the reviewed delivery settings. */
function sameDeliveryContents(left: EtsyDeliveryProfile, right: EtsyDeliveryProfile) {
  const withoutDestinationIds = (profile: EtsyDeliveryProfile) => ({ ...profile,
    shipping_profile_destinations: profile.shipping_profile_destinations.map(destination => ({ ...destination,
      shipping_profile_destination_id: etsyDeliveryDestinationCountry(destination),
    })),
  });
  return etsyDeliveryFingerprint(withoutDestinationIds(left)) === etsyDeliveryFingerprint(withoutDestinationIds(right));
}

export async function getEtsyDeliveryProfile(api: EtsyDeliveryApi, shopId: string, profileId: string) {
  const profile = await api.getProfile(shopId, profileId);
  if (String(profile.shipping_profile_id) !== profileId || profile.is_deleted) {
    throw new EtsyDeliveryError('The Etsy delivery profile was removed or does not match this shop. Import a replacement before syncing.', 'conflict');
  }
  // The profile response contains its current complete destination list. Etsy's
  // separate list endpoint can still return deleted rows; never resurrect those
  // rows by replacing the profile's authoritative embedded destinations.
  if (Array.isArray(profile.shipping_profile_destinations)) return profile;
  if (profile.shipping_profile_destinations !== undefined) throw new EtsyDeliveryError('Etsy returned an invalid delivery destination list.', 'api');
  return { ...profile, shipping_profile_destinations: await api.listDestinations(shopId, profileId) };
}

function moneyToMinor(money: EtsyDeliveryDestination['primary_cost'], currencyCode: string) {
  if (!money || !Number.isSafeInteger(money.amount) || !Number.isFinite(money.divisor) || money.divisor <= 0
    || money.currency_code !== currencyCode) throw new EtsyDeliveryError('Etsy returned an invalid or mismatched delivery currency. Refresh the shop currency before importing.', 'validation');
  const amount = money.amount * deliveryCurrencyDivisor(currencyCode) / money.divisor;
  if (!Number.isSafeInteger(amount) || amount < 0) throw new EtsyDeliveryError('Etsy delivery charges cannot be represented safely in the shop currency.', 'validation');
  return amount;
}

export function importEtsyDeliveryProfile(profile: EtsyDeliveryProfile, currencyCode: string): DeliveryProfileValues {
  return {
    name: profile.title ?? `Etsy profile ${profile.shipping_profile_id}`, currencyCode,
    originCountryIso: profile.origin_country_iso, originPostalCode: profile.origin_postal_code ?? '',
    readinessStateId: null, includeDeliveryInformation: false, deliveryInformation: '',
    destinations: profile.shipping_profile_destinations.map((destination) => ({
      countryCode: etsyDeliveryDestinationCountry(destination), primaryCostMinor: moneyToMinor(destination.primary_cost, currencyCode),
      secondaryCostMinor: moneyToMinor(destination.secondary_cost, currencyCode),
      minDeliveryDays: destination.min_delivery_days ?? null, maxDeliveryDays: destination.max_delivery_days ?? null,
      carrierId: destination.mail_class && destination.shipping_carrier_id != null ? String(destination.shipping_carrier_id) : null,
      mailClass: destination.mail_class || null,
    })),
  };
}

function desiredDestinationFingerprint(values: EtsyDeliveryDestinationValues, currencyCode: string) {
  const body = buildEtsyDeliveryDestinationBody(values, currencyCode, values.countryCode === '*' || values.countryCode.startsWith('region:'));
  // An existing worldwide row is identified explicitly, even though PUT preserves its target by omission.
  return hash({ target: values.countryCode, body: Object.fromEntries(body) });
}
function destinationMatches(remote: EtsyDeliveryDestination, local: EtsyDeliveryDestinationValues, currencyCode: string) {
  if (etsyDeliveryDestinationCountry(remote) !== local.countryCode) return false;
  try {
    const imported = importEtsyDeliveryProfile({ shipping_profile_id: '1', title: '', origin_country_iso: '', shipping_profile_destinations: [remote] }, currencyCode).destinations[0];
    if (imported.primaryCostMinor !== local.primaryCostMinor || imported.secondaryCostMinor !== local.secondaryCostMinor) return false;
    return local.carrierId !== null || local.mailClass
      ? imported.carrierId === local.carrierId && imported.mailClass === local.mailClass
      : imported.minDeliveryDays === local.minDeliveryDays && imported.maxDeliveryDays === local.maxDeliveryDays && !imported.mailClass;
  } catch { return false; }
}
function profileMatchesCreated(remote: EtsyDeliveryProfile, local: EtsyDeliverySyncProfile) {
  return remote.title === local.name.trim() && remote.origin_country_iso === local.originCountryIso
    && (remote.origin_postal_code ?? '') === local.originPostalCode.trim()
    && remote.shipping_profile_destinations.length === 1
    && destinationMatches(remote.shipping_profile_destinations[0], local.destinations[0], local.currencyCode);
}
function parsePending(token: string): PendingCreate {
  try {
    const parsed = JSON.parse(token) as PendingCreate;
    if (parsed.version !== 1 || !['profile', 'destination'].includes(parsed.kind) || !Array.isArray(parsed.beforeIds)
      || !parsed.shopId || !parsed.desiredFingerprint) throw new Error('invalid');
    return parsed;
  } catch {
    throw new EtsyDeliveryError('The saved Etsy creation attempt needs manual reconciliation. Import the remote profile before creating another.', 'ambiguous_create', null, null, true);
  }
}
function isAmbiguous(error: unknown) { return !(error instanceof EtsyDeliveryError) || error.ambiguous; }

/** Pure orchestration: callers enforce shop access, revision locking and persist every checkpoint durably. */
export async function syncEtsyDeliveryProfile(options: {
  profile: EtsyDeliverySyncProfile;
  api?: EtsyDeliveryApi;
  forceRemoteOverwrite?: boolean;
  checkpoint: (progress: EtsyDeliveryCheckpoint) => Promise<void>;
}): Promise<EtsyDeliveryProfile> {
  const { profile: local } = options;
  const api = options.api ?? createEtsyDeliveryApi();
  validateEtsyDeliveryOrigin(local);
  if (!local.destinations.length) throw new EtsyDeliveryError('Select at least one delivery destination before syncing.', 'validation');
  const countries = new Set<string>();
  for (const destination of local.destinations) {
    if (countries.has(destination.countryCode)) throw new EtsyDeliveryError(`Destination ${destination.countryCode} is selected more than once.`, 'validation');
    countries.add(destination.countryCode);
    buildEtsyDeliveryDestinationBody(destination, local.currencyCode, Boolean(local.etsyShippingProfileId) && (destination.countryCode === '*' || destination.countryCode.startsWith('region:')));
  }
  const remoteCurrency = await api.getShopCurrency(local.shopId);
  if (remoteCurrency !== local.currencyCode) throw new EtsyDeliveryError(`This Etsy shop uses ${remoteCurrency}. Refresh the profile currency before syncing its delivery charges.`, 'validation');
  let remote: EtsyDeliveryProfile | null = null;
  let pendingToken = local.pendingCreateToken;
  let expectedFingerprint = local.remoteFingerprint;
  let profileId = local.etsyShippingProfileId;
  const desiredCreateFingerprint = hash({ name: local.name.trim(), origin: local.originCountryIso, postcode: local.originPostalCode.trim(),
    first: desiredDestinationFingerprint(local.destinations[0], local.currencyCode) });
  async function checkpoint() {
    const fingerprint = remote ? etsyDeliveryFingerprint(remote) : null;
    await options.checkpoint({ etsyShippingProfileId: profileId, remoteFingerprint: fingerprint, remoteSnapshot: remote, pendingCreateToken: pendingToken });
    expectedFingerprint = fingerprint;
  }
  async function reconcileProfile(pending: PendingCreate) {
    if (pending.shopId !== local.shopId || pending.desiredFingerprint !== desiredCreateFingerprint) {
      throw new EtsyDeliveryError('A previous Etsy create request is unresolved. Restore those values and reconcile or import its remote result first.', 'ambiguous_create', null, null, true);
    }
    const candidates = (await api.listProfiles(local.shopId)).filter((row) => !pending.beforeIds.includes(String(row.shipping_profile_id)));
    const matches: EtsyDeliveryProfile[] = [];
    for (const candidate of candidates) {
      const full = await getEtsyDeliveryProfile(api, local.shopId, String(candidate.shipping_profile_id));
      if (profileMatchesCreated(full, local)) matches.push(full);
    }
    if (matches.length !== 1) throw new EtsyDeliveryError(`Etsy profile creation is still unconfirmed (${matches.length} matching new profiles). Refresh/import Etsy profiles before creating again. No second create request was sent.`, 'ambiguous_create', null, null, true);
    remote = matches[0]; profileId = String(remote.shipping_profile_id); pendingToken = null;
    await checkpoint();
  }
  function needsReadback(error: unknown) {
    return !(error instanceof EtsyDeliveryError) || error.code === 'network' || error.code === 'api';
  }
  const changedDuringSync = () => new EtsyDeliveryError('Etsy delivery destinations changed during sync. Saved local edits remain pending. Review the latest profile before retrying.', 'conflict');
  function replaceDestination(before: EtsyDeliveryProfile, sourceId: string, updated: EtsyDeliveryDestination) {
    return { ...before, shipping_profile_destinations: before.shipping_profile_destinations.map(row => String(row.shipping_profile_destination_id) === sourceId ? updated : row) };
  }
  function uniqueDestination(profile: EtsyDeliveryProfile, country: string) {
    const matches = profile.shipping_profile_destinations.filter(row => etsyDeliveryDestinationCountry(row) === country);
    if (matches.length !== 1) throw changedDuringSync();
    return matches[0];
  }
  async function updateDestination(destinationId: string, desired: EtsyDeliveryDestinationValues, existingCoverage = false) {
    const before = remote!;
    const source = before.shipping_profile_destinations.find(row => String(row.shipping_profile_destination_id) === destinationId);
    if (!source) throw changedDuringSync();
    const acceptUpdated = (baseline: EtsyDeliveryProfile, sourceId: string, updated: EtsyDeliveryDestination) => {
      if (!destinationMatches(updated, desired, local.currencyCode)) {
        throw new EtsyDeliveryError('Etsy did not confirm the requested destination settings. No further delivery markets were added; review the profile in Etsy before retrying.', 'conflict');
      }
      remote = replaceDestination(baseline, sourceId, updated);
      return updated;
    };
    try {
      const updated = await api.updateDestination(local.shopId, profileId!, destinationId, desired, local.currencyCode, existingCoverage);
      return acceptUpdated(before, destinationId, updated);
    } catch (error) {
      if (!needsReadback(error)) throw error;
      const actual = await getEtsyDeliveryProfile(api, local.shopId, profileId!);
      const applied = actual.shipping_profile_destinations.filter(row => destinationMatches(row, desired, local.currencyCode));
      if (applied.length === 1 && sameDeliveryContents(actual, replaceDestination(before, destinationId, applied[0]))) {
        remote = actual;
        return applied[0];
      }
      if (!sameDeliveryContents(actual, before)) throw changedDuringSync();
      if (error instanceof EtsyDeliveryError && error.status === 404) {
        const replacement = uniqueDestination(actual, etsyDeliveryDestinationCountry(source));
        remote = actual;
        await checkpoint();
        try {
          return acceptUpdated(actual, String(replacement.shipping_profile_destination_id), await api.updateDestination(
            local.shopId, profileId!, String(replacement.shipping_profile_destination_id), desired, local.currencyCode, existingCoverage,
          ));
        } catch (retryError) {
          if (retryError instanceof EtsyDeliveryError && retryError.status === 404) throw changedDuringSync();
          throw retryError;
        }
      }
      throw error;
    }
  }

  async function deleteDestination(source: EtsyDeliveryDestination) {
    const before = remote!;
    const sourceId = String(source.shipping_profile_destination_id);
    const afterRemoval = (profile: EtsyDeliveryProfile, id: string) => ({ ...profile,
      shipping_profile_destinations: profile.shipping_profile_destinations.filter(row => String(row.shipping_profile_destination_id) !== id),
    });
    try {
      await api.deleteDestination(local.shopId, profileId!, sourceId);
      remote = afterRemoval(before, sourceId);
    } catch (error) {
      if (!needsReadback(error)) throw error;
      const actual = await getEtsyDeliveryProfile(api, local.shopId, profileId!);
      if (sameDeliveryContents(actual, afterRemoval(before, sourceId))) { remote = actual; return; }
      if (!sameDeliveryContents(actual, before)) throw changedDuringSync();
      if (error instanceof EtsyDeliveryError && error.status === 404) {
        const replacement = uniqueDestination(actual, etsyDeliveryDestinationCountry(source));
        const replacementId = String(replacement.shipping_profile_destination_id);
        remote = actual;
        await checkpoint();
        try {
          await api.deleteDestination(local.shopId, profileId!, replacementId);
          remote = afterRemoval(actual, replacementId);
          return;
        } catch (retryError) {
          if (!needsReadback(retryError)) throw retryError;
          const confirmed = await getEtsyDeliveryProfile(api, local.shopId, profileId!);
          if (sameDeliveryContents(confirmed, afterRemoval(actual, replacementId))) { remote = confirmed; return; }
          throw changedDuringSync();
        }
      }
      throw error;
    }
  }

  if (!profileId && pendingToken) {
    const pending = parsePending(pendingToken);
    if (pending.kind !== 'profile') throw new EtsyDeliveryError('The previous Etsy operation must be reconciled before creating a profile.', 'ambiguous_create', null, null, true);
    await reconcileProfile(pending);
  }
  if (!profileId) {
    const before = await api.listProfiles(local.shopId);
    const pending: PendingCreate = { version: 1, kind: 'profile', shopId: local.shopId, beforeIds: before.map((row) => String(row.shipping_profile_id)),
      desiredFingerprint: desiredCreateFingerprint, countryCode: local.destinations[0].countryCode, attemptedAt: new Date().toISOString() };
    pendingToken = JSON.stringify(pending);
    await checkpoint();
    try {
      remote = await api.createProfile(local.shopId, local, local.destinations[0]);
      profileId = String(remote.shipping_profile_id);
      // Persist the returned ID before a follow-up GET can fail.
      pendingToken = null;
      await checkpoint();
    } catch (error) {
      if (profileId) throw error;
      if (!isAmbiguous(error)) { pendingToken = null; await checkpoint(); throw error; }
      await reconcileProfile(pending);
    }
  }
  if (!profileId) throw new EtsyDeliveryError('Etsy did not return a delivery profile identifier.', 'ambiguous_create', null, null, true);
  const current = await getEtsyDeliveryProfile(api, local.shopId, profileId);
  if (current.profile_type === 'calculated') throw new EtsyDeliveryError('Calculated Etsy profiles can be assigned to listings, but their rates must be edited in Etsy Shop Manager.', 'validation');
  if (!expectedFingerprint && !remote && !pendingToken && !options.forceRemoteOverwrite) {
    throw new EtsyDeliveryError('Import this Etsy delivery profile before editing it so remote changes can be checked safely.', 'conflict');
  }
  if (expectedFingerprint && etsyDeliveryFingerprint(current) !== expectedFingerprint && !options.forceRemoteOverwrite && !pendingToken) {
    throw new EtsyDeliveryError('This delivery profile changed directly in Etsy. Import its latest values or explicitly choose to overwrite those remote changes.', 'conflict');
  }
  remote = current;
  if (pendingToken) {
    const pending = parsePending(pendingToken);
    const desired = local.destinations.find((row) => row.countryCode === pending.countryCode);
    if (pending.kind !== 'destination' || pending.shopId !== local.shopId || !desired
      || pending.desiredFingerprint !== desiredDestinationFingerprint(desired, local.currencyCode)) {
      throw new EtsyDeliveryError('A previous destination create is unresolved. Restore those destination values and reconcile or import its result first.', 'ambiguous_create', null, null, true);
    }
    const matches = remote.shipping_profile_destinations.filter((row) => !pending.beforeIds.includes(String(row.shipping_profile_destination_id)) && destinationMatches(row, desired, local.currencyCode));
    if (matches.length !== 1) throw new EtsyDeliveryError('Etsy destination creation is still unconfirmed. Refresh/import before creating again. No second request was sent.', 'ambiguous_create', null, null, true);
    const withoutCreation = { ...remote, shipping_profile_destinations: remote.shipping_profile_destinations.filter((row) => String(row.shipping_profile_destination_id) !== String(matches[0].shipping_profile_destination_id)) };
    if (expectedFingerprint && etsyDeliveryFingerprint(withoutCreation) !== expectedFingerprint && !options.forceRemoteOverwrite) {
      throw new EtsyDeliveryError('Etsy delivery settings changed while a destination create was unresolved. Import its latest values before retrying.', 'conflict');
    }
    pendingToken = null;
    await checkpoint();
  }
  for (const destination of local.destinations.filter((row) => row.countryCode === '*' || row.countryCode.startsWith('region:'))) {
    if (!remote.shipping_profile_destinations.some((row) => etsyDeliveryDestinationCountry(row) === destination.countryCode)) {
      throw new EtsyDeliveryError('Worldwide and regional coverage can only be preserved from an imported profile. Select individual countries for new coverage.', 'validation');
    }
  }
  // Remove disallowed markets before creating any new coverage. Etsy forbids deleting a profile's final destination.
  for (;;) {
    const obsolete = remote.shipping_profile_destinations.find(row => !countries.has(etsyDeliveryDestinationCountry(row)));
    if (!obsolete) break;
    if (remote.shipping_profile_destinations.length === 1) {
      const desired = local.destinations[0];
      await updateDestination(String(obsolete.shipping_profile_destination_id), desired);
    } else {
      await deleteDestination(obsolete);
    }
    await checkpoint();
  }
  if (remote.title !== local.name.trim() || remote.origin_country_iso !== local.originCountryIso || (remote.origin_postal_code ?? '') !== local.originPostalCode.trim()) {
    const expected = { ...remote, title: local.name.trim(), origin_country_iso: local.originCountryIso, origin_postal_code: local.originPostalCode.trim() };
    let mutationError: unknown;
    try {
      const updated = await api.updateProfile(local.shopId, profileId, local);
      if (String(updated.shipping_profile_id) !== profileId || updated.is_deleted) throw changedDuringSync();
    } catch (error) {
      if (!needsReadback(error)) throw error;
      mutationError = error;
    }
    const actual = await getEtsyDeliveryProfile(api, local.shopId, profileId);
    if (!sameDeliveryContents(actual, expected)) {
      if (mutationError && sameDeliveryContents(actual, remote)) throw mutationError;
      throw changedDuringSync();
    }
    remote = actual;
    await checkpoint();
  }
  for (const desired of local.destinations) {
    const existing: EtsyDeliveryDestination | undefined = remote.shipping_profile_destinations.find((row) => etsyDeliveryDestinationCountry(row) === desired.countryCode);
    if (existing) {
      if (destinationMatches(existing, desired, local.currencyCode)) continue;
      await updateDestination(String(existing.shipping_profile_destination_id), desired, desired.countryCode === '*' || desired.countryCode.startsWith('region:'));
      await checkpoint();
    } else {
      const pending: PendingCreate = { version: 1, kind: 'destination', shopId: local.shopId,
        beforeIds: remote.shipping_profile_destinations.map((row) => String(row.shipping_profile_destination_id)),
        desiredFingerprint: desiredDestinationFingerprint(desired, local.currencyCode), countryCode: desired.countryCode, attemptedAt: new Date().toISOString() };
      pendingToken = JSON.stringify(pending);
      await checkpoint();
      let created: EtsyDeliveryDestination;
      try {
        created = await api.createDestination(local.shopId, profileId, desired, local.currencyCode);
      } catch (error) {
        if (!isAmbiguous(error)) { pendingToken = null; await checkpoint(); throw error; }
        const actual = await getEtsyDeliveryProfile(api, local.shopId, profileId);
        const matches = actual.shipping_profile_destinations.filter((row) => !pending.beforeIds.includes(String(row.shipping_profile_destination_id)) && destinationMatches(row, desired, local.currencyCode));
        if (matches.length !== 1) throw new EtsyDeliveryError('Etsy destination creation is unconfirmed. Refresh/import before creating again. No second request was sent.', 'ambiguous_create', null, null, true);
        created = matches[0];
      }
      remote = { ...remote, shipping_profile_destinations: [...remote.shipping_profile_destinations, created] };
      pendingToken = null;
      await checkpoint();
    }
  }
  // A final read catches changes made concurrently while the sync was running.
  const final = await getEtsyDeliveryProfile(api, local.shopId, profileId);
  if (!sameDeliveryContents(final, remote)) throw new EtsyDeliveryError('Etsy delivery settings changed during sync. Refresh/import the remote profile before retrying.', 'conflict');
  remote = final;
  await checkpoint();
  return remote;
}
