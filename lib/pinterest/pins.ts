import { readFile } from '@/lib/s3-listing-storage';
import path from 'node:path';
import { promises as fs } from 'node:fs';
import { createHash, randomUUID } from 'node:crypto';
import { tmpdir } from 'node:os';
import { prisma } from '@/lib/prisma';
import { getListingDirectoryPath } from '@/lib/local-shop-directory';
import { pinterestRequest, PinterestRequestUncertainError } from './client';
import type { PinterestPinApi } from './types';
import { loadPinCreativeStorageKeys, readPinCreative } from './creative-storage';
import { assertPinterestBoardAvailable } from './boards';
import { validatePinDescription } from './description';
import { PinterestApiError } from './types';
import { getEtsyKeystring, getValidEtsyAccessToken } from '@/lib/etsy-oauth';

class ScheduledPinDeferral extends Error {}
class InvalidPinDestination extends Error {}

/** London calendar boundaries keep the daily cap correct across GMT/BST changes. */
export function pinterestPublicationDay(now: Date) {
  const dateParts = new Intl.DateTimeFormat('en-GB', { timeZone: 'Europe/London', year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(now);
  const part = (type: string) => Number(dateParts.find((value) => value.type === type)!.value);
  const boundary = (day: number) => {
    const midnight = Date.UTC(part('year'), part('month') - 1, day);
    const offset = new Intl.DateTimeFormat('en-GB', { timeZone: 'Europe/London', timeZoneName: 'longOffset' })
      .formatToParts(new Date(midnight)).find((value) => value.type === 'timeZoneName')!.value;
    const match = /GMT([+-])(\d{2}):(\d{2})/.exec(offset);
    const minutes = match ? (Number(match[2]) * 60 + Number(match[3])) * (match[1] === '+' ? 1 : -1) : 0;
    return new Date(midnight - minutes * 60_000);
  };
  return { start: boundary(part('day')), end: boundary(part('day') + 1) };
}

async function acquirePublisherLock() {
  let databaseIdentity = process.env.DATABASE_URL ?? 'default';
  try {
    const url = new URL(databaseIdentity);
    databaseIdentity = `${url.protocol}//${url.hostname.toLowerCase()}:${url.port || '3306'}${url.pathname}`;
  } catch { /* Invalid configuration will be reported by Prisma, without exposing its value. */ }
  const database = createHash('sha256').update(databaseIdentity).digest('hex').slice(0, 20);
  const file = path.join(tmpdir(), `etsy-pinterest-publisher-${database}.lock`);
  const token = randomUUID();
  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      const handle = await fs.open(file, 'wx');
      try { await handle.writeFile(JSON.stringify({ pid: process.pid, token, createdAt: new Date().toISOString() })); }
      finally { await handle.close(); }
      return async () => {
        try {
          const saved = JSON.parse(await fs.readFile(file, 'utf8')) as { token?: string };
          if (saved.token === token) await fs.unlink(file);
        } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }
      };
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;
      let saved: { pid?: number };
      try { saved = JSON.parse(await fs.readFile(file, 'utf8')); }
      catch { return null; }
      if (!Number.isSafeInteger(saved.pid) || Number(saved.pid) < 1) return null;
      try { process.kill(saved.pid!, 0); return null; }
      catch (probe) { if ((probe as NodeJS.ErrnoException).code !== 'ESRCH') return null; }
      // Serialize stale-lock recovery so two recovering workers cannot remove a new owner's lock.
      let recovery;
      try { recovery = await fs.open(`${file}.reclaim`, 'wx'); }
      catch (recoverError) { if ((recoverError as NodeJS.ErrnoException).code === 'EEXIST') return null; throw recoverError; }
      try {
        const current = JSON.parse(await fs.readFile(file, 'utf8')) as { pid?: number };
        if (!Number.isSafeInteger(current.pid) || Number(current.pid) < 1) return null;
        try { process.kill(current.pid!, 0); return null; }
        catch (probe) { if ((probe as NodeJS.ErrnoException).code !== 'ESRCH') return null; }
        await fs.unlink(file);
      } catch (recoverError) { if ((recoverError as NodeJS.ErrnoException).code !== 'ENOENT') throw recoverError; }
      finally { await recovery.close(); await fs.unlink(`${file}.reclaim`); }
    }
  }
  return null;
}

function publisherErrorMessage(error: unknown) {
  return error instanceof Error ? error.message : 'Publication failed.';
}

