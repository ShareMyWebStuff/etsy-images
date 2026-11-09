import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => {
  const table = () => ({ findUnique: vi.fn(), findFirst: vi.fn(), findMany: vi.fn(), count: vi.fn(), create: vi.fn(), update: vi.fn(), updateMany: vi.fn(), upsert: vi.fn(), deleteMany: vi.fn(), createMany: vi.fn() });
  return { db: { etsyShop: table(), deliveryProfile: table(), deliveryDestination: table(), marketDeliverySettings: table(), deliveryAssignmentSync: table(), etsyListing: table(), ourCategory: table(), $transaction: vi.fn() }, syncRemote: vi.fn(), createApi: vi.fn() };
});
vi.mock('@/lib/prisma', () => ({ prisma: mocks.db }));
vi.mock('@/lib/etsy-oauth', () => ({ getEtsyOAuthConnectionStatus: async () => ({ connected: true, scopes: ['shops_r', 'shops_w', 'listings_w'] }), getEtsyKeystring: () => 'mock', getValidEtsyAccessToken: async () => 'mock' }));
vi.mock('@/lib/etsy-delivery-api', async (importOriginal) => ({ ...await importOriginal<typeof import('@/lib/etsy-delivery-api')>(), createEtsyDeliveryApi: mocks.createApi }));
vi.mock('@/lib/etsy-delivery-sync', async (importOriginal) => ({ ...await importOriginal<typeof import('@/lib/etsy-delivery-sync')>(), syncEtsyDeliveryProfile: mocks.syncRemote }));

import { EtsyDeliveryError, type EtsyDeliveryApi, type EtsyDeliveryProfile } from '@/lib/etsy-delivery-api';
import { etsyDeliveryFingerprint } from '@/lib/etsy-delivery-sync';
import { archiveDeliveryProfile, getEffectiveListingDelivery, importDeliveryProfiles, markDeliveryAssignmentSynced, recordDeliveryAssignmentMetadata, saveDeliveryProfile, saveListingMarketsDelivery, saveTemplateMarketsDelivery, syncDeliveryProfile } from '@/lib/markets-delivery';
import type { DeliveryProfileValues } from '@/lib/markets-delivery-types';

type Row = Record<string, any>;
const shop = { id: 1, etsyShopId: 100n, currencyCode: 'GBP', shopName: 'Test shop' };
const date = new Date('2026-11-08T10:00:00Z');
const values = (): DeliveryProfileValues => ({ name: 'Local delivery', currencyCode: 'GBP', originCountryIso: 'GB', originPostalCode: 'SW1A 1AA', readinessStateId: '33', includeDeliveryInformation: true,
  deliveryInformation: 'Seller supplied wording', destinations: [{ countryCode: 'GB', primaryCostMinor: 400, secondaryCostMinor: 100, minDeliveryDays: 2, maxDeliveryDays: 5, carrierId: null, mailClass: null }] });
const native = (): EtsyDeliveryProfile => ({ shipping_profile_id: '900', title: 'Etsy delivery', origin_country_iso: 'GB', origin_postal_code: 'SW1A 1AA', profile_type: 'manual', shipping_profile_destinations: [{
  shipping_profile_destination_id: '901', destination_country_iso: 'GB', destination_region: 'none', primary_cost: { amount: 400, divisor: 100, currency_code: 'GBP' }, secondary_cost: { amount: 100, divisor: 100, currency_code: 'GBP' }, min_delivery_days: 2, max_delivery_days: 5, shipping_carrier_id: 0, mail_class: null,
}] });
const profileRow = (overrides: Row = {}): Row => ({ ...values(), id: 1, shopId: 1, etsyShippingProfileId: '900', revision: 2, syncedRevision: 2, syncStatus: 'SYNCED', lastSyncedAt: date,
  remoteFingerprint: etsyDeliveryFingerprint(native()), remoteSnapshot: native(), pendingCreateToken: null, syncStartedAt: null, error: null, archivedAt: null, updatedAt: date, createdAt: date, isCalculated: false,
  destinations: values().destinations.map((destination, i) => ({ ...destination, id: i + 1, profileId: 1, etsyDestinationId: '901' })), ...overrides });
const template = (overrides: Row = {}): Row => ({ id: 10, shopId: 1, shop, name: 'Template', followedTemplateId: null, printsFrames: true, customisePrints: true, digitalDownload: true,
  customTop: true, customBottom: true, printFrameSectionId: 7, customisedSectionId: 8, printFrameSection: { id: 7 }, customisedSection: { id: 8 }, downloadSection: { id: 9 }, ...overrides });
