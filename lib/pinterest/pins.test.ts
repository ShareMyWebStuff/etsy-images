import { createHash } from 'node:crypto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { PinterestApiError } from './types';

const mocks = vi.hoisted(() => ({ query: vi.fn(), read: vi.fn(), listing: vi.fn(), pin: vi.fn(), due: vi.fn(), counts: vi.fn(), connection: vi.fn(), etsy: vi.fn(), claim: vi.fn(), update: vi.fn(), remove: vi.fn(), api: vi.fn() }));
vi.mock('@/lib/prisma', () => ({ prisma: {
  $queryRaw: mocks.query,
  etsyListing: { findUnique: mocks.listing },
  pinterestPin: { findUnique: mocks.pin, findMany: mocks.due, groupBy: mocks.counts, updateMany: mocks.claim, update: mocks.update, delete: mocks.remove },
  pinterestConnection: { findUnique: mocks.connection },
} }));
vi.mock('@/lib/s3-listing-storage', () => ({ readFile: mocks.read }));
vi.mock('./client', async (original) => ({ ...await original<typeof import('./client')>(), pinterestRequest: mocks.api }));
vi.mock('@/lib/etsy-oauth', () => ({ getValidEtsyAccessToken: async () => 'test-etsy-token', getEtsyKeystring: () => 'test-etsy-key' }));

import { deletePin, imageMediaSource, pinterestPublicationDay, processDuePins, publishPin } from './pins';
import { PinterestRequestUncertainError } from './client';

const bytes = Buffer.from('dedicated creative bytes');
const key = `.pinterest-creatives/42/${createHash('sha256').update(bytes).digest('hex')}.png`;
const draft = { id: 7, listingId: 42, imageId: 8, status: 'DRAFT', pinterestPinId: null, updatedAt: new Date('2026-11-16T10:00:00Z'), destinationUrl: 'https://www.etsy.com/listing/123/product',
  boardId: 1, board: { pinterestBoardId: 'board-123' }, listing: { etsyId: '123', etsyCustomisedId: null, etsyDownloadId: null },
  title: 'Woodland nursery print', description: 'A real product.' };
const invalidDescriptions = [
  { label: 'empty copy', description: '' },
  { label: 'whitespace-only copy', description: ' \n\t ' },
  { label: '501 ASCII characters', description: 'A'.repeat(501) },
  { label: '501 Unicode characters', description: '🌿'.repeat(500) + '.' },
];

beforeEach(() => {
  vi.resetAllMocks();
  vi.stubEnv('DATABASE_URL', `publisher-unit-test-${process.pid}`);
  vi.stubEnv('PINTEREST_ENVIRONMENT', 'production');
  vi.stubEnv('ETSY_SHARED_SECRET', 'test-secret');
  vi.stubGlobal('fetch', mocks.etsy);
  mocks.etsy.mockImplementation(async () => Response.json({ listing_id: 123, state: 'active' }));
  mocks.connection.mockResolvedValue({ environment: 'production' });
  mocks.counts.mockResolvedValue([]);
  mocks.query.mockResolvedValue([{ id: 7, listingId: 42, creativeStorageKey: key }]);
  mocks.read.mockResolvedValue(bytes);
  mocks.pin.mockResolvedValue(draft);
  mocks.claim.mockResolvedValue({ count: 1 });
  mocks.due.mockResolvedValue([]);
  mocks.api.mockImplementation(async (endpoint: string) => endpoint.startsWith('/boards/') ? { id: 'board-123', name: 'Woodland' } : { id: 'remote-pin' });
  mocks.update.mockImplementation(async ({ data }) => ({ ...draft, ...data }));
  mocks.listing.mockResolvedValue({ id: 42, images: [{ id: 8, urlFullxFull: 'https://example.com/source.png' }] });
});
afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs(); });

function publicationClaims() {
  return mocks.claim.mock.calls.filter(([call]) => call.data.status === 'PUBLISHING');
}

function duePins(rows: Array<{ id: number; boardId: number }>, plans: Array<{ boardId: number; campaign: { pinsPerDay: number } }> = []) {
  mocks.due.mockImplementation(async ({ select }) => select?.campaign ? plans : rows);
}

