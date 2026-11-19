import { createHash, randomUUID } from 'node:crypto';
import path from 'node:path';
import sharp from 'sharp';
import { getListingForContext, mapEditorData, type ListingEditorContext } from '@/lib/listing-editor';
import { getListingDirectoryPath } from '@/lib/local-shop-directory';
import { prisma } from '@/lib/prisma';
import { readFile, removeStagedListingThumbnail, writeStagedListingThumbnail } from '@/lib/s3-listing-storage';
import { adjustThumbnailGap, analyseThumbnailGap } from '@/lib/thumbnail-gap';
import { effectiveListingCustomisation } from '@/lib/listing-customisation';
import { prepareThumbnailGapGenerationSettings } from '@/lib/thumbnail-gap-generation-settings';

export class ListingThumbnailGapError extends Error {
  constructor(message: string, readonly status = 400) {
    super(message);
    this.name = 'ListingThumbnailGapError';
  }
}

type EditorSource = Awaited<ReturnType<typeof getListingForContext>>;
const PENDING_GENERATION_FINGERPRINT = '0'.repeat(64);

function versionFor(fileName: string, updatedAt: Date | null, contents: Buffer) {
  return createHash('sha256').update(JSON.stringify([fileName, updatedAt?.toISOString() ?? null])).update(contents).digest('hex');
}

async function loadSource(context: ListingEditorContext) {
  let data: EditorSource;
  try { data = await getListingForContext(context); }
  catch (error) {
    if (error instanceof Error && /^(?:Shop|Section|Sub section|Listing) not found\.$/.test(error.message)) {
      throw new ListingThumbnailGapError(error.message, 404);
    }
    throw error;
  }
  if (data.listing.shopId !== data.shop.etsyShopId.toString()) {
    throw new ListingThumbnailGapError('Listing not found in this shop.', 404);
  }
  const fileName = data.listing.thumbnailFileName;
  if (!fileName) return { data, fileName: null, contents: null, listingPath: null, thumbnailVersion: null };
  if (path.basename(fileName) !== fileName || /[\\/]/.test(fileName)) {
    throw new ListingThumbnailGapError('The saved thumbnail filename is invalid.');
  }
  const listingPath = getListingDirectoryPath(
    data.shop.shopName ?? data.shop.title ?? `Shop ${data.shop.etsyShopId}`,
    data.section.title,
    data.subSection.name,
    data.listing.localDirectoryName ?? `Listing-${data.listing.id}`,
  );
  const contents = await readFile(path.join(listingPath, 'thumbnail', fileName));
  return { data, fileName, contents, listingPath, thumbnailVersion: versionFor(fileName, data.listing.thumbnailUpdatedAt, contents) };
}

export async function getListingThumbnailGap(context: ListingEditorContext) {
  const source = await loadSource(context);
  if (!source.contents) return { analysis: null, thumbnailVersion: null, thumbnailIdentity: null };
  return {
    analysis: await analyseThumbnailGap(source.contents),
    thumbnailVersion: source.thumbnailVersion,
    thumbnailIdentity: { fileName: source.fileName!, updatedAt: source.data.listing.thumbnailUpdatedAt?.toISOString() ?? null },
  };
}

function contextGuard(data: EditorSource) {
  return {
    id: data.listing.id,
    shopId: data.listing.shopId,
    subSectionId: data.subSection.id,
    subSection: { is: {
      id: data.subSection.id,
      name: data.subSection.name,
      shopSectionId: data.section.id,
      shopSection: { is: {
        id: data.section.id,
        title: data.section.title,
        OR: [{ shopId: data.shop.id }, { etsyShopId: data.shop.etsyShopId }],
      } },
    } },
  };
}