const listing = (overrides: Row = {}): Row => ({ id: 51, shopId: '100', title: 'Artwork', description: 'Existing description', localDirectoryName: 'Artwork', etsyId: '500', etsyCustomisedId: '501',
  ourCategoryId: 10, ourCategory: template(), subSectionId: 3, rawJson: {}, etsyCustomisedRawJson: {}, productConfig: { customisePrints: true, customTop: true, customBottom: true, printsFramesOverride: null, digitalDownloadOverride: null }, ...overrides });
const setting = (overrides: Row = {}): Row => ({ id: 1, shopId: 1, listingId: null, templateId: 10, printProfileId: 1, customisedProfileId: 1, includeDeliveryInformation: null, deliveryInformation: null, ...overrides });
const context = { shopId: '100', sectionId: '2', subSectionId: '3', listingId: '51' };
let profiles: Row[]; let listings: Row[]; let templates: Row[]; let settings: Row[];
const matchesSettings = (row: Row, where: Row = {}): boolean => (where.shopId === undefined || row.shopId === where.shopId)
  && (where.listingId === undefined || row.listingId === where.listingId)
  && (where.templateId === undefined || (typeof where.templateId === 'object' && where.templateId !== null
    ? where.templateId.in ? where.templateId.in.includes(row.templateId) : where.templateId.not === null ? row.templateId !== null : true
    : row.templateId === where.templateId))
  && (!where.OR || where.OR.some((part: Row) => matchesSettings(row, part)));
const apply = (row: Row, data: Row) => { for (const [key, value] of Object.entries(data)) row[key] = value && typeof value === 'object' && 'increment' in value ? row[key] + value.increment : value; return row; };
const matchesProfile = (row: Row, where: Row): boolean => Object.entries(where).every(([key, expected]) => {
  if (key === 'OR') return expected.some((part: Row) => matchesProfile(row, part));
  if (key === 'AND') return expected.every((part: Row) => matchesProfile(row, part));
  const actual = row[key];
  if (expected instanceof Date) return actual instanceof Date && actual.getTime() === expected.getTime();
  if (expected && typeof expected === 'object') {
    if ('lt' in expected) return actual instanceof Date && actual.getTime() < expected.lt.getTime();
    if ('lte' in expected) return actual instanceof Date && actual.getTime() <= expected.lte.getTime();
    if ('equals' in expected) return actual === expected.equals;
  }
  return expected === undefined || actual === expected;
});

beforeEach(() => {
  vi.resetAllMocks(); profiles = [profileRow()]; listings = [listing()]; templates = [template()]; settings = [setting()];
  mocks.db.etsyShop.findUnique.mockImplementation(async ({ where }) => where.etsyShopId === 100n ? shop : null);
  mocks.db.etsyShop.findMany.mockResolvedValue([shop]); mocks.db.etsyShop.update.mockResolvedValue(shop);
  mocks.db.deliveryProfile.findFirst.mockImplementation(async ({ where }) => {
    const found = profiles.find(row => (where.id === undefined || row.id === where.id) && (where.shopId === undefined || row.shopId === where.shopId) && (where.etsyShippingProfileId === undefined || row.etsyShippingProfileId === where.etsyShippingProfileId));
    return found ? { ...found, destinations: found.destinations.map((destination: Row) => ({ ...destination })) } : null;
  });
  mocks.db.deliveryProfile.findMany.mockImplementation(async ({ where } = {}) => profiles.filter(row => !where || (row.shopId === where.shopId && (where.archivedAt === undefined || row.archivedAt === where.archivedAt))));
  mocks.db.deliveryProfile.update.mockImplementation(async ({ where, data }) => apply(profiles.find(row => row.id === where.id)!, data));
  mocks.db.deliveryProfile.updateMany.mockImplementation(async ({ where, data }) => { const row = profiles.find(row => matchesProfile(row, where)); if (!row) return { count: 0 }; apply(row, data); return { count: 1 }; });
  mocks.db.deliveryProfile.create.mockImplementation(async ({ data }) => { const row = profileRow({ ...data, id: profiles.length + 1, destinations: data.destinations?.create ?? [], etsyShippingProfileId: data.etsyShippingProfileId ?? null }); profiles.push(row); return row; });
  mocks.db.etsyListing.findMany.mockImplementation(async () => listings);
  mocks.db.etsyListing.findFirst.mockImplementation(async ({ where }) => listings.find(row => row.id === where.id && row.subSectionId === where.subSectionId) ?? null);
  mocks.db.ourCategory.findMany.mockImplementation(async ({ where } = {}) => templates.filter(row => !where || (row.shopId === where.shopId && (!where.id || where.id.in.includes(row.id)))));
  mocks.db.ourCategory.findUnique.mockImplementation(async ({ where }) => templates.find(row => row.id === where.id) ?? null);
  mocks.db.marketDeliverySettings.findMany.mockImplementation(async ({ where } = {}) => settings.filter(row => matchesSettings(row, where)));
  mocks.db.marketDeliverySettings.count.mockResolvedValue(0);
  mocks.db.marketDeliverySettings.deleteMany.mockImplementation(async ({ where }) => { settings = settings.filter(row => !matchesSettings(row, where)); return { count: 1 }; });
  mocks.db.marketDeliverySettings.upsert.mockImplementation(async ({ where, create, update }) => { const row = settings.find(item => matchesSettings(item, where)); if (row) return apply(row, update); const created = { id: settings.length + 1, listingId: null, templateId: null, ...create }; settings.push(created); return created; });
  mocks.db.deliveryAssignmentSync.upsert.mockImplementation(async ({ create }) => create);
  mocks.db.deliveryAssignmentSync.findUnique.mockResolvedValue(null); mocks.db.deliveryAssignmentSync.updateMany.mockResolvedValue({ count: 1 });
  mocks.db.deliveryDestination.updateMany.mockResolvedValue({ count: 1 }); mocks.db.deliveryDestination.deleteMany.mockResolvedValue({ count: 1 }); mocks.db.deliveryDestination.createMany.mockResolvedValue({ count: 1 });
  mocks.db.$transaction.mockImplementation(async (callback) => callback(mocks.db));
  mocks.createApi.mockImplementation(() => { throw new Error('Unexpected external API construction'); });
});

