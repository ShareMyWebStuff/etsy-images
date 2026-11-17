import { prisma } from '@/lib/prisma';
import { loadPinCreativeStorageKeys } from './creative-storage';
import { publicationKey } from './copy';
import { validatePinDescription } from './description';

export const PINTEREST_SCHEDULE_TIME_ZONE = 'Europe/London';
export const PINTEREST_SCHEDULE_SLOTS = [9, 13, 18, 21] as const;
const READY_STATUSES = ['DRAFT', 'PAUSED', 'FAILED'];

export class PinterestSchedulingError extends Error {
  constructor(message: string, public status = 400) {
    super(message);
    this.name = 'PinterestSchedulingError';
  }
}

export type SchedulePinterestPinsInput = {
  name: string;
  boardId: number;
  pinIds: number[];
  startDate: string;
  pinsPerDay: number;
  timeZone: string;
};

function positiveId(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value > 0 && value <= 2_147_483_647;
}

function calendarDate(value: string) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    throw new PinterestSchedulingError('Choose a start date in YYYY-MM-DD format.');
  }
  const date = new Date(`${value}T00:00:00.000Z`);
  if (Number.isNaN(date.getTime()) || date.toISOString().slice(0, 10) !== value) {
    throw new PinterestSchedulingError('Choose a valid start date.');
  }
  return date;
}

/** Convert calendar wall time using London's actual offset on that date. */
function londonSlot(day: Date, hour: number, formatter: Intl.DateTimeFormat) {
  const wallTime = Date.UTC(day.getUTCFullYear(), day.getUTCMonth(), day.getUTCDate(), hour);
  let instant = wallTime;
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const parts = Object.fromEntries(formatter.formatToParts(new Date(instant)).map(part => [part.type, part.value]));
    const displayedTime = Date.UTC(Number(parts.year), Number(parts.month) - 1, Number(parts.day), Number(parts.hour), Number(parts.minute), Number(parts.second));
    const correction = wallTime - displayedTime;
    if (correction === 0) return new Date(instant);
    instant += correction;
  }
  throw new PinterestSchedulingError('The selected London publishing time could not be resolved.');
}

/** Pure schedule construction; each date uses local London time, including BST. */
export function buildPinterestSchedule(startDate: string, count: number, pinsPerDay: number, timeZone = PINTEREST_SCHEDULE_TIME_ZONE) {
  if (timeZone !== PINTEREST_SCHEDULE_TIME_ZONE) throw new PinterestSchedulingError('Choose Europe/London as the publishing time zone.');
  if (!Number.isSafeInteger(count) || count < 1) throw new PinterestSchedulingError('Select at least one Pin to schedule.');
  if (!Number.isInteger(pinsPerDay) || pinsPerDay < 1 || pinsPerDay > 4) throw new PinterestSchedulingError('Choose between 1 and 4 Pins per day.');
  const start = calendarDate(startDate);
  const formatter = new Intl.DateTimeFormat('en-GB', {
    timeZone, year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23',
  });
  return Array.from({ length: count }, (_, index) => {
    const day = new Date(start.getTime());
    day.setUTCDate(day.getUTCDate() + Math.floor(index / pinsPerDay));
    return londonSlot(day, PINTEREST_SCHEDULE_SLOTS[index % pinsPerDay], formatter);
  });
}

function matchingEtsyDestination(url: string | null, listing: {
  etsyId: string | null; etsyCustomisedId: string | null; etsyDownloadId: string | null;
  state: string | null; etsyCustomisedState: string | null; etsyDownloadState: string | null;
}) {
  let id: string | undefined;
  try {
    const parsed = new URL(url ?? '');
    if (parsed.protocol === 'https:' && ['etsy.com', 'www.etsy.com'].includes(parsed.hostname.toLowerCase()) && !parsed.username && !parsed.password && !parsed.port) {
      id = parsed.pathname.match(/^\/(?:[a-z]{2}(?:-[a-z]{2})?\/)?listing\/([1-9]\d*)(?:\/|$)/i)?.[1];
    }
  } catch { /* Invalid links are rejected below. */ }
  const matches = id ? [
    { id: listing.etsyId, state: listing.state },
    { id: listing.etsyCustomisedId, state: listing.etsyCustomisedState },
    { id: listing.etsyDownloadId, state: listing.etsyDownloadState },
  ].filter(variant => variant.id === id) : [];
  if (matches.length !== 1) throw new PinterestSchedulingError('Every selected Pin needs an Etsy destination belonging to its own listing. Review its link first.');
  if (!['active', 'published'].includes(matches[0].state ?? '')) throw new PinterestSchedulingError('Every selected Pin must link to an active Etsy listing.');
}

