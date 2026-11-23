import sharp from 'sharp';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ prepare: vi.fn(), insert: vi.fn(), page: vi.fn() }));
vi.mock('@/lib/listing-zip-import', async (original) => ({ ...await original<typeof import('@/lib/listing-zip-import')>(),
  prepareListingZipReview: mocks.prepare, insertListingZipReviewRow: mocks.insert }));
vi.mock('@/lib/listing-table', () => ({ getSubSectionListingsPageData: mocks.page }));
import { ListingZipImportError, type ListingZipReviewPlan } from '@/lib/listing-zip-import';
import { actOnListingZipReview, closeListingZipReview, getListingZipReview, getListingZipReviewImage,
  LISTING_ZIP_REVIEW_LIMITS, startListingZipReview } from '@/lib/listing-zip-review';

const context = { shopId: '66615491', sectionId: '2', subSectionId: '3' };
let sessions: string[], plans: ListingZipReviewPlan[];
function plan() {
  return { input: context, context: {}, target: { name: 'Nursery Frames' }, productType: 'physical', rows: Array.from({ length: 3 }, (_, index) => ({
    rowNumber: index + 2, title: `Artwork ${index + 1}`, description: 'Description', relativeFilename: `${index}.png`, originalFileName: `${index}.png`,
    width: 80, height: 100, orientation: 'portrait', error: null, contents: Buffer.from(`image ${index}`), fileName: `import-${index}.png`, filePath: `listing/${index}.png`,
  })) } as unknown as ListingZipReviewPlan;
}
async function start() {
  const result = await startListingZipReview(context, '10', new File(['zip'], 'artwork.zip'));
  sessions.push(result.review.sessionId); return result.review;
}
function deferred<T>() { let resolve!: (value: T) => void; const promise = new Promise<T>((complete) => { resolve = complete; }); return { promise, resolve }; }

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date', 'setTimeout', 'clearTimeout'] }); vi.setSystemTime(new Date('2026-11-21T10:00:00Z'));
  vi.clearAllMocks(); sessions = []; plans = [];
  mocks.prepare.mockImplementation(async () => { const value = plan(); plans.push(value); return value; });
  mocks.insert.mockResolvedValue({ listingIds: ['100'] }); mocks.page.mockResolvedValue({ listings: [{ id: '100' }] });
});
afterEach(async () => {
  for (const id of sessions) await closeListingZipReview(context, id).catch(() => undefined);
  vi.useRealTimers();
});

