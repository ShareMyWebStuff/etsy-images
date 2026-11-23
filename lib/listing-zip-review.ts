import { randomUUID } from 'node:crypto';
import sharp from 'sharp';
import {
  insertListingZipReviewRow, listingZipImportContext, ListingZipImportError, prepareListingZipReview,
  type ListingZipImportContext, type ListingZipReviewPlan,
} from '@/lib/listing-zip-import';
import { getSubSectionListingsPageData } from '@/lib/listing-table';
import type { ListingZipReviewResponse, ListingZipReviewState } from '@/lib/listing-zip-review-types';

export const LISTING_ZIP_REVIEW_LIMITS = Object.freeze({ ttlMs: 30 * 60 * 1000, sessions: 2, stagedBytes: 750 * 1024 * 1024 });
type RowAction = 'insert' | 'skip';
type ReviewSession = {
  id: string; context: ListingZipImportContext; plan: ListingZipReviewPlan; expiresAt: number;
  cursor: number; inserted: number; skipped: number; completed: Map<number, RowAction>;
  unconfirmedInsert: boolean;
  tail: Promise<void>; pending: number;
};
type ReviewStore = { sessions: Map<string, ReviewSession>; preparing: boolean; timer?: ReturnType<typeof setTimeout> };
const globalStore = globalThis as typeof globalThis & { __listingZipReviewsV1?: ReviewStore };
const store: ReviewStore = globalStore.__listingZipReviewsV1 ??= { sessions: new Map(), preparing: false };

function expired(): never { throw new ListingZipImportError('This ZIP review expired or was closed. Choose the ZIP again to continue.', 410); }
function unconfirmedInsert(): never {
  throw new ListingZipImportError('The previous Insert result is not confirmed. Retry Insert to check it, or finish and reload the listings.', 503);
}
function releaseRow(row: ListingZipReviewPlan['rows'][number]) { row.contents = undefined; row.previewContents = undefined; }
function release(session: ReviewSession) { for (const row of session.plan.rows) releaseRow(row); }
function remove(session: ReviewSession) {
  release(session); store.sessions.delete(session.id);
  if (!store.sessions.size && store.timer !== undefined) { clearTimeout(store.timer); store.timer = undefined; }
}
function purge() {
  for (const session of store.sessions.values()) if (!session.pending && session.expiresAt <= Date.now()) remove(session);
}
function scheduleCleanup() {
  if (store.timer !== undefined || !store.sessions.size) return;
  store.timer = setTimeout(() => { store.timer = undefined; purge(); scheduleCleanup(); }, 60_000);
  store.timer.unref?.();
}
function canonicalContext(value: ListingZipImportContext) {
  const context = listingZipImportContext(value);
  return { shopId: BigInt(context.shopId).toString(), sectionId: BigInt(context.sectionId).toString(), subSectionId: BigInt(context.subSectionId).toString() };
}
function find(context: ListingZipImportContext, id: string) {
  const scoped = canonicalContext(context);
  if (typeof id !== 'string' || !/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(id)) {
    throw new ListingZipImportError('Choose an active ZIP review.', 400);
  }
  purge();
  const session = store.sessions.get(id);
  if (!session) return expired();
  if (session.context.shopId !== scoped.shopId || session.context.sectionId !== scoped.sectionId || session.context.subSectionId !== scoped.subSectionId) {
    throw new ListingZipImportError('This ZIP review was not found in the selected section.', 404);
  }
  if (session.expiresAt <= Date.now()) return expired();
  session.expiresAt = Date.now() + LISTING_ZIP_REVIEW_LIMITS.ttlMs;
  return session;
}
function state(session: ReviewSession): ListingZipReviewState {
  const row = session.plan.rows[session.cursor];
  return { sessionId: session.id, templateName: session.plan.target.name, total: session.plan.rows.length,
    cursor: session.cursor, insertedCount: session.inserted, skippedCount: session.skipped, expiresAt: new Date(session.expiresAt).toISOString(),
    current: row ? { index: session.cursor, rowNumber: row.rowNumber, title: row.title, description: row.description,
      relativeFilename: row.relativeFilename, originalFileName: row.originalFileName,
      width: row.width, height: row.height, orientation: row.orientation, error: row.error } : null };
}
function bytes(plans: ListingZipReviewPlan[]) {
  const retained = new Set<Buffer>(); let total = 0;
  for (const plan of plans) for (const row of plan.rows) for (const contents of [row.contents, row.previewContents]) {
    if (contents && !retained.has(contents)) { retained.add(contents); total += contents.byteLength; }
  }
  return total;
}
function serial<T>(session: ReviewSession, operation: () => Promise<T>): Promise<T> {
  session.pending++;
  const result = session.tail.then(async () => {
    if (store.sessions.get(session.id) !== session) return expired();
    if (session.expiresAt <= Date.now()) return expired();
    session.expiresAt = Date.now() + LISTING_ZIP_REVIEW_LIMITS.ttlMs;
    return operation();
  });
  session.tail = result.then(() => undefined, () => undefined);
  return result.finally(() => { session.pending--; purge(); });
}

