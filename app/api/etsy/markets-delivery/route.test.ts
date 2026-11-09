import { beforeEach, describe, expect, it, vi } from 'vitest';
const service = vi.hoisted(() => ({ archiveDeliveryProfile: vi.fn(), duplicateDeliveryProfile: vi.fn(), getDeliveryProfileImpact: vi.fn(), getMarketsDeliveryPageData: vi.fn(), importDeliveryProfiles: vi.fn(), saveDeliveryProfile: vi.fn(), syncDeliveryProfile: vi.fn(),
  getListingMarketsDelivery: vi.fn(), saveListingMarketsDelivery: vi.fn(), getTemplateMarketsDelivery: vi.fn(), saveTemplateMarketsDelivery: vi.fn(), getMarketsDeliveryMetadata: vi.fn() }));
vi.mock('@/lib/markets-delivery', () => service);
import { EtsyDeliveryError } from '@/lib/etsy-delivery-api';
import { MarketsDeliveryError, validateDeliverySettings } from '@/lib/markets-delivery-core';
import { GET, POST } from './route';
import { GET as getListing, PUT as putListing } from './listing/route';
import { GET as getTemplate, PUT as putTemplate } from './template/route';
import { GET as getMetadata } from './metadata/route';

const rootUrl = 'http://localhost:3002/api/etsy/markets-delivery';
function mutation(body: unknown, suffix = '', method = 'POST', extraHeaders: Record<string, string> = {}) {
  return new Request(`${rootUrl}${suffix}`, { method, headers: { 'Content-Type': 'application/json', Origin: 'http://localhost:3002', ...extraHeaders }, body: JSON.stringify(body) });
}
const context = { shopId: '100', sectionId: '2', subSectionId: '3', listingId: '51' };
beforeEach(() => {
  vi.resetAllMocks(); service.getMarketsDeliveryPageData.mockResolvedValue({ shopId: '100', profiles: [] }); service.getDeliveryProfileImpact.mockResolvedValue([]);
  service.importDeliveryProfiles.mockResolvedValue(2); service.getListingMarketsDelivery.mockResolvedValue({}); service.saveListingMarketsDelivery.mockResolvedValue({});
  service.getTemplateMarketsDelivery.mockResolvedValue({}); service.saveTemplateMarketsDelivery.mockResolvedValue({}); service.getMarketsDeliveryMetadata.mockResolvedValue({ countries: [], readinessProfiles: [] });
});