describe('Pin media selection', () => {
  it('prefers the dedicated creative over the original Etsy source image', async () => {
    await expect(imageMediaSource(42, 8, 7)).resolves.toEqual({ source_type: 'image_base64', content_type: 'image/png', data: bytes.toString('base64') });
    expect(mocks.listing).not.toHaveBeenCalled();
  });

  it('never falls back to the Etsy image when an attached creative is unavailable', async () => {
    mocks.read.mockRejectedValue(new Error('Missing private object'));
    await expect(imageMediaSource(42, 8, 7)).rejects.toThrow('creative image is unavailable');
    expect(mocks.listing).not.toHaveBeenCalled();
  });

  it('rejects a creative attached to another listing before reading it', async () => {
    await expect(imageMediaSource(43, 8, 7)).rejects.toThrow('does not belong');
    expect(mocks.read).not.toHaveBeenCalled();
    expect(mocks.listing).not.toHaveBeenCalled();
  });

  it('keeps the selected source image fallback for Pins without a dedicated creative', async () => {
    mocks.query.mockResolvedValue([]);
    mocks.listing.mockResolvedValue({ id: 42, images: [{ id: 1, urlFullxFull: 'https://example.com/cover.png' }, { id: 8, urlFullxFull: 'https://example.com/source.png' }] });
    await expect(imageMediaSource(42, 8, 7)).resolves.toEqual({ source_type: 'image_url', url: 'https://example.com/source.png' });
    expect(mocks.read).not.toHaveBeenCalled();
  });

  it('keeps base64 fallback for source images held only in private listing storage', async () => {
    mocks.query.mockResolvedValue([]);
    mocks.listing.mockResolvedValue({ id: 42, localDirectoryName: 'Fox', images: [{ id: 8, localFileName: 'source.png' }],
      subSection: { name: 'Single', shopSection: { title: 'Woodland', shop: { shopName: 'Real Shop', etsyShopId: 66n } } } });
    await expect(imageMediaSource(42, 8, 7)).resolves.toEqual({ source_type: 'image_base64', content_type: 'image/png', data: bytes.toString('base64') });
    expect(String(mocks.read.mock.calls[0][0]).replaceAll('\\', '/')).toContain('/Real Shop/Woodland/Fox/source.png');
  });
});