describe('ZIP listing review sessions', () => {
  it('stages a private review without creating a listing or refreshing the table', async () => {
    const review = await start();
    expect(review).toMatchObject({ templateName: 'Nursery Frames', total: 3, cursor: 0, insertedCount: 0, skippedCount: 0,
      current: { index: 0, rowNumber: 2, title: 'Artwork 1', width: 80, height: 100, error: null } });
    expect(review.sessionId).toMatch(/^[a-f0-9-]{36}$/);
    expect(JSON.stringify(review)).not.toMatch(/image 0|filePath|contents/);
    expect(mocks.insert).not.toHaveBeenCalled(); expect(mocks.page).not.toHaveBeenCalled();
  });

  it('requires the complete original shop/section/subsection scope', async () => {
    const { sessionId } = await start();
    for (const field of ['shopId', 'sectionId', 'subSectionId'] as const) {
      await expect(getListingZipReview({ ...context, [field]: '99' }, sessionId)).rejects.toThrow(/selected section/);
    }
    expect((await getListingZipReview({ shopId: '00066615491', sectionId: '02', subSectionId: '03' }, sessionId)).review.cursor).toBe(0);
    await expect(getListingZipReview(context, '../unsafe')).rejects.toThrow(/active ZIP review/);
  });

  it('expires idle sessions with actionable status 410 and releases every remaining buffer', async () => {
    const value = plan(); value.rows[0].previewContents = Buffer.from('review preview');
    plans.push(value); mocks.prepare.mockResolvedValueOnce(value);
    const { sessionId } = await start(); await vi.advanceTimersByTimeAsync(LISTING_ZIP_REVIEW_LIMITS.ttlMs + 60_000);
    expect(plans[0].rows.every((row) => row.contents === undefined && row.previewContents === undefined)).toBe(true);
    try { await getListingZipReview(context, sessionId); throw new Error('Expected expiry'); }
    catch (error) { expect(error).toMatchObject({ status: 410, message: expect.stringMatching(/Choose the ZIP again/) }); }
    expect(mocks.insert).not.toHaveBeenCalled();
  });

  it('slides the expiry after review activity', async () => {
    const { sessionId } = await start(); await vi.advanceTimersByTimeAsync(29 * 60_000);
    const refreshed = (await getListingZipReview(context, sessionId)).review;
    await vi.advanceTimersByTimeAsync(2 * 60_000);
    expect((await getListingZipReview(context, sessionId)).review.current?.index).toBe(0);
    expect(new Date(refreshed.expiresAt).getTime()).toBe(Date.now() + 28 * 60_000);
  });

  it('skips exactly the expected row, drops its buffer and replays a duplicate Skip harmlessly', async () => {
    const { sessionId } = await start();
    expect((await actOnListingZipReview(context, sessionId, 0, 'skip')).review).toMatchObject({ cursor: 1, skippedCount: 1, insertedCount: 0 });
    expect(plans[0].rows[0].contents).toBeUndefined(); expect(plans[0].rows[1].contents).toBeDefined();
    expect((await actOnListingZipReview(context, sessionId, 0, 'skip')).review).toMatchObject({ cursor: 1, skippedCount: 1 });
    expect(mocks.insert).not.toHaveBeenCalled(); expect(mocks.page).not.toHaveBeenCalled();
    await expect(actOnListingZipReview(context, sessionId, 0, 'insert')).rejects.toMatchObject({ status: 409 });
  });

  it('serializes double-click Insert requests and creates only one listing', async () => {
    const { sessionId } = await start(), pending = deferred<{ listingIds: string[] }>();
    mocks.insert.mockReturnValueOnce(pending.promise);
    const first = actOnListingZipReview(context, sessionId, 0, 'insert'), second = actOnListingZipReview(context, sessionId, 0, 'insert');
    await vi.waitFor(() => expect(mocks.insert).toHaveBeenCalledOnce());
    pending.resolve({ listingIds: ['100'] });
    const results = await Promise.all([first, second]);
    expect(mocks.insert).toHaveBeenCalledOnce(); expect(mocks.insert).toHaveBeenCalledWith(plans[0], 0);
    expect(results.every((result) => result.review.cursor === 1 && result.review.insertedCount === 1)).toBe(true);
  });

  it('waits for an in-flight Insert before returning authoritative counts after a lost response', async () => {
    const { sessionId } = await start(), pending = deferred<{ listingIds: string[] }>();
    mocks.insert.mockReturnValueOnce(pending.promise);
    const insert = actOnListingZipReview(context, sessionId, 0, 'insert');
    await vi.waitFor(() => expect(mocks.insert).toHaveBeenCalledOnce());
    let readSettled = false;
    const read = getListingZipReview(context, sessionId).then((value) => { readSettled = true; return value; });
    await Promise.resolve(); await Promise.resolve();
    expect(readSettled).toBe(false);
    pending.resolve({ listingIds: ['100'] }); await insert;
    expect((await read).review).toMatchObject({ cursor: 1, insertedCount: 1, skippedCount: 0, current: { index: 1 } });
    expect(mocks.insert).toHaveBeenCalledOnce();
  });

  it('rejects future/stale actions rather than applying them to a different row', async () => {
    const { sessionId } = await start();
    await expect(actOnListingZipReview(context, sessionId, 1, 'insert')).rejects.toMatchObject({ status: 409 });
    await actOnListingZipReview(context, sessionId, 0, 'insert');
    await expect(actOnListingZipReview(context, sessionId, 0, 'skip')).rejects.toMatchObject({ status: 409 });
    await expect(actOnListingZipReview(context, sessionId, 1.5, 'insert')).rejects.toMatchObject({ status: 400 });
    expect(mocks.insert).toHaveBeenCalledOnce(); expect((await getListingZipReview(context, sessionId)).review.cursor).toBe(1);
  });

  it('commits the row state before table refresh and never repeats insertion after refresh failure', async () => {
    const { sessionId } = await start();
    let authoritative: ReturnType<typeof getListingZipReview> | undefined;
    mocks.page.mockImplementationOnce(async () => {
      authoritative = getListingZipReview(context, sessionId);
      expect(plans[0].rows[0].contents).toBeUndefined(); throw new Error('Refresh failed');
    });
    const result = await actOnListingZipReview(context, sessionId, 0, 'insert');
    expect(result).toMatchObject({ review: { cursor: 1, insertedCount: 1 }, data: null, refreshError: expect.stringMatching(/was inserted/) });
    expect((await authoritative!).review).toMatchObject({ cursor: 1, insertedCount: 1 });
    const retry = await actOnListingZipReview(context, sessionId, 0, 'insert');
    expect(retry.review.insertedCount).toBe(1); expect(retry.data).toBeDefined(); expect(mocks.insert).toHaveBeenCalledOnce();
  });

  it('keeps an uncertain Insert unconfirmed until explicit retry recovers its committed result', async () => {
    const { sessionId } = await start(); mocks.insert.mockRejectedValueOnce(new ListingZipImportError('Storage unavailable', 503));
    await expect(actOnListingZipReview(context, sessionId, 0, 'insert')).rejects.toMatchObject({ status: 503 });
    await expect(getListingZipReview(context, sessionId)).rejects.toMatchObject({ status: 503 });
    await expect(actOnListingZipReview(context, sessionId, 0, 'skip')).rejects.toMatchObject({ status: 503 });
    expect(plans[0].rows[0].contents).toBeDefined(); expect(mocks.insert).toHaveBeenCalledOnce();
    expect((await actOnListingZipReview(context, sessionId, 0, 'insert')).review.insertedCount).toBe(1);
    expect((await getListingZipReview(context, sessionId)).review).toMatchObject({ cursor: 1, insertedCount: 1, skippedCount: 0 });
    expect(mocks.insert).toHaveBeenCalledTimes(2);
  });

  it('does not clear an uncertain Insert merely because its next retry fails with a different error', async () => {
    const { sessionId } = await start();
    mocks.insert.mockRejectedValueOnce(new ListingZipImportError('Commit confirmation unavailable', 503))
      .mockRejectedValueOnce(new ListingZipImportError('The template changed', 409));
    await expect(actOnListingZipReview(context, sessionId, 0, 'insert')).rejects.toMatchObject({ status: 503 });
    await expect(actOnListingZipReview(context, sessionId, 0, 'insert')).rejects.toMatchObject({ status: 409 });
    await expect(getListingZipReview(context, sessionId)).rejects.toMatchObject({ status: 503 });
    await expect(actOnListingZipReview(context, sessionId, 0, 'skip')).rejects.toMatchObject({ status: 503 });
    expect(plans[0].rows[0].contents).toBeDefined();
  });

  it('allows invalid rows to be reviewed and skipped without calling Insert', async () => {
    const value = plan(); value.rows[0].error = 'CSV row 2: the filename is invalid.'; mocks.prepare.mockResolvedValueOnce(value);
    const { sessionId } = await start();
    await expect(actOnListingZipReview(context, sessionId, 0, 'insert')).rejects.toThrow('filename is invalid');
    expect(mocks.insert).not.toHaveBeenCalled();
    expect((await actOnListingZipReview(context, sessionId, 0, 'skip')).review.cursor).toBe(1);
  });

  it('finishes with correct Insert/Skip counts and retains replay state until closed', async () => {
    const { sessionId } = await start();
    await actOnListingZipReview(context, sessionId, 0, 'skip'); await actOnListingZipReview(context, sessionId, 1, 'insert');
    const result = await actOnListingZipReview(context, sessionId, 2, 'skip');
    expect(result.review).toMatchObject({ cursor: 3, total: 3, insertedCount: 1, skippedCount: 2, current: null });
    expect(plans[0].rows.every((row) => !row.contents)).toBe(true);
    expect((await actOnListingZipReview(context, sessionId, 1, 'insert')).review.insertedCount).toBe(1);
    expect(mocks.insert).toHaveBeenCalledOnce();
  });

  it('provides bounded on-demand image previews without writing or inserting anything', async () => {
    const value = plan(); value.rows[0].contents = await sharp({ create: { width: 1800, height: 2400, channels: 3, background: '#bc7b54' } }).png().toBuffer();
    mocks.prepare.mockResolvedValueOnce(value); const { sessionId } = await start();
    const image = await getListingZipReviewImage(context, sessionId, 0);
    expect(await sharp(image).metadata()).toMatchObject({ format: 'webp', width: 750, height: 1000 });
    expect(mocks.insert).not.toHaveBeenCalled(); expect((await getListingZipReview(context, sessionId)).review.cursor).toBe(0);
    await actOnListingZipReview(context, sessionId, 0, 'skip');
    await expect(getListingZipReviewImage(context, sessionId, 0)).rejects.toMatchObject({ status: 410 });
  });

  it('serves an oversized image preview, refuses Insert and releases the preview on Skip', async () => {
    const value = plan(), row = value.rows[0];
    row.contents = undefined; row.fileName = undefined; row.filePath = undefined;
    row.error = 'CSV row 2: Skipping this image because it exceeds the 60 MB per-image limit (62.4 MB). Choose Skip to continue.';
    row.previewContents = await sharp({ create: { width: 750, height: 1000, channels: 3, background: '#bc7b54' } }).webp().toBuffer();
    plans.push(value); mocks.prepare.mockResolvedValueOnce(value);
    const { sessionId } = await start();
    expect((await getListingZipReview(context, sessionId)).review.current).toMatchObject({ error: row.error, title: row.title });
    expect(await getListingZipReviewImage(context, sessionId, 0)).toEqual(row.previewContents);
    await expect(actOnListingZipReview(context, sessionId, 0, 'insert')).rejects.toMatchObject({ status: 400, message: row.error });
    expect(mocks.insert).not.toHaveBeenCalled();
    const skipped = await actOnListingZipReview(context, sessionId, 0, 'skip');
    expect(skipped.review).toMatchObject({ cursor: 1, skippedCount: 1, insertedCount: 0, current: { index: 1, error: null } });
    expect(row.previewContents).toBeUndefined();
    await expect(getListingZipReviewImage(context, sessionId, 0)).rejects.toMatchObject({ status: 410 });
    expect((await actOnListingZipReview(context, sessionId, 1, 'insert')).review).toMatchObject({ cursor: 2, skippedCount: 1, insertedCount: 1 });
    expect(mocks.insert).toHaveBeenCalledOnce();
  });

  it('closes and releases all source buffers without creating or deleting listings', async () => {
    const value = plan(); value.rows[0].previewContents = Buffer.from('review preview');
    plans.push(value); mocks.prepare.mockResolvedValueOnce(value);
    const { sessionId } = await start(); await closeListingZipReview(context, sessionId);
    expect(plans[0].rows.every((row) => !row.contents && !row.previewContents)).toBe(true); expect(mocks.insert).not.toHaveBeenCalled();
    await expect(getListingZipReview(context, sessionId)).rejects.toThrow(/expired or was closed/);
  });

  it('waits for an in-flight Insert before closing and refuses queued actions after close', async () => {
    const { sessionId } = await start(), pending = deferred<{ listingIds: string[] }>(); mocks.insert.mockReturnValueOnce(pending.promise);
    const first = actOnListingZipReview(context, sessionId, 0, 'insert');
    await vi.waitFor(() => expect(mocks.insert).toHaveBeenCalledOnce());
    const close = closeListingZipReview(context, sessionId), late = actOnListingZipReview(context, sessionId, 1, 'insert').catch((error) => error);
    pending.resolve({ listingIds: ['100'] }); await first; await close;
    expect(await late).toMatchObject({ status: 410 }); expect(mocks.insert).toHaveBeenCalledOnce();
  });

  it('limits retained sessions and frees a slot when one closes', async () => {
    const first = await start(); await start(); await expect(start()).rejects.toMatchObject({ status: 429 });
    expect(mocks.prepare).toHaveBeenCalledTimes(2); await closeListingZipReview(context, first.sessionId);
    await expect(start()).resolves.toMatchObject({ cursor: 0 });
  });

  it.each(['contents', 'previewContents'] as const)('enforces the combined staged-byte budget for %s without allocating giant test images', async (field) => {
    const value = plan(); value.rows = [value.rows[0]];
    value.rows[0][field] = Buffer.from('large buffer');
    Object.defineProperty(value.rows[0][field]!, 'byteLength', { value: LISTING_ZIP_REVIEW_LIMITS.stagedBytes + 1 });
    mocks.prepare.mockResolvedValueOnce(value);
    await expect(start()).rejects.toMatchObject({ status: 429 }); expect(value.rows[0].contents).toBeUndefined(); expect(value.rows[0].previewContents).toBeUndefined();
    await expect(start()).resolves.toMatchObject({ cursor: 0 });
  });

  it('permits only one preparation at a time and releases the gate on failure', async () => {
    const pending = deferred<ListingZipReviewPlan>(); mocks.prepare.mockReturnValueOnce(pending.promise);
    const first = start(); await expect(start()).rejects.toMatchObject({ status: 429 });
    pending.resolve(plan()); await first;
    mocks.prepare.mockRejectedValueOnce(new Error('Bad ZIP')); await expect(start()).rejects.toThrow('Bad ZIP');
    await expect(start()).resolves.toMatchObject({ cursor: 0 });
  });

  it('retains active sessions when the module reloads during development', async () => {
    const { sessionId } = await start(); vi.resetModules();
    const reloaded = await import('@/lib/listing-zip-review');
    expect((await reloaded.getListingZipReview(context, sessionId)).review.current?.title).toBe('Artwork 1');
  });
});