async function verifyScheduledEtsyDestination(pin: { destinationUrl: string | null; listing: { etsyId: string | null; etsyCustomisedId: string | null; etsyDownloadId: string | null } }) {
  let destinationId: string | undefined;
  try {
    const url = new URL(pin.destinationUrl ?? '');
    if (url.protocol === 'https:' && ['etsy.com', 'www.etsy.com'].includes(url.hostname.toLowerCase())) {
      destinationId = url.pathname.match(/^\/(?:[a-z]{2}(?:-[a-z]{2})?\/)?listing\/(\d+)(?:\/|$)/i)?.[1];
    }
  } catch { /* An invalid destination is handled below without contacting Etsy. */ }
  if (!destinationId || [pin.listing.etsyId, pin.listing.etsyCustomisedId, pin.listing.etsyDownloadId].filter((id) => id === destinationId).length !== 1) {
    throw new InvalidPinDestination('The scheduled Pin must link to one of its own Etsy products. Review its destination before rescheduling.');
  }
  let response: Response;
  try {
    const secret = process.env.ETSY_SHARED_SECRET;
    if (!secret) throw new Error('Etsy API configuration is missing.');
    const token = await getValidEtsyAccessToken();
    response = await fetch(`https://openapi.etsy.com/v3/application/listings/${destinationId}?legacy=false`, {
      headers: { Accept: 'application/json', 'x-api-key': `${getEtsyKeystring()}:${secret}`, Authorization: `Bearer ${token}` },
      signal: AbortSignal.timeout(30_000), cache: 'no-store',
    });
  } catch {
    throw new ScheduledPinDeferral('Etsy availability could not be checked. The Pin remains scheduled for a later attempt.');
  }
  if (response.status === 404 || response.status === 410) throw new InvalidPinDestination('The Etsy destination no longer exists. Review the product before rescheduling this Pin.');
  if (!response.ok) throw new ScheduledPinDeferral('Etsy availability could not be checked. The Pin remains scheduled for a later attempt.');
  let listing: { listing_id?: number | string; state?: string };
  try { listing = await response.json(); }
  catch { throw new ScheduledPinDeferral('Etsy returned an unreadable listing response. The Pin remains scheduled.'); }
  if (String(listing.listing_id) !== destinationId) throw new ScheduledPinDeferral('Etsy returned an unexpected product. The Pin remains scheduled.');
  if (listing.state !== 'active') throw new InvalidPinDestination('The Etsy destination is not active. Review the product before rescheduling this Pin.');
}

type PinterestImageMediaSource = { source_type: 'image_url'; url: string }
  | { source_type: 'image_base64'; content_type: 'image/png' | 'image/jpeg' | 'image/webp'; data: string };