describe('publishing a Pin with a dedicated creative', () => {
  it.each(invalidDescriptions)('rejects $label before any remote call or Pin mutation', async ({ description }) => {
    mocks.pin.mockResolvedValue({ ...draft, description });

    await expect(publishPin(7)).rejects.toThrow();

    expect(mocks.api).not.toHaveBeenCalled();
    expect(mocks.claim).not.toHaveBeenCalled();
    expect(mocks.update).not.toHaveBeenCalled();
    expect(mocks.read).not.toHaveBeenCalled();
  });

  it('accepts exactly 500 Unicode characters without clipping the saved description', async () => {
    const description = '🌿'.repeat(499) + '.';
    expect(Array.from(description)).toHaveLength(500);
    expect(description.length).toBeGreaterThan(500);
    mocks.pin.mockResolvedValue({ ...draft, description });

    await publishPin(7);

    const [, init] = mocks.api.mock.calls.find(([endpoint]) => endpoint === '/pins')!;
    expect(JSON.parse(init.body).description).toBe(description);
    expect(mocks.claim).toHaveBeenCalledWith(expect.objectContaining({ where: expect.objectContaining({ description }) }));
  });

  it('publishes the exact saved copy, retaining its whitespace and line breaks', async () => {
    const description = '  Gentle fox nursery art.\nChoose a framed or unframed print.  ';
    mocks.pin.mockResolvedValue({ ...draft, description });

    await publishPin(7);

    const [, init] = mocks.api.mock.calls.find(([endpoint]) => endpoint === '/pins')!;
    expect(JSON.parse(init.body).description).toBe(description);
    expect(mocks.claim.mock.calls[0][0].data).not.toHaveProperty('description');
    expect(mocks.update.mock.calls[0][0].data).not.toHaveProperty('description');
  });

  it('does not publish stale copy when the description changes during the board check', async () => {
    const initialDescription = draft.description;
    let savedDescription = initialDescription;
    mocks.pin.mockResolvedValue({ ...draft });
    mocks.api.mockImplementation(async (endpoint: string) => {
      if (endpoint.startsWith('/boards/')) {
        savedDescription = 'The revised description saved in another review window.';
        return { id: 'board-123', name: 'Woodland' };
      }
      return { id: 'remote-pin' };
    });
    mocks.claim.mockImplementation(async ({ where }) => ({ count: where.description === savedDescription ? 1 : 0 }));

    await expect(publishPin(7)).rejects.toThrow('state changed');

    expect(mocks.claim.mock.calls[0][0].where.description).toBe(initialDescription);
    expect(savedDescription).toBe('The revised description saved in another review window.');
    expect(mocks.api.mock.calls).toEqual([['/boards/board-123', { method: 'GET' }]]);
    expect(mocks.update).not.toHaveBeenCalled();
    expect(mocks.read).not.toHaveBeenCalled();
  });

  it('sends the attached creative and records the Pinterest result', async () => {
    await publishPin(7);
    expect(mocks.api).toHaveBeenCalledTimes(2);
    expect(mocks.api.mock.calls[0]).toEqual(['/boards/board-123', { method: 'GET' }]);
    expect(mocks.api.mock.invocationCallOrder[0]).toBeLessThan(mocks.claim.mock.invocationCallOrder[0]);
    const [endpoint, init] = mocks.api.mock.calls[1];
    expect(endpoint).toBe('/pins');
    expect(JSON.parse(init.body)).toMatchObject({
      board_id: 'board-123', link: draft.destinationUrl,
      media_source: { source_type: 'image_base64', content_type: 'image/png', data: bytes.toString('base64') },
    });
    expect(mocks.update).toHaveBeenLastCalledWith({ where: { id: 7 }, data: expect.objectContaining({ pinterestPinId: 'remote-pin', status: 'PUBLISHED' }) });
    expect(mocks.listing).not.toHaveBeenCalled();
  });

  it('records a missing creative as a failure without posting a source image to Pinterest', async () => {
    mocks.read.mockRejectedValue(new Error('S3 missing private creative'));
    await expect(publishPin(7)).rejects.toThrow('creative image is unavailable');
    expect(mocks.api.mock.calls).toEqual([['/boards/board-123', { method: 'GET' }]]);
    expect(mocks.listing).not.toHaveBeenCalled();
    expect(mocks.claim).toHaveBeenLastCalledWith({ where: { id: 7, status: 'PUBLISHING', pinterestPinId: null }, data: expect.objectContaining({ status: 'FAILED', retryCount: { increment: 1 } }) });
  });

  it('does not repost an already published Pin or reread its image', async () => {
    const published = { ...draft, pinterestPinId: 'existing-remote' };
    mocks.pin.mockResolvedValue(published);
    await expect(publishPin(7)).resolves.toEqual(published);
    expect(mocks.query).not.toHaveBeenCalled();
    expect(mocks.api).not.toHaveBeenCalled();
    expect(mocks.update).not.toHaveBeenCalled();
    expect(mocks.claim).not.toHaveBeenCalled();
  });

  it.each(['missing', 'wrong ID'] as const)('blocks publication when the current connection returns a %s board before changing Pin status', async (failure) => {
    if (failure === 'missing') mocks.api.mockRejectedValue(new PinterestApiError('Not found', 404));
    else mocks.api.mockResolvedValue({ id: 'another-board', name: 'Other' });
    await expect(publishPin(7)).rejects.toThrow('not available to the current connection');
    expect(mocks.api.mock.calls).toEqual([['/boards/board-123', { method: 'GET' }]]);
    expect(mocks.update).not.toHaveBeenCalled();
    expect(mocks.claim).not.toHaveBeenCalled();
    expect(mocks.query).not.toHaveBeenCalled();
    expect(mocks.read).not.toHaveBeenCalled();
  });

  it('rejects a duplicate manual publication already in progress without calling Pinterest', async () => {
    mocks.pin.mockResolvedValue({ ...draft, status: 'PUBLISHING' });
    await expect(publishPin(7)).rejects.toThrow('already being published');
    expect(mocks.api).not.toHaveBeenCalled();
    expect(mocks.claim).not.toHaveBeenCalled();
    expect(mocks.update).not.toHaveBeenCalled();
  });

  it('prevents a second manual publication when another request claims it first', async () => {
    mocks.claim.mockResolvedValue({ count: 0 });
    await expect(publishPin(7)).rejects.toThrow('already being published or its state changed');
    expect(mocks.api.mock.calls).toEqual([['/boards/board-123', { method: 'GET' }]]);
    expect(mocks.claim).toHaveBeenCalledWith(expect.objectContaining({ where: { id: 7, pinterestPinId: null, description: draft.description, updatedAt: draft.updatedAt, status: { not: 'PUBLISHING' } } }));
    expect(mocks.update).not.toHaveBeenCalled();
    expect(mocks.read).not.toHaveBeenCalled();
  });

  it('allows an intentional manual publication of a paused Pin', async () => {
    mocks.pin.mockResolvedValue({ ...draft, status: 'PAUSED' });
    await publishPin(7);
    expect(mocks.api).toHaveBeenCalledWith('/pins', expect.objectContaining({ method: 'POST' }));
  });

  it('preserves a known remote ID for review if local finalisation fails after Pinterest creates the Pin', async () => {
    mocks.update.mockRejectedValue(new Error('Database unavailable during finalisation'));
    await expect(publishPin(7)).rejects.toBeInstanceOf(PinterestRequestUncertainError);
    expect(mocks.api.mock.calls.filter(([endpoint]) => endpoint === '/pins')).toHaveLength(1);
    expect(mocks.claim).toHaveBeenLastCalledWith(expect.objectContaining({ data: expect.objectContaining({
      status: 'PAUSED', pinterestPinId: 'remote-pin', publishedAt: expect.any(Date), error: expect.stringContaining('Publication outcome uncertain.'),
    }) }));
  });
});

