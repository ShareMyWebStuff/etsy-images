import { Prisma } from '@prisma/client';

import { prisma } from '@/lib/prisma';

type GenerationWriter = Pick<Prisma.TransactionClient, '$executeRaw'>;

export type ListingImageGenerationState = {
  revision: number;
  generatedRevision: number;
  needsRegeneration: boolean;
};

/** Local rendering state is separate from imagesChanged, which tracks Etsy sync. */
export async function invalidateListingImageGeneration(listingIds: number[], transaction: GenerationWriter = prisma) {
  const ids = [...new Set(listingIds)];
  if (ids.some((id) => !Number.isSafeInteger(id) || id < 1)) throw new Error('Invalid listing id.');
  if (!ids.length) return;
  await transaction.$executeRaw(Prisma.sql`
    UPDATE etsy_listings
    SET listingImagesRevision = listingImagesRevision + 1
    WHERE id IN (${Prisma.join(ids)})
  `);
}

export async function readListingImageGenerationState(listingId: number): Promise<ListingImageGenerationState> {
  const rows = await prisma.$queryRaw<Array<{
    listingImagesRevision: number;
    listingImagesGeneratedRevision: number;
  }>>(Prisma.sql`
    SELECT listingImagesRevision, listingImagesGeneratedRevision
    FROM etsy_listings WHERE id = ${listingId}
  `);
  const revision = Number(rows[0]?.listingImagesRevision ?? 0);
  const generatedRevision = Number(rows[0]?.listingImagesGeneratedRevision ?? 0);
  return { revision, generatedRevision, needsRegeneration: generatedRevision < revision };
}

export async function listingsNeedingImageGeneration(listingIds: number[]): Promise<Set<number>> {
  if (!listingIds.length) return new Set();
  const rows = await prisma.$queryRaw<Array<{ id: number }>>(Prisma.sql`
    SELECT id FROM etsy_listings
    WHERE id IN (${Prisma.join(listingIds)})
      AND listingImagesGeneratedRevision < listingImagesRevision
  `);
  return new Set(rows.map(({ id }) => Number(id)));
}

export async function recordListingTemplateImageRevision(listingId: number, templateId: number, revision: number) {
  await prisma.$executeRaw(Prisma.sql`
    UPDATE etsy_listing_images SET templateGenerationRevision = ${revision}
    WHERE listingId = ${listingId} AND ourCategoryImageTemplateId = ${templateId}
  `);
}

/** A failed, partial or superseded generation must keep the listing pending. */
export async function markListingImageGenerationComplete(listingId: number, revision: number, expectedTemplateIds?: number[]) {
  const ids = expectedTemplateIds === undefined ? undefined : [...new Set(expectedTemplateIds)];
  if (ids?.some((id) => !Number.isSafeInteger(id) || id < 1)) throw new Error('Invalid image template id.');
  const eligibleTemplates = ids === undefined ? Prisma.empty
    : ids.length ? Prisma.sql`AND template.id IN (${Prisma.join(ids)})` : Prisma.sql`AND 1 = 0`;
  await prisma.$executeRaw(Prisma.sql`
    UPDATE etsy_listings listing
    SET listing.listingImagesGeneratedRevision = ${revision}
    WHERE listing.id = ${listingId} AND listing.listingImagesRevision = ${revision}
      AND NOT EXISTS (
        SELECT 1 FROM our_category_image_templates template
        WHERE template.categoryId = listing.ourCategoryId
          ${eligibleTemplates}
          AND NOT EXISTS (
            SELECT 1 FROM etsy_listing_images image
            WHERE image.listingId = listing.id AND image.ourCategoryImageTemplateId = template.id
              AND image.templateGenerationRevision = ${revision}
          )
      )
  `);
}