export async function startListingZipReview(input: ListingZipImportContext, templateId: unknown, file: File): Promise<ListingZipReviewResponse> {
  const context = canonicalContext(input); purge();
  if (store.preparing) throw new ListingZipImportError('Another ZIP is being prepared. Wait for it to finish and try again.', 429);
  if (store.sessions.size >= LISTING_ZIP_REVIEW_LIMITS.sessions) throw new ListingZipImportError('Close another ZIP review before choosing another ZIP.', 429);
  store.preparing = true;
  try {
    const plan = await prepareListingZipReview(context, templateId, file);
    if (!plan.rows.length) throw new ListingZipImportError('The ZIP does not contain any rows to review.');
    purge();
    if (bytes([...store.sessions.values()].map((session) => session.plan).concat(plan)) > LISTING_ZIP_REVIEW_LIMITS.stagedBytes) {
      for (const row of plan.rows) releaseRow(row);
      throw new ListingZipImportError('The ZIP reviews exceed the available memory. Close another review or choose a smaller ZIP.', 429);
    }
    const session: ReviewSession = { id: randomUUID(), context, plan, expiresAt: Date.now() + LISTING_ZIP_REVIEW_LIMITS.ttlMs,
      cursor: 0, inserted: 0, skipped: 0, completed: new Map(), unconfirmedInsert: false, tail: Promise.resolve(), pending: 0 };
    store.sessions.set(session.id, session); scheduleCleanup();
    return { review: state(session) };
  } finally { store.preparing = false; }
}

export async function getListingZipReview(input: ListingZipImportContext, id: string): Promise<ListingZipReviewResponse> {
  const session = find(input, id);
  return serial(session, async () => {
    if (session.unconfirmedInsert) return unconfirmedInsert();
    return { review: state(session) };
  });
}

export async function getListingZipReviewImage(input: ListingZipImportContext, id: string, rowIndex: number): Promise<Buffer> {
  const session = find(input, id);
  if (!Number.isSafeInteger(rowIndex) || rowIndex < 0 || rowIndex >= session.plan.rows.length) throw new ListingZipImportError('Choose a valid review row.');
  const row = session.plan.rows[rowIndex];
  if (row.previewContents) return row.previewContents;
  const contents = row.contents;
  if (!contents) throw new ListingZipImportError('This review image is no longer available. Continue with the current row or choose the ZIP again.', 410);
  try { return await sharp(contents, { failOn: 'error' }).rotate().resize({ width: 1000, height: 1000, fit: 'inside', withoutEnlargement: true }).webp({ quality: 82 }).toBuffer(); }
  catch { throw new ListingZipImportError('The artwork preview could not be decoded. This row can be skipped.', 400); }
}

async function refresh(session: ReviewSession): Promise<ListingZipReviewResponse> {
  try {
    const data = await getSubSectionListingsPageData(session.context.shopId, session.context.sectionId, session.context.subSectionId);
    if (!data) throw new Error('The section could not be loaded.');
    return { review: state(session), data };
  } catch {
    return { review: state(session), data: null, refreshError: 'The listing was inserted, but the listings table could not be refreshed. Refresh the page to see it.' };
  }
}

export async function actOnListingZipReview(input: ListingZipImportContext, id: string, rowIndex: number, action: RowAction): Promise<ListingZipReviewResponse> {
  const session = find(input, id);
  if (!Number.isSafeInteger(rowIndex) || rowIndex < 0 || rowIndex >= session.plan.rows.length) throw new ListingZipImportError('Choose a valid review row.');
  if (action !== 'insert' && action !== 'skip') throw new ListingZipImportError('Choose Insert or Skip for this review row.');
  return serial(session, async () => {
    if (session.unconfirmedInsert && action === 'skip') return unconfirmedInsert();
    const completed = session.completed.get(rowIndex);
    if (completed) {
      if (completed !== action) throw new ListingZipImportError(`This row was already ${completed === 'insert' ? 'inserted' : 'skipped'}. Continue with the current row.`, 409);
      return action === 'insert' ? refresh(session) : { review: state(session) };
    }
    if (rowIndex !== session.cursor) throw new ListingZipImportError('This ZIP review has moved to another row. Reload the review before continuing.', 409);
    const row = session.plan.rows[rowIndex];
    if (action === 'insert') {
      if (row.error) throw new ListingZipImportError(row.error, 400);
      try {
        await insertListingZipReviewRow(session.plan, rowIndex);
        session.unconfirmedInsert = false;
      } catch (error) {
        if (error instanceof ListingZipImportError && error.status === 503) session.unconfirmedInsert = true;
        throw error;
      }
      session.inserted++;
    } else session.skipped++;
    // Record success and release the image before any optional table refresh.
    session.completed.set(rowIndex, action); session.cursor++; releaseRow(row);
    session.expiresAt = Date.now() + LISTING_ZIP_REVIEW_LIMITS.ttlMs;
    return action === 'insert' ? refresh(session) : { review: state(session) };
  });
}

export async function closeListingZipReview(input: ListingZipImportContext, id: string): Promise<void> {
  const session = find(input, id);
  return serial(session, async () => { remove(session); });
}
