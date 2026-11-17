import { createHash } from 'node:crypto';
import path from 'node:path';
import { Prisma } from '@prisma/client';
import { ETSY_LISTINGS_DIRECTORY } from '@/lib/config';
import { prisma } from '@/lib/prisma';
import { readFile } from '@/lib/s3-listing-storage';

const CREATIVE_KEY = /^\.pinterest-creatives\/([1-9]\d*)\/([a-f0-9]{64})\.png$/;
type CreativeDb = Pick<Prisma.TransactionClient, '$queryRaw' | '$executeRaw'>;

function assertPositiveId(value: number) {
  if (!Number.isSafeInteger(value) || value < 1) throw new Error('A valid Pin and listing are required.');
}

export function validatePinCreativeStorageKey(key: string, listingId: number) {
  assertPositiveId(listingId);
  const match = typeof key === 'string' ? CREATIVE_KEY.exec(key) : null;
  if (!match || match[1] !== String(listingId)) {
    throw new Error('The Pin creative does not belong to this listing.');
  }
  return key;
}

/** Raw access works with the running development server's existing Prisma client. */
export async function loadPinCreativeStorageKeys(pinIds: number[], db: CreativeDb = prisma) {
  const keys = new Map<number, string>();
  if (pinIds.length === 0) return keys;
  pinIds.forEach(assertPositiveId);
  const rows = await db.$queryRaw<Array<{ id: number; listingId: number; creativeStorageKey: string | null }>>(Prisma.sql`
    SELECT id, listingId, creativeStorageKey FROM pinterest_pins
    WHERE id IN (${Prisma.join([...new Set(pinIds)])})
  `);
  for (const row of rows) {
    if (row.creativeStorageKey === null) continue;
    keys.set(row.id, validatePinCreativeStorageKey(row.creativeStorageKey, row.listingId));
  }
  return keys;
}

/** Attaches an immutable stored image without creating or changing Etsy listing images. */
export async function attachPinCreativeStorageKey(db: CreativeDb, pinId: number, listingId: number, key: string) {
  assertPositiveId(pinId);
  validatePinCreativeStorageKey(key, listingId);
  const changed = await db.$executeRaw`
    UPDATE pinterest_pins SET creativeStorageKey = ${key}
    WHERE id = ${pinId} AND listingId = ${listingId} AND status = 'DRAFT' AND pinterestPinId IS NULL
  `;
  if (changed === 1) return;
  // MySQL can report zero affected rows when the same key is already attached.
  if (changed === 0) {
    const rows = await db.$queryRaw<Array<{ id: number }>>`
      SELECT id FROM pinterest_pins
      WHERE id = ${pinId} AND listingId = ${listingId} AND status = 'DRAFT'
      AND pinterestPinId IS NULL AND creativeStorageKey = ${key}
    `;
    if (rows.length === 1) return;
  }
  throw new Error('Pin creatives can only be attached to an unpublished draft for the same listing.');
}

export async function readPinCreative(key: string, listingId: number) {
  validatePinCreativeStorageKey(key, listingId);
  try {
    const bytes = await readFile(path.join(ETSY_LISTINGS_DIRECTORY, ...key.split('/')));
    if (createHash('sha256').update(bytes).digest('hex') !== CREATIVE_KEY.exec(key)![2]) {
      throw new Error('Creative content changed.');
    }
    return bytes;
  } catch {
    throw new Error('The Pin creative image is unavailable. Restore it before publishing this Pin.');
  }
}