export async function imageMediaSource(listingId: number, imageId: number | null, pinId?: number): Promise<PinterestImageMediaSource> {
  if (pinId !== undefined) {
    const key = (await loadPinCreativeStorageKeys([pinId])).get(pinId);
    if (key) return { source_type: 'image_base64', content_type: 'image/png', data: (await readPinCreative(key, listingId)).toString('base64') };
  }
  const listing = await prisma.etsyListing.findUnique({ where: { id: listingId }, include: { images: { orderBy: [{ rank: 'asc' }, { id: 'asc' }] }, subSection: { include: { shopSection: { include: { shop: true } } } } } });
  if (!listing) throw new Error('Listing was not found.');
  const image = imageId ? listing.images.find((item) => item.id === imageId) : listing.images[0];
  if (!image) throw new Error('The listing has no image.');
  if (image.urlFullxFull) return { source_type: 'image_url', url: image.urlFullxFull };
  if (!image.localFileName || !listing.subSection?.shopSection.shop) throw new Error('The selected image is not available locally.');
  const shop = listing.subSection.shopSection.shop;
  const filePath = path.join(getListingDirectoryPath(shop.shopName ?? String(shop.etsyShopId), listing.subSection.shopSection.title, listing.subSection.name, listing.localDirectoryName ?? `Listing-${listing.id}`), image.localFileName);
  const extension = path.extname(filePath).toLowerCase(); const mime = extension === '.png' ? 'image/png' : extension === '.webp' ? 'image/webp' : 'image/jpeg';
  return { source_type: 'image_base64', content_type: mime, data: (await readFile(filePath)).toString('base64') };
}
async function publishPinForMode(pinId: number, scheduledOnly: boolean, now = new Date()) {
  const pin = await prisma.pinterestPin.findUnique({ where: { id: pinId }, include: { board: true, listing: true } });
  if (!pin) throw new Error('Pin was not found.');
  if (pin.pinterestPinId) return scheduledOnly ? null : pin;
  if (pin.status === 'PUBLISHING') {
    if (scheduledOnly) return null;
    throw new Error('This Pin is already being published. Wait for the current request to finish.');
  }
  if (scheduledOnly && pin.status !== 'SCHEDULED') return null;
  try {
    // Publication sends the reviewed text unchanged, including its whitespace.
    validatePinDescription(pin.description);
    if (!pin.destinationUrl || !/^https:\/\/(?:www\.)?etsy\.com\//i.test(pin.destinationUrl)) throw new Error('A real Etsy listing URL is required before publishing.');
  } catch (error) {
    if (scheduledOnly) await prisma.pinterestPin.updateMany({
      where: { id: pin.id, status: 'SCHEDULED', pinterestPinId: null, description: pin.description, updatedAt: pin.updatedAt },
      data: { status: 'FAILED', error: publisherErrorMessage(error), retryCount: { increment: 1 } },
    });
    throw error;
  }
  if (!scheduledOnly) await assertPinterestBoardAvailable(pin.board);
  const claimed = await prisma.pinterestPin.updateMany({
    where: {
      id: pin.id,
      pinterestPinId: null,
      description: pin.description,
      updatedAt: pin.updatedAt,
      ...(scheduledOnly ? { status: 'SCHEDULED', scheduledAt: { gte: pinterestPublicationDay(now).start, lte: now } } : { status: { not: 'PUBLISHING' } }),
    },
    data: { status: 'PUBLISHING', error: null },
  });
  if (claimed.count !== 1) {
    if (scheduledOnly) return null;
    throw new Error('This Pin is already being published or its state changed. Refresh before trying again.');
  }
  let posting = false;
  let createdId: string | undefined;
  try {
    if (scheduledOnly) {
      await assertPinterestBoardAvailable(pin.board);
      await verifyScheduledEtsyDestination(pin);
    }
    const media = await imageMediaSource(pin.listingId, pin.imageId, pin.id);
    posting = true;
    const created = await pinterestRequest<PinterestPinApi>('/pins', { method: 'POST', body: JSON.stringify({ board_id: pin.board.pinterestBoardId, title: pin.title, description: pin.description, link: pin.destinationUrl, media_source: media }) });
    if (!created || typeof created.id !== 'string' || !created.id.trim()) throw new PinterestRequestUncertainError();
    createdId = created.id;
    return await prisma.pinterestPin.update({ where: { id: pin.id }, data: { pinterestPinId: created.id, status: 'PUBLISHED', publishedAt: new Date(), error: null } });
  } catch (error) {
    const rejected = error instanceof PinterestApiError && error.status < 500;
    const uncertain = error instanceof PinterestRequestUncertainError || (posting && !rejected);
    const permanent = error instanceof InvalidPinDestination || /board is not available|creative image is unavailable|does not belong|listing has no image/i.test(publisherErrorMessage(error));
    const deferred = scheduledOnly && !uncertain && !permanent && (!posting || (error instanceof PinterestApiError && error.status === 429));
    const message = uncertain
      ? 'Publication outcome uncertain. Check Pinterest before rescheduling this Pin to avoid duplicates.'
      : publisherErrorMessage(error);
    try {
      await prisma.pinterestPin.updateMany({
        where: { id: pin.id, status: 'PUBLISHING', pinterestPinId: null },
        data: {
          status: uncertain ? 'PAUSED' : deferred ? 'SCHEDULED' : 'FAILED',
          retryCount: { increment: 1 }, error: message,
          ...(createdId ? { pinterestPinId: createdId, publishedAt: new Date() } : {}),
        },
      });
    } catch (persistenceError) {
      if (uncertain) throw new PinterestRequestUncertainError({ cause: persistenceError });
      throw persistenceError;
    }
    if (uncertain) throw error instanceof PinterestRequestUncertainError ? error : new PinterestRequestUncertainError({ cause: error });
    if (deferred) throw new ScheduledPinDeferral(message);
    throw error;
  }
}

export async function publishPin(pinId: number) {
  const pin = await publishPinForMode(pinId, false);
  if (!pin) throw new Error('Pin could not be published.');
  return pin;
}

export async function deletePin(pinId: number) {
  const pin = await prisma.pinterestPin.findUnique({ where: { id: pinId }, include: { board: true } });
  if (!pin) throw new Error('Pin was not found.');
  if (pin.pinterestPinId) {
    await assertPinterestBoardAvailable(pin.board);
    await pinterestRequest<void>(`/pins/${encodeURIComponent(pin.pinterestPinId)}`, { method: 'DELETE' });
  }
  await prisma.pinterestPin.delete({ where: { id: pin.id } });
  return { deleted: true };
}

export async function processDuePins(limit = 5, options: { dryRun?: boolean; now?: Date; maxPerBoardPerDay?: number } = {}) {
  if (process.env.PINTEREST_ENVIRONMENT !== 'production') throw new Error('The automatic Pinterest publisher only runs in production.');
  const connection = await prisma.pinterestConnection.findUnique({ where: { id: 1 }, select: { environment: true } });
  if (connection?.environment !== 'production') throw new Error('Connect Pinterest in production before running the automatic publisher.');
  const release = await acquirePublisherLock();
  if (!release) return [];
  try {
    const now = options.now ?? new Date();
    const { start, end } = pinterestPublicationDay(now);
    const maximum = Math.min(5, Math.max(1, Math.floor(limit) || 5));
    if (!options.dryRun) {
      // Missed days require a fresh schedule rather than an automatic catch-up burst.
      await prisma.pinterestPin.updateMany({ where: { status: 'SCHEDULED', scheduledAt: { lt: start } },
        data: { status: 'PAUSED', error: 'This Pin missed its scheduled day. Review and reschedule it; future dates were preserved.' } });
      // A crash may have happened after Pinterest accepted the request. Never retry it blindly.
      await prisma.pinterestPin.updateMany({ where: { status: 'PUBLISHING', pinterestPinId: null, updatedAt: { lt: new Date(now.getTime() - 30 * 60_000) } },
        data: { status: 'PAUSED', error: 'Publication outcome uncertain. The publisher was interrupted; check Pinterest before rescheduling.' } });
    }
    const pins = await prisma.pinterestPin.findMany({
      where: { status: 'SCHEDULED', pinterestPinId: null, scheduledAt: { gte: start, lte: now } },
      orderBy: [{ scheduledAt: 'asc' }, { id: 'asc' }], select: { id: true, boardId: true }, take: 200,
    });
    if (!pins.length) return [];
    const boardIds = [...new Set(pins.map((pin) => pin.boardId))];
    const plans = await prisma.pinterestPin.findMany({
      where: { boardId: { in: boardIds }, status: 'SCHEDULED', scheduledAt: { gte: start, lt: end }, campaign: { status: 'ACTIVE' } },
      select: { boardId: true, campaign: { select: { pinsPerDay: true } } },
    });
    const plannedRates = new Map<number, number>();
    for (const plan of plans) {
      const rate = plan.campaign?.pinsPerDay;
      if (rate && Number.isInteger(rate) && rate >= 1 && rate <= 4) plannedRates.set(plan.boardId, Math.max(rate, plannedRates.get(plan.boardId) ?? 0));
    }
    const counts = await prisma.pinterestPin.groupBy({
      by: ['boardId'], where: { boardId: { in: boardIds }, OR: [
        { publishedAt: { gte: start, lt: end } },
        { status: 'PUBLISHING', updatedAt: { gte: start, lt: end } },
        { status: 'PAUSED', error: { startsWith: 'Publication outcome uncertain.' }, updatedAt: { gte: start, lt: end } },
      ] }, _count: { _all: true },
    });
    const publishedByBoard = new Map(counts.map((row) => [row.boardId, row._count._all]));
    const results: Array<{ id: number; ok: boolean; skipped?: boolean; deferred?: boolean; reviewRequired?: boolean; error?: string }> = [];
    let attempted = 0;
    for (const pin of pins) {
      if (attempted >= maximum) break;
      const perBoard = options.maxPerBoardPerDay === undefined ? plannedRates.get(pin.boardId) ?? 2
        : Math.min(4, Math.max(1, Math.floor(options.maxPerBoardPerDay) || 2));
      if ((publishedByBoard.get(pin.boardId) ?? 0) >= perBoard) continue;
      attempted += 1;
      if (options.dryRun) {
        results.push({ id: pin.id, ok: true, skipped: true });
        publishedByBoard.set(pin.boardId, (publishedByBoard.get(pin.boardId) ?? 0) + 1);
        continue;
      }
      try {
        const published = await publishPinForMode(pin.id, true, now);
        results.push(published ? { id: pin.id, ok: true } : { id: pin.id, ok: true, skipped: true });
        if (published) publishedByBoard.set(pin.boardId, (publishedByBoard.get(pin.boardId) ?? 0) + 1);
      } catch (error) {
        if (error instanceof PinterestRequestUncertainError) publishedByBoard.set(pin.boardId, (publishedByBoard.get(pin.boardId) ?? 0) + 1);
        results.push({ id: pin.id, ok: false, error: publisherErrorMessage(error),
          ...(error instanceof ScheduledPinDeferral ? { deferred: true } : {}),
          ...(error instanceof PinterestRequestUncertainError ? { reviewRequired: true } : {}),
        });
      }
    }
    return results;
  } finally { await release(); }
}