function fakeApi(remote = native()) {
  return { getShopCurrency: vi.fn(async () => 'GBP'), getProfile: vi.fn(async () => remote), listProfiles: vi.fn(async () => [remote]), listDestinations: vi.fn(async () => remote.shipping_profile_destinations) } as unknown as EtsyDeliveryApi;
}

describe('shop scoped delivery persistence', () => {
  it('rejects another shop’s profile before syncing or mutating data', async () => {
    profiles = [profileRow({ shopId: 2 })];
    await expect(syncDeliveryProfile('100', '1')).rejects.toMatchObject({ status: 404 });
    expect(mocks.syncRemote).not.toHaveBeenCalled(); expect(mocks.createApi).not.toHaveBeenCalled();
    expect(mocks.db.deliveryProfile.update).not.toHaveBeenCalled();
  });
  it('rejects a cross-shop profile import before any Etsy call', async () => {
    profiles = [profileRow({ shopId: 2 })]; const api = fakeApi();
    await expect(importDeliveryProfiles('100', { profileId: '1', api })).rejects.toMatchObject({ status: 404 });
    expect(api.getShopCurrency).not.toHaveBeenCalled(); expect(api.getProfile).not.toHaveBeenCalled();
    expect(mocks.db.etsyShop.update).not.toHaveBeenCalled();
  });
  it('ordinary local profile saves never construct an Etsy client', async () => {
    const id = await saveDeliveryProfile('100', values());
    expect(id).toBe(2); expect(mocks.createApi).not.toHaveBeenCalled(); expect(mocks.syncRemote).not.toHaveBeenCalled();
    expect(mocks.db.deliveryProfile.create).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ shopId: 1, destinations: { create: values().destinations } }) }));
  });
  it('blocks archiving assigned profiles and does not delete anything on Etsy', async () => {
    mocks.db.marketDeliverySettings.count.mockResolvedValue(1);
    await expect(archiveDeliveryProfile('100', '1')).rejects.toMatchObject({ status: 409 });
    expect(mocks.db.deliveryProfile.update).not.toHaveBeenCalled(); expect(mocks.createApi).not.toHaveBeenCalled();
  });
  it('archives an unused profile locally without an Etsy mutation', async () => {
    settings = []; listings = [];
    await archiveDeliveryProfile('100', '1');
    expect(profiles[0].archivedAt).toBeInstanceOf(Date); expect(mocks.createApi).not.toHaveBeenCalled();
  });
  it('does not archive a profile if a sync acquired its lease after the initial profile read', async () => {
    settings = []; listings = [];
    const originalTransaction = mocks.db.$transaction.getMockImplementation()!;
    const startedAt = new Date();
    mocks.db.$transaction.mockImplementationOnce(async (callback) => {
      profiles[0].syncStartedAt = startedAt; profiles[0].updatedAt = startedAt;
      return originalTransaction(callback);
    });
    await expect(archiveDeliveryProfile('100', '1')).rejects.toMatchObject({ status: 409 });
    expect(profiles[0].archivedAt).toBeNull(); expect(profiles[0].syncStartedAt).toBe(startedAt);
    expect(mocks.db.marketDeliverySettings.count).not.toHaveBeenCalled(); expect(mocks.createApi).not.toHaveBeenCalled();
  });
  it('rechecks profile references after acquiring the archive row lock', async () => {
    settings = []; listings = [];
    mocks.db.marketDeliverySettings.count.mockImplementation(async () => {
      expect(mocks.db.deliveryProfile.updateMany).toHaveBeenCalledWith(expect.objectContaining({ where: expect.objectContaining({ syncStartedAt: null, pendingCreateToken: null, revision: 2 }) }));
      return 1;
    });
    await expect(archiveDeliveryProfile('100', '1')).rejects.toMatchObject({ status: 409 });
    expect(profiles[0].archivedAt).toBeNull(); expect(mocks.createApi).not.toHaveBeenCalled();
  });
  it('requires affected-listing confirmation before shared local changes', async () => {
    await expect(saveDeliveryProfile('100', { ...values(), name: 'Updated' }, '1', 2)).rejects.toMatchObject({ status: 409 });
    expect(mocks.db.$transaction).not.toHaveBeenCalled(); expect(mocks.createApi).not.toHaveBeenCalled();
  });
});