describe('scheduled Pin publication claims', () => {
  it.each(invalidDescriptions)('fails scheduled $label without contacting Pinterest so it cannot starve later rows', async ({ description }) => {
    mocks.due.mockResolvedValue([{ id: 7, boardId: 1, status: 'SCHEDULED' }]);
    mocks.pin.mockResolvedValue({ ...draft, status: 'SCHEDULED', description });

    const result = await processDuePins();

    expect(result).toEqual([{ id: 7, ok: false, error: expect.any(String) }]);
    expect(publicationClaims()).toHaveLength(0);
    expect(mocks.claim).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ status: 'FAILED' }) }));
    expect(mocks.api).not.toHaveBeenCalled();
    expect(mocks.update).not.toHaveBeenCalled();
    expect(mocks.read).not.toHaveBeenCalled();
  });

  it('skips a Pin paused after the worker loaded its queue but before the atomic claim', async () => {
    mocks.due.mockResolvedValue([{ id: 7, boardId: 1, status: 'SCHEDULED' }]);
    mocks.pin.mockResolvedValue({ ...draft, status: 'SCHEDULED' });
    mocks.claim.mockResolvedValue({ count: 0 });
    await expect(processDuePins()).resolves.toEqual([{ id: 7, ok: true, skipped: true }]);
    expect(mocks.claim).toHaveBeenCalledWith({
      where: { id: 7, status: 'SCHEDULED', scheduledAt: { gte: expect.any(Date), lte: expect.any(Date) }, pinterestPinId: null, description: draft.description, updatedAt: draft.updatedAt },
      data: { status: 'PUBLISHING', error: null },
    });
    expect(mocks.api).not.toHaveBeenCalled();
    expect(mocks.read).not.toHaveBeenCalled();
    expect(mocks.update).not.toHaveBeenCalled();
  });

  it('skips a Pin already paused when reloaded even if an earlier queue snapshot included it', async () => {
    mocks.due.mockResolvedValue([{ id: 7, boardId: 1, status: 'SCHEDULED' }]);
    mocks.pin.mockResolvedValue({ ...draft, status: 'PAUSED' });
    await expect(processDuePins()).resolves.toEqual([{ id: 7, ok: true, skipped: true }]);
    expect(publicationClaims()).toHaveLength(0);
    expect(mocks.api).not.toHaveBeenCalled();
  });

  it('claims a due scheduled Pin before checking the board and posting it once', async () => {
    mocks.due.mockResolvedValue([{ id: 7, boardId: 1, status: 'SCHEDULED' }]);
    mocks.pin.mockResolvedValue({ ...draft, status: 'SCHEDULED' });
    await expect(processDuePins()).resolves.toEqual([{ id: 7, ok: true }]);
    expect(mocks.claim).toHaveBeenCalledWith({
      where: { id: 7, status: 'SCHEDULED', scheduledAt: { gte: expect.any(Date), lte: expect.any(Date) }, pinterestPinId: null, description: draft.description, updatedAt: draft.updatedAt },
      data: { status: 'PUBLISHING', error: null },
    });
    expect(mocks.claim.mock.invocationCallOrder[0]).toBeLessThan(mocks.api.mock.invocationCallOrder[0]);
    expect(mocks.api.mock.calls.filter(([, init]) => init?.method === 'POST')).toHaveLength(1);
    expect(mocks.update).toHaveBeenLastCalledWith({ where: { id: 7 }, data: expect.objectContaining({ pinterestPinId: 'remote-pin', status: 'PUBLISHED' }) });
    expect(mocks.etsy).toHaveBeenCalledWith('https://openapi.etsy.com/v3/application/listings/123?legacy=false', expect.objectContaining({ signal: expect.anything() }));
  });

  it('does not publish early when a queued Pin has been moved to a later time', async () => {
    const future = new Date(Date.now() + 60 * 60_000);
    duePins([{ id: 7, boardId: 1 }]);
    mocks.pin.mockResolvedValue({ ...draft, status: 'SCHEDULED', scheduledAt: future });
    mocks.claim.mockImplementation(async ({ where, data }) => ({ count: data.status === 'PUBLISHING' && where.scheduledAt.lte >= future ? 1 : 0 }));
    expect(await processDuePins()).toEqual([{ id: 7, ok: true, skipped: true }]);
    expect(mocks.api).not.toHaveBeenCalled();
    expect(mocks.etsy).not.toHaveBeenCalled();
  });
});