describe('Markets & Delivery HTTP security', () => {
  it.each([
    { origin: 'https://unrelated.example' },
    { origin: 'null' },
    { origin: 'http://localhost:3003' },
    { 'sec-fetch-site': 'cross-site' },
  ] as Record<string, string>[])('rejects cross-origin requests before any mutation: %j', async (headers) => {
    const response = await POST(mutation({ action: 'sync', shopId: '100', profileId: '1' }, '', 'POST', headers));
    expect(response.status).toBe(403); expect(service.syncDeliveryProfile).not.toHaveBeenCalled(); expect(service.getMarketsDeliveryPageData).not.toHaveBeenCalled();
  });
  it('applies the same origin protection to listing and template saves', async () => {
    expect((await putListing(mutation({ ...context, settings: null }, '/listing', 'PUT', { Origin: 'https://foreign.example' }))).status).toBe(403);
    expect((await putTemplate(mutation({ shopId: '100', templateId: '10', settings: null }, '/template', 'PUT', { Origin: 'https://foreign.example' }))).status).toBe(403);
    expect(service.saveListingMarketsDelivery).not.toHaveBeenCalled(); expect(service.saveTemplateMarketsDelivery).not.toHaveBeenCalled();
  });
  it.each(['text/plain', 'application/x-www-form-urlencoded'])('rejects non-JSON mutation content %s', async (contentType) => {
    expect((await POST(mutation({ action: 'import', shopId: '100' }, '', 'POST', { 'Content-Type': contentType }))).status).toBe(415);
    expect(service.importDeliveryProfiles).not.toHaveBeenCalled();
  });
  it('rejects invalid JSON, array bodies, and oversized payloads', async () => {
    const invalid = new Request(rootUrl, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{invalid' });
    expect((await POST(invalid)).status).toBe(400);
    expect((await POST(mutation([]))).status).toBe(400);
    expect((await POST(mutation({ action: 'create', shopId: '100', padding: 'x'.repeat(200001) }))).status).toBe(413);
    expect(service.saveDeliveryProfile).not.toHaveBeenCalled();
  });
  it.each(['../1', '0', '1 OR 1=1', '-1'])('rejects unsafe shop identifiers %s', async (shopId) => {
    expect((await POST(mutation({ action: 'import', shopId }))).status).toBe(400);
    expect(service.importDeliveryProfiles).not.toHaveBeenCalled();
  });
  it('does not expose unexpected errors or secret exception contents', async () => {
    service.importDeliveryProfiles.mockRejectedValue(new Error('Database password: secret-value'));
    const response = await POST(mutation({ action: 'import', shopId: '100' }));
    expect(response.status).toBe(500); expect(JSON.stringify(await response.json())).not.toContain('secret-value');
  });
});

describe('delivery action routing and explicit conflict resolution', () => {
  it('passes a normal local create through the local repository only', async () => {
    const values = { name: 'Local rates' };
    expect((await POST(mutation({ action: 'create', shopId: '100', values }))).status).toBe(200);
    expect(service.saveDeliveryProfile).toHaveBeenCalledWith('100', values); expect(service.syncDeliveryProfile).not.toHaveBeenCalled();
  });
  it('preserves expected revision and affected-listing confirmation for local updates', async () => {
    const values = { name: 'Updated' };
    expect((await POST(mutation({ action: 'update', shopId: '100', profileId: '1', expectedRevision: 2, confirmAffected: true, values }))).status).toBe(200);
    expect(service.saveDeliveryProfile).toHaveBeenCalledWith('100', values, '1', 2, true);
  });
  it('returns affected listings before a profile mutation', async () => {
    service.getDeliveryProfileImpact.mockResolvedValue([{ listingId: '51' }]);
    const response = await POST(mutation({ action: 'impact', shopId: '100', profileId: '1', values: { name: 'Preview' } }));
    expect(await response.json()).toEqual({ affectedListings: [{ listingId: '51' }] });
    expect(service.saveDeliveryProfile).not.toHaveBeenCalled(); expect(service.syncDeliveryProfile).not.toHaveBeenCalled();
  });
  it('passes explicit Keep local and Sync permission only to the chosen profile', async () => {
    expect((await POST(mutation({ action: 'sync', shopId: '100', profileId: '1', expectedRevision: 2, confirmAffected: true, resolveConflict: 'overwrite' }))).status).toBe(200);
    expect(service.syncDeliveryProfile).toHaveBeenCalledWith('100', '1', { expectedRevision: 2, confirmAffected: true, resolveConflict: 'overwrite' });
  });
  it('bulk import cannot request discarding pending changes', async () => {
    expect((await POST(mutation({ action: 'import', shopId: '100', resolveConflict: true }))).status).toBe(400);
    expect(service.importDeliveryProfiles).not.toHaveBeenCalled();
  });
  it('requires a selected profile and an explicit reload confirmation to discard local rate edits', async () => {
    expect((await POST(mutation({ action: 'reload-remote', shopId: '100', profileId: '1' }))).status).toBe(400);
    expect((await POST(mutation({ action: 'reload-remote', shopId: '100', resolveConflict: 'import' }))).status).toBe(400);
    expect(service.importDeliveryProfiles).not.toHaveBeenCalled();
    expect((await POST(mutation({ action: 'reload-remote', shopId: '100', profileId: '1', resolveConflict: 'import' }))).status).toBe(200);
    expect(service.importDeliveryProfiles).toHaveBeenCalledWith('100', { profileId: '1', resolveConflict: true });
  });
  it.each(['delete', 'publish', 'unknown'])('rejects unsupported remote action %s', async (action) => {
    expect((await POST(mutation({ action, shopId: '100', profileId: '1' }))).status).toBe(400);
    expect(service.archiveDeliveryProfile).not.toHaveBeenCalled(); expect(service.syncDeliveryProfile).not.toHaveBeenCalled();
  });
  it('passes the selected shop to page loading', async () => {
    expect((await GET(new Request(`${rootUrl}?shopId=100`))).status).toBe(200);
    expect(service.getMarketsDeliveryPageData).toHaveBeenCalledWith('100');
  });
});

describe('listing and template delivery routes', () => {
  it('retains complete listing context and explicit reset semantics', async () => {
    expect((await putListing(mutation({ ...context, settings: null }, '/listing', 'PUT'))).status).toBe(200);
    expect(service.saveListingMarketsDelivery).toHaveBeenCalledWith(context, null, { confirmDescriptionOverwrite: false });
    expect((await getListing(new Request(`${rootUrl}/listing?shopId=100&sectionId=2&subSectionId=3&listingId=51`))).status).toBe(200);
    expect(service.getListingMarketsDelivery).toHaveBeenCalledWith(context);
  });
  it('maps malformed settings validation to a 400 response', async () => {
    service.saveListingMarketsDelivery.mockImplementation(async (_context, settings) => validateDeliverySettings(settings));
    const response = await putListing(mutation({ ...context, settings: { printProfileId: '../foreign', customisedProfileId: null, includeDeliveryInformation: null, deliveryInformation: null } }, '/listing', 'PUT'));
    expect(response.status).toBe(400);
  });
  it('passes explicit remote-description overwrite confirmation through unchanged', async () => {
    await putListing(mutation({ ...context, settings: null, confirmDescriptionOverwrite: true }, '/listing', 'PUT'));
    expect(service.saveListingMarketsDelivery).toHaveBeenCalledWith(context, null, { confirmDescriptionOverwrite: true });
  });
  it('requires shop context and passes it to both template reads and saves', async () => {
    expect((await getTemplate(new Request(`${rootUrl}/template?templateId=10`))).status).toBe(400);
    expect(service.getTemplateMarketsDelivery).not.toHaveBeenCalled();
    expect((await getTemplate(new Request(`${rootUrl}/template?shopId=100&templateId=10`))).status).toBe(200);
    expect(service.getTemplateMarketsDelivery).toHaveBeenCalledWith('10', '100');
    expect((await putTemplate(mutation({ shopId: '100', templateId: '10', settings: null }, '/template', 'PUT'))).status).toBe(200);
    expect(service.saveTemplateMarketsDelivery).toHaveBeenCalledWith('10', null, '100');
  });
  it('preserves repository cross-shop denials as 404 responses', async () => {
    service.saveTemplateMarketsDelivery.mockRejectedValue(new MarketsDeliveryError('Template not found in this shop.', 404));
    expect((await putTemplate(mutation({ shopId: '100', templateId: '22', settings: null }, '/template', 'PUT'))).status).toBe(404);
  });
  it('returns country and readiness metadata only for a valid selected shop', async () => {
    expect((await getMetadata(new Request(`${rootUrl}/metadata`))).status).toBe(400);
    expect(service.getMarketsDeliveryMetadata).not.toHaveBeenCalled();
    expect((await getMetadata(new Request(`${rootUrl}/metadata?shopId=100`))).status).toBe(200);
    expect(service.getMarketsDeliveryMetadata).toHaveBeenCalledWith('100');
  });
});

describe('actionable Etsy error responses', () => {
  it.each([
    ['permission', 403], ['authentication', 401], ['conflict', 409], ['ambiguous_create', 409], ['validation', 400], ['network', 502],
  ] as const)('maps %s to HTTP %s', async (code, status) => {
    service.syncDeliveryProfile.mockRejectedValue(new EtsyDeliveryError('Reconnect Etsy or review the saved changes.', code));
    const response = await POST(mutation({ action: 'sync', shopId: '100', profileId: '1' }));
    expect(response.status).toBe(status); expect(await response.json()).toEqual({ error: 'Reconnect Etsy or review the saved changes.' });
  });
  it('preserves Etsy rate-limit guidance in the response header', async () => {
    service.syncDeliveryProfile.mockRejectedValue(new EtsyDeliveryError('Rate limit reached', 'rate_limit', 429, 90));
    const response = await POST(mutation({ action: 'sync', shopId: '100', profileId: '1' }));
    expect(response.status).toBe(429); expect(response.headers.get('Retry-After')).toBe('90');
  });
});