describe('Etsy import and sync progress', () => {
  it('preserves unsynced local edits during ordinary import', async () => {
    profiles[0].syncStatus = 'PENDING'; profiles[0].name = 'Unsynced local name';
    expect(await importDeliveryProfiles('100', { api: fakeApi() })).toBe(0);
    expect(profiles[0].name).toBe('Unsynced local name'); expect(profiles[0].syncStatus).toBe('PENDING');
    expect(mocks.db.deliveryDestination.deleteMany).not.toHaveBeenCalled();
  });
  it('reports conflict while preserving local values when Etsy changed during pending edits', async () => {
    profiles[0].syncStatus = 'PENDING'; profiles[0].name = 'Unsynced local name';
    expect(await importDeliveryProfiles('100', { api: fakeApi({ ...native(), title: 'Changed on Etsy' }) })).toBe(0);
    expect(profiles[0].name).toBe('Unsynced local name'); expect(profiles[0].syncStatus).toBe('CONFLICT');
    expect(mocks.db.deliveryDestination.deleteMany).not.toHaveBeenCalled();
  });
  it('an explicit reload keeps local description ownership and separate readiness selection', async () => {
    profiles[0].syncStatus = 'CONFLICT';
    expect(await importDeliveryProfiles('100', { profileId: '1', resolveConflict: true, api: fakeApi() })).toBe(1);
    expect(profiles[0]).toMatchObject({ name: 'Etsy delivery', deliveryInformation: 'Seller supplied wording', includeDeliveryInformation: true, readinessStateId: '33', syncStatus: 'SYNCED' });
  });
  it('keeps physical listing assignments pending after the reusable profile finishes syncing', async () => {
    mocks.syncRemote.mockImplementation(async ({ checkpoint }) => { await checkpoint({ etsyShippingProfileId: '900', remoteFingerprint: etsyDeliveryFingerprint(native()), remoteSnapshot: native(), pendingCreateToken: null }); return native(); });
    await syncDeliveryProfile('100', '1', { expectedRevision: 2, confirmAffected: true, api: fakeApi() });
    expect(profiles[0].syncStatus).toBe('SYNCED');
    expect(mocks.db.deliveryAssignmentSync.upsert).toHaveBeenCalledTimes(2);
    expect(mocks.db.deliveryAssignmentSync.upsert.mock.calls.map(([call]) => call.create)).toEqual(expect.arrayContaining([
      expect.objectContaining({ listingId: 51, variant: 'print', status: 'PENDING' }), expect.objectContaining({ listingId: 51, variant: 'customised', status: 'PENDING' }),
    ]));
    expect(mocks.db.etsyListing.updateMany).not.toHaveBeenCalled(); expect(mocks.db.deliveryAssignmentSync.updateMany).not.toHaveBeenCalled();
  });
  it('retains a remotely created profile ID and completed checkpoint when later sync work fails', async () => {
    profiles[0].etsyShippingProfileId = null; profiles[0].remoteFingerprint = null;
    mocks.syncRemote.mockImplementation(async ({ checkpoint }) => { await checkpoint({ etsyShippingProfileId: '777', remoteFingerprint: 'saved-baseline', remoteSnapshot: { ...native(), shipping_profile_id: '777' }, pendingCreateToken: null }); throw new EtsyDeliveryError('Later destination failed', 'validation', 400); });
    await expect(syncDeliveryProfile('100', '1', { confirmAffected: true, api: fakeApi() })).rejects.toThrow('Later destination failed');
    expect(profiles[0]).toMatchObject({ etsyShippingProfileId: '777', remoteFingerprint: 'saved-baseline', syncStatus: 'FAILED', syncStartedAt: null });
  });
  it('does not reclaim a long-running sync whose checkpoint heartbeat is recent', async () => {
    profiles[0].syncStartedAt = new Date(Date.now() - 1_200_000); profiles[0].updatedAt = new Date();
    await expect(syncDeliveryProfile('100', '1', { confirmAffected: true, api: fakeApi() })).rejects.toMatchObject({ status: 409 });
    expect(mocks.syncRemote).not.toHaveBeenCalled();
    await expect(saveDeliveryProfile('100', { ...values(), name: 'Changed' }, '1', 2, true)).rejects.toMatchObject({ status: 409 });
  });
  it('reclaims an expired lease and refreshes the heartbeat on confirmed checkpoints', async () => {
    const expiredAt = new Date(Date.now() - 1_200_000); profiles[0].syncStartedAt = expiredAt; profiles[0].updatedAt = expiredAt;
    mocks.syncRemote.mockImplementation(async ({ checkpoint }) => {
      expect(profiles[0].syncStartedAt).not.toEqual(expiredAt);
      await checkpoint({ etsyShippingProfileId: '900', remoteFingerprint: etsyDeliveryFingerprint(native()), remoteSnapshot: native(), pendingCreateToken: null });
      expect(profiles[0].updatedAt.getTime()).toBeGreaterThan(expiredAt.getTime()); return native();
    });
    await syncDeliveryProfile('100', '1', { confirmAffected: true, api: fakeApi() });
    expect(profiles[0].syncStartedAt).toBeNull(); expect(profiles[0].syncStatus).toBe('SYNCED');
  });
  it('cannot checkpoint remote identifiers into a newer local revision after losing the lease', async () => {
    const newerClaim = new Date(Date.now() + 60_000);
    mocks.syncRemote.mockImplementation(async ({ checkpoint }) => {
      apply(profiles[0], { name: 'New local revision', revision: 3, syncStatus: 'PENDING', syncStartedAt: newerClaim, etsyShippingProfileId: '999', error: 'New worker owns this' });
      await checkpoint({ etsyShippingProfileId: '777', remoteFingerprint: 'obsolete-baseline', remoteSnapshot: native(), pendingCreateToken: null });
      return native();
    });
    await expect(syncDeliveryProfile('100', '1', { confirmAffected: true, api: fakeApi() })).rejects.toMatchObject({ status: 409 });
    expect(profiles[0]).toMatchObject({ name: 'New local revision', revision: 3, syncStatus: 'PENDING', syncStartedAt: newerClaim, etsyShippingProfileId: '999', error: 'New worker owns this' });
    expect(mocks.db.deliveryDestination.updateMany).not.toHaveBeenCalled();
  });
  it('cannot finalize a newer claim even when its local revision number is unchanged', async () => {
    const newerClaim = new Date(Date.now() + 60_000);
    mocks.syncRemote.mockImplementation(async () => { apply(profiles[0], { syncStartedAt: newerClaim, syncStatus: 'PENDING', error: 'New claim owns this' }); return native(); });
    await expect(syncDeliveryProfile('100', '1', { confirmAffected: true, api: fakeApi() })).rejects.toMatchObject({ status: 409 });
    expect(profiles[0]).toMatchObject({ syncStartedAt: newerClaim, syncStatus: 'PENDING', error: 'New claim owns this' });
    expect(mocks.db.deliveryDestination.updateMany).not.toHaveBeenCalled();
  });
  it('keeps its lease until destination mappings have been persisted', async () => {
    profiles[0].syncStatus = 'PENDING';
    mocks.syncRemote.mockResolvedValue(native());
    mocks.db.deliveryDestination.updateMany.mockImplementation(async () => { expect(profiles[0].syncStartedAt).toBeInstanceOf(Date); expect(profiles[0].syncStatus).toBe('PENDING'); return { count: 1 }; });
    await syncDeliveryProfile('100', '1', { confirmAffected: true, api: fakeApi() });
    expect(mocks.db.deliveryDestination.updateMany).toHaveBeenCalled(); expect(profiles[0].syncStartedAt).toBeNull();
  });
  it('returns the original remote failure if lease cleanup also fails', async () => {
    const original = new EtsyDeliveryError('Original Etsy validation failure', 'validation', 400);
    mocks.syncRemote.mockImplementation(async () => { mocks.db.deliveryProfile.updateMany.mockRejectedValueOnce(new Error('Cleanup database unavailable')); throw original; });
    await expect(syncDeliveryProfile('100', '1', { confirmAffected: true, api: fakeApi() })).rejects.toBe(original);
  });
  it('rejects a save that raced with a new live lease after its initial read', async () => {
    const originalTransaction = mocks.db.$transaction.getMockImplementation()!;
    mocks.db.$transaction.mockImplementationOnce(async (callback) => {
      profiles[0].syncStartedAt = new Date(); profiles[0].updatedAt = new Date();
      return originalTransaction(callback);
    });
    await expect(saveDeliveryProfile('100', { ...values(), name: 'Edit racing a sync' }, '1', 2, true)).rejects.toMatchObject({ status: 409 });
    expect(profiles[0].name).toBe('Local delivery'); expect(profiles[0].revision).toBe(2);
    expect(mocks.db.deliveryDestination.deleteMany).not.toHaveBeenCalled();
  });
});