describe('deleting Pinterest Pins', () => {
  it('checks the current board before deleting a published Pin and its local row', async () => {
    mocks.pin.mockResolvedValue({ ...draft, pinterestPinId: 'remote-pin' });
    await expect(deletePin(7)).resolves.toEqual({ deleted: true });
    expect(mocks.api.mock.calls).toEqual([
      ['/boards/board-123', { method: 'GET' }], ['/pins/remote-pin', { method: 'DELETE' }],
    ]);
    expect(mocks.remove).toHaveBeenCalledWith({ where: { id: 7 } });
    expect(mocks.api.mock.invocationCallOrder[1]).toBeLessThan(mocks.remove.mock.invocationCallOrder[0]);
  });

  it('keeps the local Pin when its board is unavailable on the current connection', async () => {
    mocks.pin.mockResolvedValue({ ...draft, pinterestPinId: 'remote-pin' });
    mocks.api.mockRejectedValue(new PinterestApiError('Not found', 404));
    await expect(deletePin(7)).rejects.toThrow('not available to the current connection');
    expect(mocks.api.mock.calls).toEqual([['/boards/board-123', { method: 'GET' }]]);
    expect(mocks.remove).not.toHaveBeenCalled();
  });

  it('can delete a local-only draft without accessing any remote board or Pin', async () => {
    await expect(deletePin(7)).resolves.toEqual({ deleted: true });
    expect(mocks.api).not.toHaveBeenCalled();
    expect(mocks.remove).toHaveBeenCalledWith({ where: { id: 7 } });
  });
});

