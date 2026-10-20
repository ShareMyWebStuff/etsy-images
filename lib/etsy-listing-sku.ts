import type { Prisma } from '@prisma/client';

export const ETSY_LISTING_SKU_PREFIX = 'SKU_';
export const ETSY_LISTING_SKU_DIGITS = 6;
export const ETSY_LISTING_SKU_MAX_NUMBER = (10 ** ETSY_LISTING_SKU_DIGITS) - 1;

export function formatEtsyListingSku(sequenceNumber: number) {
  if (!Number.isSafeInteger(sequenceNumber) || sequenceNumber < 1 || sequenceNumber > ETSY_LISTING_SKU_MAX_NUMBER) {
    throw new Error(`The Etsy SKU sequence number must be between 1 and ${ETSY_LISTING_SKU_MAX_NUMBER}.`);
  }
  return `${ETSY_LISTING_SKU_PREFIX}${String(sequenceNumber).padStart(ETSY_LISTING_SKU_DIGITS, '0')}`;
}

export function isGeneratedEtsyListingSku(value: string) {
  return /^SKU_\d{6}$/.test(value);
}

export async function getOrCreateEtsyListingSku(
  tx: Pick<Prisma.TransactionClient, 'etsySkuAllocation'>,
  listingId: number,
) {
  if (!Number.isSafeInteger(listingId) || listingId < 1) throw new Error('Invalid listing id.');
  const allocation = await tx.etsySkuAllocation.upsert({
    where: { listingId },
    create: { listingId },
    update: {},
    select: { sequenceNumber: true },
  });
  return formatEtsyListingSku(allocation.sequenceNumber);
}
