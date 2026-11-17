import { createHash } from 'node:crypto';
import { Prisma } from '@prisma/client';

import { buildPersonalizationQuestions } from '@/lib/etsy-product-inventory';
import type { ListingCustomisationSettings } from '@/lib/listing-customisation';
import { prisma } from '@/lib/prisma';

export type EtsyPersonalisationSyncState = { print: string | null; customised: string | null };
export type EtsyPersonalisationVariant = keyof EtsyPersonalisationSyncState;

/** Tracks the exact questions and remote listing, independently of other Etsy variants. */
export function etsyPersonalisationFingerprint(etsyListingId: string, settings: ListingCustomisationSettings) {
  return createHash('sha256').update(JSON.stringify({
    version: 1,
    etsyListingId,
    questions: buildPersonalizationQuestions(settings.customisePrints, settings.customTop, settings.customBottom),
  })).digest('hex');
}

export async function loadEtsyPersonalisationSyncStates(listingIds: number[]) {
  if (listingIds.length === 0) return new Map<number, EtsyPersonalisationSyncState>();
  // Raw access also works with the development server's existing Prisma client
  // after the additive migration, without restarting that server.
  const rows = await prisma.$queryRaw<Array<{
    id: number;
    etsyPrintPersonalisationFingerprint: string | null;
    etsyCustomisedPersonalisationFingerprint: string | null;
  }>>(Prisma.sql`
    SELECT id, etsyPrintPersonalisationFingerprint, etsyCustomisedPersonalisationFingerprint
    FROM etsy_listings WHERE id IN (${Prisma.join([...new Set(listingIds)])})
  `);
  return new Map(rows.map((row) => [row.id, {
    print: row.etsyPrintPersonalisationFingerprint,
    customised: row.etsyCustomisedPersonalisationFingerprint,
  }]));
}

export async function recordEtsyPersonalisationSync(
  listingId: number,
  variant: EtsyPersonalisationVariant,
  etsyListingId: string,
  fingerprint: string,
) {
  const changed = variant === 'print'
    ? await prisma.$executeRaw`
        UPDATE etsy_listings SET etsyPrintPersonalisationFingerprint = ${fingerprint}
        WHERE id = ${listingId} AND etsyPrintId = ${etsyListingId}
      `
    : await prisma.$executeRaw`
        UPDATE etsy_listings SET etsyCustomisedPersonalisationFingerprint = ${fingerprint}
        WHERE id = ${listingId} AND etsyCustomisedId = ${etsyListingId}
      `;
  if (changed === 1) return;
  if (changed === 0) {
    const rows = variant === 'print'
      ? await prisma.$queryRaw<Array<{ id: number }>>`
          SELECT id FROM etsy_listings WHERE id = ${listingId} AND etsyPrintId = ${etsyListingId}
          AND etsyPrintPersonalisationFingerprint = ${fingerprint}
        `
      : await prisma.$queryRaw<Array<{ id: number }>>`
          SELECT id FROM etsy_listings WHERE id = ${listingId} AND etsyCustomisedId = ${etsyListingId}
          AND etsyCustomisedPersonalisationFingerprint = ${fingerprint}
        `;
    if (rows.length === 1) return;
  }
  throw new Error('The Etsy listing link changed while personalisation was syncing. Refresh the listing and retry.');
}
