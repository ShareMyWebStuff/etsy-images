import path from 'node:path';
import { Prisma } from '@prisma/client';

import { prisma } from '@/lib/prisma';
import { getListingEditorData, getListingForContext, type ListingEditorContext } from '@/lib/listing-editor';
import { effectiveListingCustomisation } from '@/lib/listing-customisation';
import { invalidateListingImageGeneration } from '@/lib/listing-image-generation-state';
import { removeListingImages } from '@/lib/listing-image-reset';
import { ensureListingProductDefaultsInTransaction } from '@/lib/listing-products';
import { getListingDirectoryPath } from '@/lib/local-shop-directory';
import { listGeneratedListingImageFiles } from '@/lib/s3-listing-storage';

const PENDING_GENERATION_FINGERPRINT = '0'.repeat(64);
const GENERATED_IMAGE_NAME = /^template-[1-9]\d*\.png$/i;
type GeneratedImageRow = { id: number; localFileName: string | null; ourCategoryImageTemplateId: number | null; updatedAt: Date };

function isGeneratedImage(image: Pick<GeneratedImageRow, 'localFileName' | 'ourCategoryImageTemplateId'>) {
  return image.ourCategoryImageTemplateId !== null
    || (image.localFileName !== null && GENERATED_IMAGE_NAME.test(image.localFileName));
}

function generatedImageSnapshot(images: GeneratedImageRow[]) {
  return JSON.stringify(images.filter(isGeneratedImage).sort((a, b) => a.id - b.id).map((image) => [
    image.id, image.localFileName, image.ourCategoryImageTemplateId, image.updatedAt.toISOString(),
  ]));
}

export class ListingTemplateAssignmentError extends Error {
  constructor(message: string, readonly status = 400) {
    super(message);
    this.name = 'ListingTemplateAssignmentError';
  }
}

export type ListingTemplateOption = {
  id: string;
  name: string;
  templateType: 'single' | 'multiple';
  itemCount: number;
};

export function listingTemplateContext(input: Record<string, unknown>): ListingEditorContext {
  const keys = ['shopId', 'sectionId', 'subSectionId', 'listingId'] as const;
  for (const key of keys) {
    const value = input[key];
    if (typeof value !== 'string' || !/^\d+$/.test(value) || BigInt(value) < 1n
      || (key !== 'shopId' && !Number.isSafeInteger(Number(value)))) {
      throw new ListingTemplateAssignmentError('Missing or invalid listing context.');
    }
  }
  return Object.fromEntries(keys.map((key) => [key, input[key]])) as ListingEditorContext;
}

async function loadContext(context: ListingEditorContext) {
  listingTemplateContext(context);
  try {
    const data = await getListingForContext(context);
    if (data.listing.shopId !== data.shop.etsyShopId.toString()) {
      throw new ListingTemplateAssignmentError('Listing not found in this shop.', 404);
    }
    return data;
  } catch (error) {
    if (error instanceof Error && /^(?:Shop|Section|Sub section|Listing) not found\.$/.test(error.message)) {
      throw new ListingTemplateAssignmentError(error.message, 404);
    }
    throw error;
  }
}

function validTemplate(template: { templateType: string; itemCount: number; followedTemplateId?: number | null }) {
  if (template.templateType === 'single' && template.itemCount === 1) return;
  if (template.templateType === 'multiple' && [3, 6, 12].includes(template.itemCount)
    && Number.isSafeInteger(template.followedTemplateId) && template.followedTemplateId! > 0) return;
  throw new ListingTemplateAssignmentError('The selected template has invalid type or item settings.');
}