describe('inheritance and physical assignment isolation', () => {
  it('resolves a new listing’s inherited wording from the shipping profile chosen for upload', async () => {
    settings = [];
    listings = [listing({ etsyId: null, rawJson: null })];
    const delivery = await getEffectiveListingDelivery(context, 'print', { shippingProfileId: '900' });
    expect(delivery).toMatchObject({ profileId: '1', shippingProfileId: '900', includeDeliveryInformation: true,
      deliveryInformation: 'Seller supplied wording', profileRevision: 2 });
  });
  it('retains the sent profile when Etsy returns a partial listing snapshot without shipping fields', async () => {
    settings = [];
    listings = [listing({ rawJson: { shipping_profile_id: 900 } })];
    const expected = await getEffectiveListingDelivery(context, 'print');
    listings[0].rawJson = { listing_id: 500, state: 'draft' };
    await recordDeliveryAssignmentMetadata(context, 'print', '500', { expected });
    await markDeliveryAssignmentSynced(context, 'print', '500', { expected });
    expect(mocks.db.deliveryAssignmentSync.upsert).toHaveBeenCalledWith(expect.objectContaining({
      create: expect.objectContaining({ profileId: 1, etsyShippingProfileId: '900', profileRevision: 2 }),
    }));
    expect(mocks.db.deliveryAssignmentSync.updateMany).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ status: 'SYNCED' }) }));
  });
  it('keeps a confirmed assignment visible after a partial Etsy read without a sync hint', async () => {
    settings = [];
    listings = [listing({ rawJson: { listing_id: 500 }, deliveryAssignmentSyncs: [{ variant: 'print', etsyListingId: '500', etsyShippingProfileId: '900' }] })];
    expect((await getEffectiveListingDelivery(context, 'print')).profileId).toBe('1');
    listings[0].etsyId = '600';
    expect((await getEffectiveListingDelivery(context, 'print')).profileId).toBeNull();
  });
  it('recognises a profile from Etsy’s nested shipping-profile response', async () => {
    settings = [];
    listings = [listing({ rawJson: { shipping_profile: { shipping_profile_id: 900 } } })];
    expect((await getEffectiveListingDelivery(context, 'print')).profileId).toBe('1');
  });
  it('does not let the uploaded shipping-profile hint override a newly chosen template profile', async () => {
    const expected = await getEffectiveListingDelivery(context, 'print');
    profiles.push(profileRow({ id: 2, etsyShippingProfileId: '999' }));
    settings[0].printProfileId = 2;
    expect((await getEffectiveListingDelivery(context, 'print', { shippingProfileId: '900' })).profileId).toBe('2');
    await expect(recordDeliveryAssignmentMetadata(context, 'print', '500', { expected })).rejects.toMatchObject({ status: 409 });
    expect(mocks.db.deliveryAssignmentSync.upsert).not.toHaveBeenCalled();
  });
  it('uses the existing print profile for both modes when a combined Etsy listing has no separate customised snapshot', async () => {
    settings = [];
    listings = [listing({ etsyCustomisedId: null, etsyCustomisedRawJson: null,
      rawJson: { shipping_profile_id: 900, description: 'Shared physical description' },
      ourCategory: template({ customisedSection: { id: 7 }, customisedSectionId: 7 }),
    })];
    const print = await getEffectiveListingDelivery(context, 'print');
    const customised = await getEffectiveListingDelivery(context, 'customised');
    expect(print.profileId).toBe('1');
    expect(customised).toEqual(print);
    expect(customised.shippingProfileId).toBe('900');
    expect(customised.remoteDescription).toBe('Shared physical description');
  });
  it('uses the shared print assignment and description even if an old customised snapshot exists', async () => {
    settings = [];
    profiles.push(profileRow({ id: 2, etsyShippingProfileId: '999' }));
    listings = [listing({ rawJson: { shipping_profile_id: 900, description: 'Current shared description' },
      etsyCustomisedRawJson: { shipping_profile_id: 999, description: 'Old separate customised description' },
      ourCategory: template({ customisedSection: { id: 7 }, customisedSectionId: 7 }),
    })];
    mocks.db.deliveryAssignmentSync.findUnique.mockImplementation(async ({ where }) => where.listingId_variant.variant === 'print'
      ? { status: 'CONFLICT', error: 'Review shared Etsy description' } : null);
    const print = await getEffectiveListingDelivery(context, 'print');
    const customised = await getEffectiveListingDelivery(context, 'customised');
    expect(customised).toEqual(print);
    expect(customised.profileId).toBe('1');
    expect(customised.descriptionConflict).toBe('Review shared Etsy description');
    expect(mocks.db.deliveryAssignmentSync.findUnique.mock.calls.every(([call]) => call.where.listingId_variant.variant === 'print')).toBe(true);
  });
  it('keeps imported profiles separate when print and customised products use different Etsy listings', async () => {
    settings = [];
    profiles.push(profileRow({ id: 2, etsyShippingProfileId: '999' }));
    listings = [listing({ rawJson: { shipping_profile_id: 900 }, etsyCustomisedRawJson: { shipping_profile_id: 999 } })];
    expect((await getEffectiveListingDelivery(context, 'print')).profileId).toBe('1');
    expect((await getEffectiveListingDelivery(context, 'customised')).profileId).toBe('2');
  });
  it('template changes dirty only inheriting physical products, preserving listing overrides and digital products', async () => {
    listings = [listing(), listing({ id: 52 }), listing({ id: 53, ourCategory: template({ printsFrames: false, customisePrints: false }) })];
    settings.push(setting({ id: 2, listingId: 52, templateId: null, printProfileId: 1 }));
    await saveTemplateMarketsDelivery('10', { printProfileId: '1', customisedProfileId: '1', includeDeliveryInformation: true, deliveryInformation: 'Updated template wording' });
    const marked = mocks.db.deliveryAssignmentSync.upsert.mock.calls.map(([call]) => call.create);
    expect(marked).toHaveLength(2); expect(marked.every(row => row.listingId === 51 && row.variant !== 'download')).toBe(true);
    expect(settings.find(row => row.listingId === 52)!.deliveryInformation).toBeNull();
    expect(mocks.db.etsyListing.updateMany).not.toHaveBeenCalled();
  });
  it('resetting a listing removes its override and immediately restores template defaults', async () => {
    profiles.push(profileRow({ id: 2, name: 'Explicit listing profile', etsyShippingProfileId: '999' }));
    settings.push(setting({ id: 2, templateId: null, listingId: 51, printProfileId: 2, customisedProfileId: 2, deliveryInformation: 'Explicit text' }));
    const result = await saveListingMarketsDelivery(context, null);
    expect(result.isInherited).toBe(true); expect(result.effective.print.profileId).toBe('1');
    expect(result.effective.print.deliveryInformation).toBe('Seller supplied wording');
    expect(settings.some(row => row.listingId === 51)).toBe(false);
    expect(mocks.createApi).not.toHaveBeenCalled();
  });
  it('follows delivery defaults through more than one template ancestor', async () => {
    templates = [template({ followedTemplateId: 11 }), template({ id: 11, followedTemplateId: 12 }), template({ id: 12 })];
    listings = [listing({ ourCategory: templates[0] })]; settings = [setting({ templateId: 12 })];
    const result = await getEffectiveListingDelivery(context, 'print');
    expect(result.profileId).toBe('1'); expect(result.inherited).toBe(true);
  });
  it('rejects separate profiles for physical products that share one Etsy listing', async () => {
    profiles.push(profileRow({ id: 2 })); listings = [listing({ ourCategory: template({ customisedSection: { id: 7 }, customisedSectionId: 7 }) })];
    await expect(saveListingMarketsDelivery(context, { printProfileId: '1', customisedProfileId: '2', includeDeliveryInformation: null, deliveryInformation: null })).rejects.toThrow(/share one Etsy listing/);
    expect(mocks.db.marketDeliverySettings.upsert).not.toHaveBeenCalled(); expect(mocks.createApi).not.toHaveBeenCalled();
  });
  it('rejects cross-shop profile assignments in both listing and template settings', async () => {
    profiles.push(profileRow({ id: 2, shopId: 2 }));
    const foreignSelection = { printProfileId: '2', customisedProfileId: null, includeDeliveryInformation: null, deliveryInformation: null };
    await expect(saveListingMarketsDelivery(context, foreignSelection)).rejects.toMatchObject({ status: 404 });
    await expect(saveTemplateMarketsDelivery('10', foreignSelection)).rejects.toMatchObject({ status: 404 });
    expect(mocks.db.marketDeliverySettings.upsert).not.toHaveBeenCalled(); expect(mocks.createApi).not.toHaveBeenCalled();
  });
  it('digital products receive no physical profile or delivery wording', async () => {
    const result = await getEffectiveListingDelivery(context, 'download');
    expect(result).toMatchObject({ profileId: null, shippingProfileId: null, readinessStateId: null, includeDeliveryInformation: false, deliveryInformation: '', pending: false });
    expect(mocks.db.etsyListing.findFirst).not.toHaveBeenCalled(); expect(mocks.createApi).not.toHaveBeenCalled();
  });
  it('does not overwrite assignment metadata if wording changed after the listing body was prepared', async () => {
    const expected = await getEffectiveListingDelivery(context, 'print');
    settings[0].deliveryInformation = 'New template wording entered during upload';
    await expect(recordDeliveryAssignmentMetadata(context, 'print', '500', { expected, baseDescription: 'Original', managedDescription: 'Original\n\nDelivery\nOld wording' })).rejects.toMatchObject({ status: 409 });
    expect(mocks.db.deliveryAssignmentSync.upsert).not.toHaveBeenCalled();
  });
  it('does not clear a fresh description conflict that appeared after preparing the remote listing', async () => {
    const expected = await getEffectiveListingDelivery(context, 'print');
    mocks.db.deliveryAssignmentSync.findUnique.mockResolvedValue({ status: 'CONFLICT', error: 'The seller changed the remote description while images uploaded' });
    await expect(markDeliveryAssignmentSynced(context, 'print', '500', { expected })).rejects.toMatchObject({ status: 409 });
    expect(mocks.db.deliveryAssignmentSync.upsert).not.toHaveBeenCalled();
    expect(mocks.db.deliveryAssignmentSync.updateMany).not.toHaveBeenCalled();
  });
  it('leaves changed settings pending instead of marking a newer template selection synced', async () => {
    const expected = await getEffectiveListingDelivery(context, 'print');
    profiles.push(profileRow({ id: 2, etsyShippingProfileId: '999' }));
    settings[0].printProfileId = 2;
    await expect(markDeliveryAssignmentSynced(context, 'print', '500', { expected })).rejects.toMatchObject({ status: 409 });
    expect(mocks.db.deliveryAssignmentSync.updateMany).not.toHaveBeenCalled();
    expect(mocks.db.deliveryAssignmentSync.upsert).not.toHaveBeenCalled();
  });
  it('marks the same prepared settings synced after the physical listing succeeds', async () => {
    const expected = await getEffectiveListingDelivery(context, 'print');
    await markDeliveryAssignmentSynced(context, 'print', '500', { expected });
    expect(mocks.db.deliveryAssignmentSync.updateMany).toHaveBeenCalledWith(expect.objectContaining({ where: expect.objectContaining({ listingId: 51, variant: 'print' }), data: expect.objectContaining({ status: 'SYNCED', profileRevision: 2 }) }));
  });
  it('template changes preserve an unresolved remote-description conflict', async () => {
    mocks.db.deliveryAssignmentSync.findUnique.mockResolvedValue({ status: 'CONFLICT', error: 'The seller changed the Etsy description' });
    await saveTemplateMarketsDelivery('10', { printProfileId: '1', customisedProfileId: '1', includeDeliveryInformation: true, deliveryInformation: 'New template wording' });
    expect(mocks.db.deliveryAssignmentSync.upsert).toHaveBeenCalledTimes(2);
    expect(mocks.db.deliveryAssignmentSync.upsert.mock.calls.every(([call]) => call.update.status === 'CONFLICT' && call.update.error === 'The seller changed the Etsy description')).toBe(true);
  });
  it('only explicit description-overwrite confirmation clears that conflict', async () => {
    mocks.db.deliveryAssignmentSync.findUnique.mockResolvedValue({ status: 'CONFLICT', error: 'Remote description changed' });
    await saveListingMarketsDelivery(context, null, { confirmDescriptionOverwrite: true });
    expect(mocks.db.deliveryAssignmentSync.upsert).toHaveBeenCalledTimes(2);
    expect(mocks.db.deliveryAssignmentSync.upsert.mock.calls.every(([call]) => call.update.status === 'PENDING' && call.update.error === null)).toBe(true);
  });
  it('pending rows record the newly selected physical profiles instead of stale assignment IDs', async () => {
    profiles.push(profileRow({ id: 2, etsyShippingProfileId: '999' }));
    await saveListingMarketsDelivery(context, { printProfileId: '2', customisedProfileId: '1', includeDeliveryInformation: null, deliveryInformation: null });
    const created = mocks.db.deliveryAssignmentSync.upsert.mock.calls.map(([call]) => call.create);
    expect(created).toEqual(expect.arrayContaining([
      expect.objectContaining({ variant: 'print', profileId: 2 }), expect.objectContaining({ variant: 'customised', profileId: 1 }),
    ]));
  });
});