/** Stage immutable objects first; update the pointer and all dependent state in one transaction. */
export async function adjustListingThumbnailGap(
  context: ListingEditorContext,
  gapPercent: unknown,
  expectedThumbnailVersion: unknown,
) {
  if (typeof gapPercent !== 'number' || !Number.isFinite(gapPercent) || gapPercent < 0 || gapPercent > 20) {
    throw new ListingThumbnailGapError('Enter a thumbnail gap between 0 and 20 percent.');
  }
  if (typeof expectedThumbnailVersion !== 'string' || !/^[a-f0-9]{64}$/.test(expectedThumbnailVersion)) {
    throw new ListingThumbnailGapError('Load the current thumbnail before adjusting its gap.');
  }
  const source = await loadSource(context);
  if (!source.contents || !source.fileName || !source.listingPath) throw new ListingThumbnailGapError('Upload a thumbnail before adjusting its gap.');
  if (source.thumbnailVersion !== expectedThumbnailVersion) {
    throw new ListingThumbnailGapError('The thumbnail changed. Review the current image before adjusting its gap.', 409);
  }
  const adjusted = await adjustThumbnailGap(source.contents, gapPercent);
  if (!adjusted.changed) return { changed: false as const, analysis: adjusted.analysis, thumbnailVersion: source.thumbnailVersion };

  const [before, after] = await Promise.all([
    sharp(source.contents, { failOn: 'error' }).metadata(),
    sharp(adjusted.buffer, { failOn: 'error' }).metadata(),
  ]);
  if (!before.width || !before.height || after.width !== before.width || after.height !== before.height || after.format !== 'png') {
    throw new ListingThumbnailGapError('The adjusted thumbnail must retain its original canvas dimensions as a PNG.');
  }
  const fileName = `thumbnail-gap-${randomUUID()}.png`;
  if (fileName === source.fileName) throw new ListingThumbnailGapError('A unique thumbnail filename could not be created. Please retry.');
  const targetPath = path.join(source.listingPath, 'thumbnail', fileName);
  const changedAt = new Date();
  const data = source.data;
  const generationSettings = prepareThumbnailGapGenerationSettings({
    printCropSettings: data.listing.printCropSettings,
    personalisationTextAreas: data.listing.personalisationTextAreas,
    previousSource: { fileName: source.fileName, updatedAt: data.listing.thumbnailUpdatedAt?.toISOString() ?? null },
    source: { fileName, updatedAt: changedAt.toISOString(), width: before.width, height: before.height },
    orientation: data.listing.artworkOrientation,
    customisation: effectiveListingCustomisation(data.listing.ourCategory, data.listing.productConfig),
  });
  const projected = {
    ...data,
    listing: {
      ...data.listing,
      thumbnailFileName: fileName,
      thumbnailUpdatedAt: changedAt,
      thumbnailWidthPixels: before.width,
      thumbnailHeightPixels: before.height,
      ...generationSettings,
      overviewGenerationFingerprint: PENDING_GENERATION_FINGERPRINT,
      imagesChanged: true,
      downloadsChanged: true,
      downloadsRevision: data.listing.downloadsRevision + 1,
      lastLocalChangeAt: changedAt,
    },
  };
  // Mapping can inspect stored assets. Complete it before writing or committing anything.
  const editorData = await mapEditorData(context, projected);
  const response = {
    changed: true as const,
    analysis: adjusted.analysis,
    thumbnailVersion: versionFor(fileName, changedAt, adjusted.buffer),
    data: editorData,
  };
  let transactionStarted = false;
  try {
    await writeStagedListingThumbnail(targetPath, adjusted.buffer);
    transactionStarted = true;
    await prisma.$transaction(async (transaction) => {
      const claimed = await transaction.etsyListing.updateMany({
        where: {
          ...contextGuard(data),
          thumbnailFileName: source.fileName,
          thumbnailUpdatedAt: data.listing.thumbnailUpdatedAt,
          updatedAt: data.listing.updatedAt,
          lastLocalChangeAt: data.listing.lastLocalChangeAt,
          downloadsRevision: data.listing.downloadsRevision,
        },
        data: {
          thumbnailFileName: fileName,
          thumbnailUpdatedAt: changedAt,
          thumbnailWidthPixels: before.width,
          thumbnailHeightPixels: before.height,
          imagesChanged: true,
          downloadsChanged: true,
          downloadsRevision: { increment: 1 },
          lastLocalChangeAt: changedAt,
        },
      });
      if (claimed.count !== 1) throw new ListingThumbnailGapError('The listing changed while its thumbnail was being processed. Review and retry.', 409);
      await transaction.$executeRaw`
        UPDATE etsy_listings
        SET printCropSettings = ${JSON.stringify(generationSettings.printCropSettings)},
            personalisationTextAreas = ${generationSettings.personalisationTextAreas === null ? null : JSON.stringify(generationSettings.personalisationTextAreas)},
            overviewGenerationFingerprint = ${PENDING_GENERATION_FINGERPRINT}
        WHERE id = ${data.listing.id}
      `;
      await transaction.etsyListing.updateMany({
        where: { groupItems: { some: { sourceListingId: data.listing.id } } },
        data: { imagesChanged: true, downloadsChanged: true, downloadsRevision: { increment: 1 }, lastLocalChangeAt: changedAt },
      });
      await transaction.$executeRaw`
        UPDATE etsy_listings
        SET overviewGenerationFingerprint = ${PENDING_GENERATION_FINGERPRINT}
        WHERE id IN (SELECT groupListingId FROM etsy_listing_group_items WHERE sourceListingId = ${data.listing.id})
      `;
    });
  } catch (error) {
    if (transactionStarted && !(error instanceof ListingThumbnailGapError)) {
      // A lost commit acknowledgement must not delete an image that is now the live pointer.
      let current;
      try {
        current = await prisma.etsyListing.findUnique({ where: { id: data.listing.id }, select: { thumbnailFileName: true } });
      } catch {
        throw new ListingThumbnailGapError('The thumbnail save could not be confirmed. Reload the listing before trying again.', 503);
      }
      if (current?.thumbnailFileName === fileName) return response;
    }
    await removeStagedListingThumbnail(targetPath).catch(() => undefined);
    throw error;
  }
  return response;
}