export async function getListingTemplateOptions(context: ListingEditorContext) {
  const data = await loadContext(context);
  const rows = await prisma.ourCategory.findMany({
    where: { shopId: data.shop.id },
    select: { id: true, name: true, templateType: true, itemCount: true, followedTemplateId: true },
    orderBy: [{ name: 'asc' }, { id: 'asc' }],
  });
  const templates: ListingTemplateOption[] = rows.filter((row) => {
    try { validTemplate(row); return true; } catch { return false; }
  }).map((row) => ({ id: String(row.id), name: row.name,
    templateType: row.templateType as 'single' | 'multiple', itemCount: row.itemCount }));
  return { templates, currentTemplateId: data.listing.ourCategoryId === null ? null : String(data.listing.ourCategoryId) };
}

async function refreshedEditor(context: ListingEditorContext) {
  const data = await getListingEditorData(context);
  if (!data) throw new ListingTemplateAssignmentError('The template was saved, but the listing could not be reloaded. Reload this listing.', 503);
  return data;
}

export async function assignListingTemplate(context: ListingEditorContext, templateId: unknown) {
  if (typeof templateId !== 'string' || !/^[1-9]\d*$/.test(templateId) || !Number.isSafeInteger(Number(templateId))) {
    throw new ListingTemplateAssignmentError('Choose a valid template.');
  }
  const data = await loadContext(context);
  const id = Number(templateId);
  const target = await prisma.ourCategory.findFirst({ where: { id, shopId: data.shop.id } });
  if (!target) throw new ListingTemplateAssignmentError('The selected template was not found for this shop.', 404);
  validTemplate(target);
  if (data.listing.ourCategoryId === id) return refreshedEditor(context);

  const listingPath = getListingDirectoryPath(data.shop.shopName ?? data.shop.title ?? `Shop ${data.shop.etsyShopId}`,
    data.section.title, data.subSection.name, data.listing.localDirectoryName ?? `Listing-${data.listing.id}`);
  const generatedRows = data.listing.images.filter(isGeneratedImage);
  const previousGeneratedImages = generatedImageSnapshot(generatedRows);
  const discovered = await listGeneratedListingImageFiles(listingPath);
  const removal = [...generatedRows, ...discovered.filter((name) => GENERATED_IMAGE_NAME.test(name)).map((localFileName) => ({ localFileName }))];
  const changedAt = new Date();

  await removeListingImages(listingPath, removal, async () => {
    await prisma.$transaction(async (transaction) => {
      const currentTarget = await transaction.ourCategory.findFirst({ where: { id, shopId: data.shop.id } });
      if (!currentTarget || currentTarget.updatedAt.getTime() !== target.updatedAt.getTime()) {
        throw new ListingTemplateAssignmentError('The selected template changed. Reload the choices and try again.', 409);
      }
      validTemplate(currentTarget);
      const claimed = await transaction.etsyListing.updateMany({
        where: {
          id: data.listing.id, shopId: data.listing.shopId, subSectionId: data.subSection.id,
          ourCategoryId: data.listing.ourCategoryId, updatedAt: data.listing.updatedAt,
          lastLocalChangeAt: data.listing.lastLocalChangeAt,
          subSection: { is: { id: data.subSection.id, name: data.subSection.name, shopSectionId: data.section.id,
            shopSection: { is: { id: data.section.id, title: data.section.title,
              OR: [{ shopId: data.shop.id }, { etsyShopId: data.shop.etsyShopId }] } } } },
        },
        data: {
          ourCategoryId: id, numberOfItems: currentTarget.itemCount, includeAllItems: false,
          // A previously inherited theme follows the new template; explicit listing values remain.
          ...(data.listing.roomTheme === data.listing.ourCategory?.roomTheme ? { roomTheme: currentTarget.roomTheme } : {}),
          detailsChanged: true, imagesChanged: true, downloadsChanged: true, productsChanged: true,
          downloadsRevision: { increment: 1 }, lastLocalChangeAt: changedAt,
        },
      });
      if (claimed.count !== 1) throw new ListingTemplateAssignmentError('The listing changed. Reload it and try again.', 409);

      // Claim the listing row before checking its children, matching generation's lock order.
      // A render can upsert an image before it updates the listing's own timestamp.
      const currentImages = await transaction.etsyListingImage.findMany({
        where: { listingId: data.listing.id },
        select: { id: true, localFileName: true, ourCategoryImageTemplateId: true, updatedAt: true },
      });
      if (generatedImageSnapshot(currentImages) !== previousGeneratedImages) {
        throw new ListingTemplateAssignmentError('Generated photos changed while the template was being switched. Reload and try again.', 409);
      }

      if (generatedRows.length) await transaction.etsyListingImage.deleteMany({
        where: { listingId: data.listing.id, id: { in: generatedRows.map((image) => image.id) } },
      });

      const groups = await transaction.etsyListingGroupItem.findMany({
        where: { groupListingId: data.listing.id },
        select: { id: true, position: true, sourceListingId: true, sourceListing: { select: { shopId: true, ourCategoryId: true } } },
      });
      const compatibleGroup = currentTarget.templateType === 'multiple' && groups.length === currentTarget.itemCount
        && new Set(groups.map((group) => group.sourceListingId)).size === groups.length
        && groups.every((group) => group.sourceListingId !== data.listing.id
          && group.sourceListing.shopId === data.listing.shopId
          && group.sourceListing.ourCategoryId === currentTarget.followedTemplateId)
        && groups.map((group) => group.position).sort((a, b) => a - b).every((position, index) => position === index + 1);
      if (groups.length && !compatibleGroup) await transaction.etsyListingGroupItem.deleteMany({ where: { groupListingId: data.listing.id } });

      const parents = await transaction.etsyListingGroupItem.findMany({
        where: { sourceListingId: data.listing.id },
        select: { id: true, groupListingId: true, groupListing: { select: {
          shopId: true, ourCategory: { select: { templateType: true, followedTemplateId: true } },
        } } },
      });
      const incompatibleParentIds = parents.filter(({ groupListing }) => groupListing.shopId !== data.listing.shopId
        || groupListing.ourCategory?.templateType !== 'multiple' || groupListing.ourCategory.followedTemplateId !== id).map((group) => group.id);
      if (incompatibleParentIds.length) await transaction.etsyListingGroupItem.deleteMany({ where: { id: { in: incompatibleParentIds } } });
      const parentIds = [...new Set(parents.map((group) => group.groupListingId))].filter((parentId) => parentId !== data.listing.id);
      if (parentIds.length) await transaction.etsyListing.updateMany({
        where: { id: { in: parentIds } },
        data: { imagesChanged: true, downloadsChanged: true, downloadsRevision: { increment: 1 }, lastLocalChangeAt: changedAt },
      });

      if (data.listing.productConfig) {
        const oldTemplate = data.listing.ourCategory;
        // Stored false values forced by the old template are not listing opt-outs of newly available capabilities.
        const customisation = effectiveListingCustomisation(currentTarget, {
          customisePrints: oldTemplate?.customisePrints ? data.listing.productConfig.customisePrints : true,
          customTop: oldTemplate?.customisePrints && oldTemplate.customTop ? data.listing.productConfig.customTop : true,
          customBottom: oldTemplate?.customisePrints && oldTemplate.customBottom ? data.listing.productConfig.customBottom : true,
        });
        await transaction.etsyListingProductConfig.updateMany({ where: { listingId: data.listing.id }, data: { ...customisation, confirmedAt: null } });
      }
      await ensureListingProductDefaultsInTransaction(transaction, data.listing.id, { preserveExistingSkus: true });
      const invalidatedIds = [data.listing.id, ...parentIds];
      await invalidateListingImageGeneration(invalidatedIds, transaction);
      await transaction.$executeRaw(Prisma.sql`
        UPDATE etsy_listings SET overviewGenerationFingerprint = ${PENDING_GENERATION_FINGERPRINT}
        WHERE id IN (${Prisma.join(invalidatedIds)})
      `);
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable, timeout: 30_000 });
  });
  return refreshedEditor(context);
}