/** Schedule only explicitly selected, ready Pins. No AWS, Pinterest or storage calls. */
export async function schedulePinterestPins(input: SchedulePinterestPinsInput) {
  const name = typeof input?.name === 'string' ? input.name.trim() : '';
  if (!name || Array.from(name).length > 191) throw new PinterestSchedulingError('Enter a campaign name of 191 characters or fewer.');
  if (!positiveId(input.boardId)) throw new PinterestSchedulingError('Choose a valid Pinterest board.');
  if (!Array.isArray(input.pinIds) || input.pinIds.length === 0 || input.pinIds.some(id => !positiveId(id)) || new Set(input.pinIds).size !== input.pinIds.length) {
    throw new PinterestSchedulingError('Select one or more distinct valid Pin IDs.');
  }
  if (input.timeZone !== PINTEREST_SCHEDULE_TIME_ZONE) throw new PinterestSchedulingError('Choose Europe/London as the publishing time zone.');
  const dates = buildPinterestSchedule(input.startDate, input.pinIds.length, input.pinsPerDay, input.timeZone);
  if (dates[0].getTime() <= Date.now()) throw new PinterestSchedulingError('Choose a future start date so the fresh schedule does not catch up old publishing times.');

  return prisma.$transaction(async tx => {
    const board = await tx.pinterestBoard.findUnique({ where: { id: input.boardId }, select: { id: true } });
    if (!board) throw new PinterestSchedulingError('Pinterest board not found.', 404);
    const rows = await tx.pinterestPin.findMany({
      where: { id: { in: input.pinIds } },
      include: { listing: { select: {
        etsyId: true, etsyCustomisedId: true, etsyDownloadId: true,
        state: true, etsyCustomisedState: true, etsyDownloadState: true,
        images: { orderBy: [{ rank: 'asc' }, { id: 'asc' }], select: { id: true, urlFullxFull: true, localFileName: true } },
        subSection: { select: { shopSection: { select: { shop: { select: { id: true } } } } } },
      } } },
    });
    if (rows.length !== input.pinIds.length) throw new PinterestSchedulingError('One or more selected Pins no longer exist. Refresh the board.', 409);
    const byId = new Map(rows.map(pin => [pin.id, pin]));
    const pins = input.pinIds.map(id => byId.get(id)!);
    const creativeKeys = await loadPinCreativeStorageKeys(input.pinIds, tx);
    for (const pin of pins) {
      if (pin.boardId !== input.boardId || !READY_STATUSES.includes(pin.status) || pin.pinterestPinId || pin.publishedAt) {
        throw new PinterestSchedulingError('Only unpublished draft, paused or failed Pins on the selected board can be scheduled. Refresh and select them again.', 409);
      }
      validatePinDescription(pin.description);
      matchingEtsyDestination(pin.destinationUrl, pin.listing);
      if (!creativeKeys.has(pin.id)) {
        const image = pin.imageId === null ? pin.listing.images[0] : pin.listing.images.find(item => item.id === pin.imageId);
        if (!image) throw new PinterestSchedulingError('A selected Pin has no usable image belonging to its listing.');
        if (image.urlFullxFull) {
          try {
            if (!['https:', 'http:'].includes(new URL(image.urlFullxFull).protocol)) throw new Error();
          } catch { throw new PinterestSchedulingError('A selected Pin has an invalid source image URL.'); }
        } else if (!image.localFileName || !pin.listing.subSection?.shopSection.shop) {
          throw new PinterestSchedulingError('A selected Pin has no usable source image or dedicated creative.');
        }
      }
    }

    const campaign = await tx.pinterestCampaign.create({ data: {
      name, status: 'ACTIVE', sourceSectionId: null,
      startDate: dates[0], endDate: dates[dates.length - 1], pinsPerDay: input.pinsPerDay,
      configuration: { boardId: input.boardId, timeZone: input.timeZone, startDate: input.startDate, slots: PINTEREST_SCHEDULE_SLOTS.slice(0, input.pinsPerDay), pinIds: input.pinIds },
    } });
    for (let index = 0; index < pins.length; index += 1) {
      const pin = pins[index];
      const changed = await tx.pinterestPin.updateMany({
        where: {
          id: pin.id, boardId: input.boardId, listingId: pin.listingId,
          status: { in: READY_STATUSES }, pinterestPinId: null, publishedAt: null,
          updatedAt: pin.updatedAt, description: pin.description, destinationUrl: pin.destinationUrl, imageId: pin.imageId,
        },
        data: { campaignId: campaign.id, status: 'SCHEDULED', scheduledAt: dates[index], error: null,
          publicationKey: publicationKey(pin.listingId, pin.imageId, input.boardId, dates[index]) },
      });
      if (changed.count !== 1) throw new PinterestSchedulingError('A selected Pin changed while scheduling. Nothing was scheduled; refresh and retry.', 409);
    }
    return { ...campaign, scheduledCount: pins.length, pinIds: input.pinIds, firstScheduledAt: dates[0], lastScheduledAt: dates[dates.length - 1] };
  }, { timeout: 60_000 });
}