describe('automatic publisher runtime safeguards', () => {
  const now = new Date('2026-11-17T10:00:00Z');

  it('uses London calendar days across spring and autumn clock changes', () => {
    expect(pinterestPublicationDay(new Date('2026-03-29T12:00:00Z'))).toEqual({ start: new Date('2026-03-29T00:00:00Z'), end: new Date('2026-03-29T23:00:00Z') });
    expect(pinterestPublicationDay(new Date('2026-10-25T12:00:00Z'))).toEqual({ start: new Date('2026-10-24T23:00:00Z'), end: new Date('2026-10-26T00:00:00Z') });
  });

  it('refuses automatic publication outside a matching production connection', async () => {
    vi.stubEnv('PINTEREST_ENVIRONMENT', 'sandbox');
    await expect(processDuePins()).rejects.toThrow('only runs in production');
    expect(mocks.due).not.toHaveBeenCalled();
    vi.stubEnv('PINTEREST_ENVIRONMENT', 'production');
    mocks.connection.mockResolvedValue({ environment: 'sandbox' });
    await expect(processDuePins()).rejects.toThrow('Connect Pinterest in production');
    expect(mocks.claim).not.toHaveBeenCalled();
  });

  it('previews due Pins without mutations, token refreshes or external requests', async () => {
    duePins([{ id: 7, boardId: 1 }]);
    await expect(processDuePins(5, { dryRun: true, now })).resolves.toEqual([{ id: 7, ok: true, skipped: true }]);
    expect(mocks.claim).not.toHaveBeenCalled();
    expect(mocks.update).not.toHaveBeenCalled();
    expect(mocks.api).not.toHaveBeenCalled();
    expect(mocks.etsy).not.toHaveBeenCalled();
    expect(mocks.due.mock.calls[0][0].where.scheduledAt).toEqual({ gte: new Date('2026-11-17T00:00:00Z'), lte: now });
  });

  it('previews at most five due Pins per run while allowing seven boards to finish in the next run', async () => {
    duePins(Array.from({ length: 7 }, (_, index) => ({ id: index + 1, boardId: index + 1 })));
    expect(await processDuePins(20, { dryRun: true, now })).toHaveLength(5);
  });

  it('respects the highest active campaign rate, including future four-per-day campaigns', async () => {
    duePins([{ id: 7, boardId: 1 }, { id: 8, boardId: 1 }, { id: 9, boardId: 1 }], [
      { boardId: 1, campaign: { pinsPerDay: 2 } }, { boardId: 1, campaign: { pinsPerDay: 4 } },
    ]);
    mocks.counts.mockResolvedValue([{ boardId: 1, _count: { _all: 2 } }]);
    expect(await processDuePins(5, { dryRun: true, now })).toEqual([{ id: 7, ok: true, skipped: true }, { id: 8, ok: true, skipped: true }]);
    expect(mocks.due.mock.calls[1][0].where.campaign).toEqual({ status: 'ACTIVE' });
  });

  it('uses a campaign rate of one rather than silently defaulting it to two', async () => {
    duePins([{ id: 7, boardId: 1 }, { id: 8, boardId: 1 }], [{ boardId: 1, campaign: { pinsPerDay: 1 } }]);
    expect(await processDuePins(5, { dryRun: true, now })).toEqual([{ id: 7, ok: true, skipped: true }]);
  });

  it('pauses past-day backlog and interrupted claims while leaving future schedules untouched', async () => {
    await processDuePins(5, { now });
    expect(mocks.claim).toHaveBeenCalledWith({ where: { status: 'SCHEDULED', scheduledAt: { lt: new Date('2026-11-17T00:00:00Z') } }, data: expect.objectContaining({ status: 'PAUSED' }) });
    expect(mocks.claim).toHaveBeenCalledWith({ where: { status: 'PUBLISHING', pinterestPinId: null, updatedAt: { lt: new Date('2026-11-17T09:30:00Z') } }, data: expect.objectContaining({ status: 'PAUSED' }) });
    expect(mocks.claim.mock.calls.every(([call]) => !Object.hasOwn(call.data, 'scheduledAt'))).toBe(true);
  });

  it.each(['inactive', 'deleted'])('fails an %s Etsy destination without posting to Pinterest', async (kind) => {
    duePins([{ id: 7, boardId: 1 }]);
    mocks.pin.mockResolvedValue({ ...draft, status: 'SCHEDULED' });
    mocks.etsy.mockResolvedValue(kind === 'inactive' ? Response.json({ listing_id: 123, state: 'inactive' }) : new Response(null, { status: 404 }));
    const results = await processDuePins(5, { now });
    expect(results[0]).toMatchObject({ id: 7, ok: false });
    expect(results[0]).not.toHaveProperty('deferred');
    expect(mocks.api.mock.calls.every(([endpoint]) => endpoint !== '/pins')).toBe(true);
    expect(mocks.claim).toHaveBeenLastCalledWith(expect.objectContaining({ data: expect.objectContaining({ status: 'FAILED' }) }));
  });

  it.each(['network', 'service', 'auth'])('defers %s Etsy failures instead of publishing or permanently dropping the Pin', async (kind) => {
    duePins([{ id: 7, boardId: 1 }]);
    mocks.pin.mockResolvedValue({ ...draft, status: 'SCHEDULED' });
    if (kind === 'network') mocks.etsy.mockRejectedValue(new TypeError('Network unavailable'));
    else mocks.etsy.mockResolvedValue(new Response(null, { status: kind === 'auth' ? 401 : 503 }));
    expect((await processDuePins(5, { now }))[0]).toMatchObject({ id: 7, ok: false, deferred: true });
    expect(mocks.api.mock.calls.every(([endpoint]) => endpoint !== '/pins')).toBe(true);
    expect(mocks.claim).toHaveBeenLastCalledWith(expect.objectContaining({ data: expect.objectContaining({ status: 'SCHEDULED' }) }));
  });

  it('fails a destination belonging to another artwork before contacting Etsy', async () => {
    duePins([{ id: 7, boardId: 1 }]);
    mocks.pin.mockResolvedValue({ ...draft, status: 'SCHEDULED', listing: { ...draft.listing, etsyId: '999' } });
    expect((await processDuePins(5, { now }))[0]).toMatchObject({ ok: false });
    expect(mocks.etsy).not.toHaveBeenCalled();
    expect(mocks.api.mock.calls.every(([endpoint]) => endpoint !== '/pins')).toBe(true);
  });

  it('continues after invalid copy so a later valid Pin is not starved', async () => {
    duePins([{ id: 7, boardId: 1 }, { id: 8, boardId: 1 }]);
    mocks.pin.mockResolvedValueOnce({ ...draft, status: 'SCHEDULED', description: '' }).mockResolvedValueOnce({ ...draft, id: 8, status: 'SCHEDULED' });
    expect(await processDuePins(5, { now })).toEqual([{ id: 7, ok: false, error: expect.any(String) }, { id: 8, ok: true }]);
    expect(mocks.api.mock.calls.filter(([endpoint]) => endpoint === '/pins')).toHaveLength(1);
  });

  it('pauses an uncertain POST result without retrying or allowing a same-board burst', async () => {
    duePins([{ id: 7, boardId: 1 }, { id: 8, boardId: 1 }, { id: 9, boardId: 1 }]);
    mocks.pin.mockImplementation(async ({ where }) => ({ ...draft, id: where.id, status: 'SCHEDULED' }));
    mocks.api.mockImplementation(async (endpoint: string) => {
      if (endpoint === '/pins') throw new PinterestRequestUncertainError();
      return { id: 'board-123', name: 'Woodland' };
    });
    const results = await processDuePins(5, { now });
    expect(results).toHaveLength(2);
    expect(results.every((result) => result.reviewRequired)).toBe(true);
    expect(mocks.api.mock.calls.filter(([endpoint]) => endpoint === '/pins')).toHaveLength(2);
    expect(mocks.claim).toHaveBeenLastCalledWith(expect.objectContaining({ data: expect.objectContaining({ status: 'PAUSED', error: expect.stringContaining('Publication outcome uncertain.') }) }));
  });

  it.each([400, 429])('handles a definite Pinterest HTTP %s rejection without treating it as an unknown creation', async (status) => {
    duePins([{ id: 7, boardId: 1 }]);
    mocks.pin.mockResolvedValue({ ...draft, status: 'SCHEDULED' });
    mocks.api.mockImplementation(async (endpoint: string) => {
      if (endpoint === '/pins') throw new PinterestApiError('Request rejected', status);
      return { id: 'board-123', name: 'Woodland' };
    });
    const [result] = await processDuePins(5, { now });
    expect(result).not.toHaveProperty('reviewRequired');
    expect(Boolean(result.deferred)).toBe(status === 429);
    expect(mocks.claim).toHaveBeenLastCalledWith(expect.objectContaining({ data: expect.objectContaining({ status: status === 429 ? 'SCHEDULED' : 'FAILED' }) }));
  });

  it('excludes concurrent automatic runs on the same database', async () => {
    duePins([{ id: 7, boardId: 1 }]);
    mocks.pin.mockResolvedValue({ ...draft, status: 'SCHEDULED' });
    let entered!: () => void;
    let resume!: () => void;
    const started = new Promise<void>((resolve) => { entered = resolve; });
    const waiting = new Promise<void>((resolve) => { resume = resolve; });
    mocks.api.mockImplementation(async (endpoint: string) => {
      if (endpoint.startsWith('/boards/')) { entered(); await waiting; return { id: 'board-123', name: 'Woodland' }; }
      return { id: 'remote-pin' };
    });
    const first = processDuePins(5, { now });
    await started;
    try { expect(await processDuePins(5, { now })).toEqual([]); }
    finally { resume(); }
    expect(await first).toEqual([{ id: 7, ok: true }]);
    expect(mocks.api.mock.calls.filter(([endpoint]) => endpoint === '/pins')).toHaveLength(1);
  });
});
