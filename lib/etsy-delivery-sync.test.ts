import { describe, expect, it, vi } from 'vitest';
import { EtsyDeliveryError, type EtsyDeliveryApi, type EtsyDeliveryDestination, type EtsyDeliveryDestinationValues, type EtsyDeliveryProfile } from '@/lib/etsy-delivery-api';
import { etsyDeliveryFingerprint, getEtsyDeliveryProfile, importEtsyDeliveryProfile, syncEtsyDeliveryProfile, type EtsyDeliveryCheckpoint, type EtsyDeliverySyncProfile } from '@/lib/etsy-delivery-sync';

const target = (countryCode: string): EtsyDeliveryDestinationValues => ({ countryCode, primaryCostMinor: 400, secondaryCostMinor: 100, minDeliveryDays: 2, maxDeliveryDays: 5, carrierId: null, mailClass: null });
const remoteDestination = (countryCode: string, id: string): EtsyDeliveryDestination => ({ shipping_profile_destination_id: id,
  destination_country_iso: countryCode === '*' || countryCode.startsWith('region:') ? null : countryCode, destination_region: countryCode.startsWith('region:') ? countryCode.slice(7) : 'none', primary_cost: { amount: 400, divisor: 100, currency_code: 'GBP' },
  secondary_cost: { amount: 100, divisor: 100, currency_code: 'GBP' }, min_delivery_days: 2, max_delivery_days: 5, shipping_carrier_id: 0, mail_class: null });
const remoteProfile = (countries = ['GB', 'US']): EtsyDeliveryProfile => ({ shipping_profile_id: '20', title: 'Print delivery', origin_country_iso: 'GB', origin_postal_code: 'SW1A 1AA', profile_type: 'manual',
  shipping_profile_destinations: countries.map((country, i) => remoteDestination(country, String(i + 1))) });
const localProfile = (remote: EtsyDeliveryProfile | null, countries = ['GB', 'US']): EtsyDeliverySyncProfile => ({ shopId: '1', name: 'Print delivery', currencyCode: 'GBP', originCountryIso: 'GB', originPostalCode: 'SW1A 1AA',
  destinations: countries.map(target), etsyShippingProfileId: remote ? String(remote.shipping_profile_id) : null, remoteFingerprint: remote ? etsyDeliveryFingerprint(remote) : null, pendingCreateToken: null });
const copy = <T,>(value: T): T => JSON.parse(JSON.stringify(value));
function mockedEtsy(initial: EtsyDeliveryProfile | null) {
  let remote = copy(initial);
  const calls: string[] = [];
  let nextId = 30;
  const api: EtsyDeliveryApi = {
    getShopCurrency: vi.fn(async () => 'GBP'),
    listProfiles: vi.fn(async () => remote ? [copy(remote)] : []),
    getProfile: vi.fn(async () => { if (!remote) throw new Error('missing'); return copy(remote); }),
    listDestinations: vi.fn(async () => copy(remote?.shipping_profile_destinations ?? [])),
    createProfile: vi.fn(async (_shop, values, first) => {
      calls.push('create-profile'); remote = { ...remoteProfile([]), title: values.name, shipping_profile_destinations: [remoteDestination(first.countryCode, '1')] }; return copy(remote);
    }),
    updateProfile: vi.fn(async (_shop, _id, values) => { calls.push('update-profile'); remote = { ...remote!, title: values.name, origin_country_iso: values.originCountryIso, origin_postal_code: values.originPostalCode }; return copy(remote); }),
    createDestination: vi.fn(async (_shop, _id, values) => { calls.push(`add:${values.countryCode}`); const created = remoteDestination(values.countryCode, String(nextId++)); remote!.shipping_profile_destinations.push(created); return copy(created); }),
    updateDestination: vi.fn(async (_shop, _id, destinationId, values) => { calls.push(`update:${destinationId}:${values.countryCode}`); const updated = { ...remoteDestination(values.countryCode, destinationId),
      primary_cost: { amount: values.primaryCostMinor, divisor: 100, currency_code: 'GBP' }, secondary_cost: { amount: values.secondaryCostMinor, divisor: 100, currency_code: 'GBP' } };
      remote!.shipping_profile_destinations = remote!.shipping_profile_destinations.map((row) => String(row.shipping_profile_destination_id) === destinationId ? updated : row); return copy(updated); }),
    deleteDestination: vi.fn(async (_shop, _id, destinationId) => { calls.push(`delete:${destinationId}`); if (remote!.shipping_profile_destinations.length === 1) throw new Error('cannot delete final destination'); remote!.shipping_profile_destinations = remote!.shipping_profile_destinations.filter((row) => String(row.shipping_profile_destination_id) !== destinationId); }),
    listCarriers: vi.fn(async () => []), listReadiness: vi.fn(async () => []),
  };
  return { api, calls, getRemote: () => remote!, setRemote: (value: EtsyDeliveryProfile) => { remote = copy(value); } };
}
function progressCapture() {
  const checkpoints: EtsyDeliveryCheckpoint[] = [];
  return { checkpoints, checkpoint: async (progress: EtsyDeliveryCheckpoint) => { checkpoints.push(copy(progress)); } };
}

describe('Etsy delivery sync orchestration', () => {
  it('uses the current embedded destinations without resurrecting deleted rows from the list endpoint', async () => {
    const initial = remoteProfile(['GB']); const etsy = mockedEtsy(initial);
    vi.mocked(etsy.api.listDestinations).mockResolvedValue([remoteDestination('*', '64097858396'), ...initial.shipping_profile_destinations]);
    const result = await syncEtsyDeliveryProfile({ profile: localProfile(initial, ['GB', 'AU']), api: etsy.api, checkpoint: async () => {} });
    expect(result.shipping_profile_destinations.map(row => row.destination_country_iso)).toEqual(['GB', 'AU']);
    expect(etsy.api.listDestinations).not.toHaveBeenCalled();
    expect(etsy.api.deleteDestination).not.toHaveBeenCalled();
    expect(etsy.api.createDestination).toHaveBeenCalledTimes(1);
  });
  it('falls back to the paginated destination endpoint only if the profile omits destinations', async () => {
    const initial = remoteProfile(['GB']); const etsy = mockedEtsy(initial);
    vi.mocked(etsy.api.getProfile).mockResolvedValueOnce({ ...initial, shipping_profile_destinations: undefined } as unknown as EtsyDeliveryProfile);
    expect((await getEtsyDeliveryProfile(etsy.api, '1', '20')).shipping_profile_destinations).toEqual(initial.shipping_profile_destinations);
    expect(etsy.api.listDestinations).toHaveBeenCalledOnce();
  });
  it('refreshes all destination IDs after editing the profile before updating its rates', async () => {
    const initial = remoteProfile(); const etsy = mockedEtsy(initial);
    const local = { ...localProfile(initial), name: 'Renamed delivery' };
    local.destinations = local.destinations.map(row => ({ ...row, primaryCostMinor: 550 }));
    vi.mocked(etsy.api.updateProfile).mockImplementationOnce(async (_shop, _id, values) => {
      const actual = etsy.getRemote(); actual.title = values.name;
      actual.shipping_profile_destinations = actual.shipping_profile_destinations.map((row, index) => ({ ...row, shipping_profile_destination_id: String(101 + index) }));
      etsy.setRemote(actual); return copy(actual);
    });
    const result = await syncEtsyDeliveryProfile({ profile: local, api: etsy.api, checkpoint: async () => {} });
    expect(vi.mocked(etsy.api.updateDestination).mock.calls.map(call => call[2])).toEqual(['101', '102']);
    expect(result.shipping_profile_destinations.every(row => row.primary_cost.amount === 550)).toBe(true);
  });
  it('rebinds a replaced destination by country after a 404 and retries the update once', async () => {
    const initial = remoteProfile(); const etsy = mockedEtsy(initial); const local = localProfile(initial); const progress = progressCapture();
    local.destinations[0].primaryCostMinor = 550;
    vi.mocked(etsy.api.updateDestination).mockImplementationOnce(async () => {
      const actual = etsy.getRemote(); actual.shipping_profile_destinations = actual.shipping_profile_destinations.map((row, index) => ({ ...row, shipping_profile_destination_id: String(101 + index) }));
      etsy.setRemote(actual); throw new EtsyDeliveryError('Destination missing', 'api', 404);
    });
    const result = await syncEtsyDeliveryProfile({ profile: local, api: etsy.api, checkpoint: progress.checkpoint });
    expect(vi.mocked(etsy.api.updateDestination).mock.calls.map(call => call[2])).toEqual(['1', '101']);
    expect(result.shipping_profile_destinations.find(row => row.destination_country_iso === 'GB')?.primary_cost.amount).toBe(550);
    expect(progress.checkpoints.at(-1)?.remoteSnapshot?.shipping_profile_destinations[0].shipping_profile_destination_id).toBe('101');
    expect(etsy.api.createDestination).not.toHaveBeenCalled();
  });
  it('deletes the current replacement destination rather than accepting the old ID as already removed', async () => {
    const initial = remoteProfile(['GB', 'US', 'CA']); const etsy = mockedEtsy(initial);
    vi.mocked(etsy.api.deleteDestination).mockImplementationOnce(async () => {
      const actual = etsy.getRemote(); actual.shipping_profile_destinations = actual.shipping_profile_destinations.map((row, index) => ({ ...row, shipping_profile_destination_id: String(101 + index) }));
      etsy.setRemote(actual); throw new EtsyDeliveryError('Destination missing', 'api', 404);
    });
    const result = await syncEtsyDeliveryProfile({ profile: localProfile(initial, ['GB']), api: etsy.api, checkpoint: async () => {} });
    expect(vi.mocked(etsy.api.deleteDestination).mock.calls.map(call => call[2])).toEqual(['2', '102', '103']);
    expect(result.shipping_profile_destinations.map(row => row.destination_country_iso)).toEqual(['GB']);
  });
  it('stops rather than adopting unrelated remote rate changes during destination-ID reconciliation', async () => {
    const initial = remoteProfile(); const etsy = mockedEtsy(initial); const local = localProfile(initial); const progress = progressCapture();
    local.destinations[0].primaryCostMinor = 550;
    vi.mocked(etsy.api.updateDestination).mockImplementationOnce(async () => {
      const actual = etsy.getRemote(); actual.shipping_profile_destinations[0].shipping_profile_destination_id = '101';
      actual.shipping_profile_destinations[1].primary_cost.amount = 999;
      etsy.setRemote(actual); throw new EtsyDeliveryError('Destination missing', 'api', 404);
    });
    await expect(syncEtsyDeliveryProfile({ profile: local, api: etsy.api, checkpoint: progress.checkpoint })).rejects.toMatchObject({ code: 'conflict' });
    expect(etsy.api.updateDestination).toHaveBeenCalledTimes(1);
    expect(etsy.api.createDestination).not.toHaveBeenCalled();
    expect(progress.checkpoints).toEqual([]);
  });
  it('does not recreate a selected country that disappears during an update', async () => {
    const initial = remoteProfile(); const etsy = mockedEtsy(initial); const local = localProfile(initial);
    local.destinations[0].primaryCostMinor = 550;
    vi.mocked(etsy.api.updateDestination).mockImplementationOnce(async () => {
      const actual = etsy.getRemote(); actual.shipping_profile_destinations = actual.shipping_profile_destinations.filter(row => row.destination_country_iso !== 'GB');
      etsy.setRemote(actual); throw new EtsyDeliveryError('Destination missing', 'api', 404);
    });
    await expect(syncEtsyDeliveryProfile({ profile: local, api: etsy.api, checkpoint: async () => {} })).rejects.toMatchObject({ code: 'conflict' });
    expect(etsy.api.createDestination).not.toHaveBeenCalled();
    expect(etsy.api.updateDestination).toHaveBeenCalledTimes(1);
  });
  it('bounds retries when a destination remains unavailable after its current ID is reread', async () => {
    const initial = remoteProfile(); const etsy = mockedEtsy(initial); const local = localProfile(initial);
    local.destinations[0].primaryCostMinor = 550;
    vi.mocked(etsy.api.updateDestination).mockRejectedValue(new EtsyDeliveryError('Destination missing', 'api', 404));
    await expect(syncEtsyDeliveryProfile({ profile: local, api: etsy.api, checkpoint: async () => {} })).rejects.toMatchObject({ code: 'conflict' });
    expect(etsy.api.updateDestination).toHaveBeenCalledTimes(2);
    expect(etsy.api.createDestination).not.toHaveBeenCalled();
  });
  it('rejects unrelated destination edits returned after the profile itself was updated', async () => {
    const initial = remoteProfile(); const etsy = mockedEtsy(initial); const local = { ...localProfile(initial), name: 'Renamed delivery' };
    vi.mocked(etsy.api.updateProfile).mockImplementationOnce(async (_shop, _id, values) => {
      const actual = etsy.getRemote(); actual.title = values.name; actual.shipping_profile_destinations[1].primary_cost.amount = 999;
      etsy.setRemote(actual); return copy(actual);
    });
    await expect(syncEtsyDeliveryProfile({ profile: local, api: etsy.api, checkpoint: async () => {} })).rejects.toMatchObject({ code: 'conflict' });
    expect(etsy.api.updateDestination).not.toHaveBeenCalled();
    expect(etsy.api.createDestination).not.toHaveBeenCalled();
  });
  it('removes excluded markets before adding countries and repeats without creating duplicates', async () => {
    const initial = remoteProfile(); const local = localProfile(initial, ['GB', 'CA']); const etsy = mockedEtsy(initial); const progress = progressCapture();
    const remote = await syncEtsyDeliveryProfile({ profile: local, api: etsy.api, checkpoint: progress.checkpoint });
    expect(etsy.calls).toEqual(['delete:2', 'add:CA']);
    expect(remote.shipping_profile_destinations.map((row) => row.destination_country_iso)).toEqual(['GB', 'CA']);
    const latest = progress.checkpoints.at(-1)!;
    await syncEtsyDeliveryProfile({ profile: { ...local, ...latest }, api: etsy.api, checkpoint: progress.checkpoint });
    expect(etsy.calls).toEqual(['delete:2', 'add:CA']);
    expect(etsy.api.createProfile).not.toHaveBeenCalled();
  });
  it('replaces the last obsolete destination atomically when country sets do not overlap', async () => {
    const initial = remoteProfile(); const etsy = mockedEtsy(initial);
    await syncEtsyDeliveryProfile({ profile: localProfile(initial, ['CA', 'AU']), api: etsy.api, checkpoint: async () => {} });
    expect(etsy.calls).toEqual(['delete:1', 'update:2:CA', 'add:AU']);
  });
  it.each(['*', 'region:eu'])('narrows a final imported %s destination before adding other countries', async (coverage) => {
    const initial = remoteProfile([coverage]); const etsy = mockedEtsy(initial);
    const result = await syncEtsyDeliveryProfile({ profile: localProfile(initial, ['GB', 'CA']), api: etsy.api, checkpoint: async () => {} });
    expect(etsy.calls).toEqual(['update:1:GB', 'add:CA']);
    expect(result.shipping_profile_destinations.every(row => row.destination_region === 'none')).toBe(true);
  });
  it('stops before adding markets if Etsy leaves the old regional target on the replacement row', async () => {
    const initial = remoteProfile(['region:eu']); const etsy = mockedEtsy(initial);
    vi.mocked(etsy.api.updateDestination).mockResolvedValueOnce({ ...remoteDestination('GB', '1'), destination_region: 'eu' });
    await expect(syncEtsyDeliveryProfile({ profile: localProfile(initial, ['GB', 'CA']), api: etsy.api, checkpoint: async () => {} })).rejects.toMatchObject({ code: 'conflict' });
    expect(etsy.api.createDestination).not.toHaveBeenCalled();
  });
  it('checks remote fingerprints before changing remotely edited profiles', async () => {
    const initial = remoteProfile(); const etsy = mockedEtsy({ ...initial, title: 'Edited in Etsy' });
    await expect(syncEtsyDeliveryProfile({ profile: localProfile(initial), api: etsy.api, checkpoint: async () => {} })).rejects.toMatchObject({ code: 'conflict' });
    expect(etsy.calls).toEqual([]);
  });
  it('persists successful removals and the remote ID when a later operation fails', async () => {
    const initial = remoteProfile(); const etsy = mockedEtsy(initial); const progress = progressCapture(); const local = localProfile(initial, ['GB', 'CA']);
    vi.mocked(etsy.api.createDestination).mockRejectedValueOnce(new EtsyDeliveryError('Bad service', 'validation', 400));
    await expect(syncEtsyDeliveryProfile({ profile: local, api: etsy.api, checkpoint: progress.checkpoint })).rejects.toThrow('Bad service');
    const latest = progress.checkpoints.at(-1)!;
    expect(latest.etsyShippingProfileId).toBe('20');
    expect(latest.remoteSnapshot!.shipping_profile_destinations).toHaveLength(1);
    expect(latest.pendingCreateToken).toBeNull();
    await syncEtsyDeliveryProfile({ profile: { ...local, ...latest }, api: etsy.api, checkpoint: progress.checkpoint });
    expect(etsy.calls).toEqual(['delete:2', 'add:CA']);
  });
  it('persists a profile ID before follow-up operations and never creates that profile again', async () => {
    const etsy = mockedEtsy(null); const progress = progressCapture(); const local = localProfile(null);
    vi.mocked(etsy.api.createDestination).mockRejectedValueOnce(new EtsyDeliveryError('Invalid', 'validation', 400));
    await expect(syncEtsyDeliveryProfile({ profile: local, api: etsy.api, checkpoint: progress.checkpoint })).rejects.toThrow('Invalid');
    const latest = progress.checkpoints.at(-1)!;
    expect(latest.etsyShippingProfileId).toBe('20');
    await syncEtsyDeliveryProfile({ profile: { ...local, ...latest }, api: etsy.api, checkpoint: progress.checkpoint });
    expect(etsy.api.createProfile).toHaveBeenCalledTimes(1);
  });
  it('reconciles a timed-out create against newly appeared remote IDs', async () => {
    const etsy = mockedEtsy(null); const progress = progressCapture(); const local = localProfile(null, ['GB']);
    vi.mocked(etsy.api.createProfile).mockImplementationOnce(async () => { etsy.setRemote(remoteProfile(['GB'])); throw new EtsyDeliveryError('Timed out', 'ambiguous_create', null, null, true); });
    const result = await syncEtsyDeliveryProfile({ profile: local, api: etsy.api, checkpoint: progress.checkpoint });
    expect(result.shipping_profile_id).toBe('20');
    expect(etsy.api.createProfile).toHaveBeenCalledTimes(1);
    expect(progress.checkpoints[0].pendingCreateToken).toContain('"kind":"profile"');
    expect(progress.checkpoints.at(-1)!.pendingCreateToken).toBeNull();
  });
  it('does not repeat an unconfirmed profile create even on the next explicit sync attempt', async () => {
    const etsy = mockedEtsy(null); const progress = progressCapture(); const local = localProfile(null, ['GB']);
    vi.mocked(etsy.api.createProfile).mockRejectedValue(new EtsyDeliveryError('Timed out', 'ambiguous_create', null, null, true));
    await expect(syncEtsyDeliveryProfile({ profile: local, api: etsy.api, checkpoint: progress.checkpoint })).rejects.toMatchObject({ code: 'ambiguous_create' });
    const latest = progress.checkpoints.at(-1)!;
    await expect(syncEtsyDeliveryProfile({ profile: { ...local, ...latest }, api: etsy.api, checkpoint: progress.checkpoint })).rejects.toMatchObject({ code: 'ambiguous_create' });
    expect(etsy.api.createProfile).toHaveBeenCalledTimes(1);
  });
  it('reconciles destination creation after a timeout without repeating its POST', async () => {
    const initial = remoteProfile(['GB']); const etsy = mockedEtsy(initial); const local = localProfile(initial); const progress = progressCapture();
    vi.mocked(etsy.api.createDestination).mockImplementationOnce(async () => { const actual = etsy.getRemote(); actual.shipping_profile_destinations.push(remoteDestination('US', '30')); etsy.setRemote(actual); throw new EtsyDeliveryError('Timeout', 'ambiguous_create', null, null, true); });
    const result = await syncEtsyDeliveryProfile({ profile: local, api: etsy.api, checkpoint: progress.checkpoint });
    expect(result.shipping_profile_destinations).toHaveLength(2);
    expect(etsy.api.createDestination).toHaveBeenCalledTimes(1);
  });
  it('imports worldwide coverage explicitly and never creates broad coverage on a new profile', async () => {
    const initial = remoteProfile(['*']);
    expect(importEtsyDeliveryProfile(initial, 'GBP').destinations[0].countryCode).toBe('*');
    const etsy = mockedEtsy(null);
    await expect(syncEtsyDeliveryProfile({ profile: localProfile(null, ['*']), api: etsy.api, checkpoint: async () => {} })).rejects.toMatchObject({ code: 'validation' });
    expect(etsy.api.createProfile).not.toHaveBeenCalled();
  });
  it('rejects mismatched shop currencies before any mutation', async () => {
    const initial = remoteProfile(); const etsy = mockedEtsy(initial); vi.mocked(etsy.api.getShopCurrency).mockResolvedValue('USD');
    await expect(syncEtsyDeliveryProfile({ profile: localProfile(initial), api: etsy.api, checkpoint: async () => {} })).rejects.toMatchObject({ code: 'validation' });
    expect(etsy.calls).toEqual([]);
  });
  it('leaves calculated profile rates in Etsy Shop Manager', async () => {
    const initial = { ...remoteProfile(), profile_type: 'calculated' }; const etsy = mockedEtsy(initial);
    await expect(syncEtsyDeliveryProfile({ profile: localProfile(initial), api: etsy.api, checkpoint: async () => {} })).rejects.toMatchObject({ code: 'validation' });
    expect(etsy.calls).toEqual([]);
  });
  it('does not overwrite an existing remote profile without an imported baseline', async () => {
    const initial = remoteProfile(); const etsy = mockedEtsy(initial);
    await expect(syncEtsyDeliveryProfile({ profile: { ...localProfile(initial), remoteFingerprint: null }, api: etsy.api, checkpoint: async () => {} })).rejects.toMatchObject({ code: 'conflict' });
    expect(etsy.calls).toEqual([]);
  });
  it('reconciles a removal that Etsy applied before the connection failed', async () => {
    const initial = remoteProfile(); const etsy = mockedEtsy(initial);
    vi.mocked(etsy.api.deleteDestination).mockImplementationOnce(async () => {
      const actual = etsy.getRemote(); actual.shipping_profile_destinations = actual.shipping_profile_destinations.filter((row) => String(row.shipping_profile_destination_id) !== '2'); etsy.setRemote(actual);
      throw new EtsyDeliveryError('Connection lost', 'network');
    });
    const result = await syncEtsyDeliveryProfile({ profile: localProfile(initial, ['GB', 'CA']), api: etsy.api, checkpoint: async () => {} });
    expect(result.shipping_profile_destinations.map((row) => row.destination_country_iso)).toEqual(['GB', 'CA']);
    expect(etsy.api.deleteDestination).toHaveBeenCalledTimes(1);
  });
  it('keeps the pending create token if persisting its success fails, and reconciles on the next sync', async () => {
    const initial = remoteProfile(['GB']); const etsy = mockedEtsy(initial); const local = localProfile(initial);
    let durable: EtsyDeliveryCheckpoint | undefined;
    let failed = false;
    const checkpoint = async (progress: EtsyDeliveryCheckpoint) => {
      if (!failed && !progress.pendingCreateToken && progress.remoteSnapshot?.shipping_profile_destinations.length === 2) {
        failed = true; throw new Error('Database unavailable');
      }
      durable = copy(progress);
    };
    await expect(syncEtsyDeliveryProfile({ profile: local, api: etsy.api, checkpoint })).rejects.toThrow('Database unavailable');
    expect(durable!.pendingCreateToken).toContain('"kind":"destination"');
    const result = await syncEtsyDeliveryProfile({ profile: { ...local, ...durable! }, api: etsy.api, checkpoint });
    expect(result.shipping_profile_destinations).toHaveLength(2);
    expect(etsy.api.createDestination).toHaveBeenCalledTimes(1);
    expect(durable!.pendingCreateToken).toBeNull();
  });
  it('does not adopt unrelated remote edits while reconciling an unresolved destination create', async () => {
    const initial = remoteProfile(['GB']); const etsy = mockedEtsy(initial); const local = localProfile(initial); const progress = progressCapture();
    vi.mocked(etsy.api.createDestination).mockRejectedValueOnce(new EtsyDeliveryError('Timeout', 'ambiguous_create', null, null, true));
    await expect(syncEtsyDeliveryProfile({ profile: local, api: etsy.api, checkpoint: progress.checkpoint })).rejects.toMatchObject({ code: 'ambiguous_create' });
    const durable = progress.checkpoints.at(-1)!;
    etsy.setRemote({ ...initial, title: 'Seller edited directly in Etsy', shipping_profile_destinations: [...initial.shipping_profile_destinations, remoteDestination('US', '30')] });
    await expect(syncEtsyDeliveryProfile({ profile: { ...local, ...durable }, api: etsy.api, checkpoint: progress.checkpoint })).rejects.toMatchObject({ code: 'conflict' });
    expect(etsy.api.createDestination).toHaveBeenCalledTimes(1);
  });
});
