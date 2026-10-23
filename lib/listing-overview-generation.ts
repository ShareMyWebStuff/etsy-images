import { createHash } from 'node:crypto';
import { Prisma } from '@prisma/client';
import {
  generateListingDetailsWithBedrock,
  generateMultipleListingDetailsWithBedrock,
} from '@/lib/bedrock-listing-details';
import {
  createDropboxInstructionPdf,
  createGroupedDropboxInstructionPdf,
  createOrUpdateDropbox,
  isDropboxInstructionPdfFile,
} from '@/lib/dropbox-bundle';
import {
  deleteAllListingImages,
  generateListingHowToPrintGuide,
  generateListingPrintableDownload,
  generateListingTemplateImages,
  getListingEditorData,
  type ListingEditorContext,
  type ListingEditorData,
} from '@/lib/listing-editor';
import { prisma } from '@/lib/prisma';
import { getPrintableDownloadStatus, PRINTABLE_DOWNLOAD_SPECS } from '@/lib/printable-download-specs';

const GENERATION_FINGERPRINT_VERSION = 2;

type StoredFingerprintRow = { overviewGenerationFingerprint: string | null };

export type ListingOverviewGenerationResult = {
  data: ListingEditorData;
  generation: {
    regenerated: boolean;
    baselineCreated: boolean;
  };
};

function stableValue(value: unknown): unknown {
  if (value instanceof Date) return value.toISOString();
  if (typeof value === 'bigint') return value.toString();
  if (Array.isArray(value)) return value.map(stableValue);
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value)
      .filter(([, item]) => item !== undefined)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, item]) => [key, stableValue(item)]));
  }
  return value;
}

export function createListingOverviewFingerprint(value: unknown) {
  return createHash('sha256').update(JSON.stringify(stableValue(value))).digest('hex');
}

async function storedFingerprint(listingId: number) {
  const rows = await prisma.$queryRaw<StoredFingerprintRow[]>(Prisma.sql`
    SELECT overviewGenerationFingerprint
    FROM etsy_listings
    WHERE id = ${listingId}
    LIMIT 1
  `);
  return rows[0]?.overviewGenerationFingerprint ?? null;
}

async function saveFingerprint(listingId: number, fingerprint: string) {
  await prisma.$executeRaw(Prisma.sql`
    UPDATE etsy_listings
    SET overviewGenerationFingerprint = ${fingerprint}
    WHERE id = ${listingId}
  `);
}

async function loadGenerationSnapshot(context: ListingEditorContext) {
  const listingId = Number(context.listingId);
  if (!Number.isSafeInteger(listingId) || listingId < 1) throw new Error('Invalid listing id.');

  const [data, listing, previousFingerprint] = await Promise.all([
    getListingEditorData(context),
    prisma.etsyListing.findUnique({
      where: { id: listingId },
      select: {
        id: true,
        localDirectoryName: true,
        listingItem: true,
        listingDescription: true,
        roomTheme: true,
        backgroundColour: true,
        title: true,
        description: true,
        digitalTitle: true,
        digitalDescription: true,
        thumbnailFileName: true,
        thumbnailOriginalFileName: true,
        thumbnailUpdatedAt: true,
        numberOfItems: true,
        includeAllItems: true,
        etsyProductType: true,
        downloadsRevision: true,
        dropboxRevision: true,
        dropboxSyncedAt: true,
        tags: {
          orderBy: [{ position: 'asc' }, { id: 'asc' }],
          select: { tag: true, position: true },
        },
        materials: {
          orderBy: [{ position: 'asc' }, { id: 'asc' }],
          select: { material: true, position: true },
        },
        productConfig: {
          select: {
            giftMessageEnabled: true,
            customTop: true,
            customBottom: true,
            customisePrints: true,
            digitalDownload: true,
            printsFrames: true,
          },
        },
        ourCategory: {
          select: {
            id: true,
            name: true,
            templateType: true,
            followedTemplateId: true,
            itemCount: true,
            roomTheme: true,
            backgroundColour: true,
            printsFrames: true,
            customisePrints: true,
            digitalDownload: true,
            customTop: true,
            customBottom: true,
            printFrameSectionId: true,
            customisedSectionId: true,
            downloadSectionId: true,
            sizes: true,
            frames: true,
            updatedAt: true,
            imageTemplates: {
              orderBy: [{ position: 'asc' }, { id: 'asc' }],
              select: {
                id: true,
                name: true,
                description: true,
                imagePath: true,
                originalFileName: true,
                sizeBytes: true,
                imageWidth: true,
                imageHeight: true,
                openingCorners: true,
                openingRegions: true,
                displayFonts: true,
                borderEnabled: true,
                borderSizePercent: true,
                topText: true,
                bottomText: true,
                fontId: true,
                position: true,
                useOnPrints: true,
                useOnCustomised: true,
                useOnDigital: true,
                linkedSourceCategoryId: true,
                linkedSourceImageTemplateId: true,
                linkedImageItemNumber: true,
                updatedAt: true,
                linkedSourceImageTemplate: {
                  select: {
                    id: true,
                    imagePath: true,
                    originalFileName: true,
                    sizeBytes: true,
                    imageWidth: true,
                    imageHeight: true,
                    openingCorners: true,
                    openingRegions: true,
                    displayFonts: true,
                    borderEnabled: true,
                    borderSizePercent: true,
                    topText: true,
                    bottomText: true,
                    fontId: true,
                    useOnPrints: true,
                    useOnCustomised: true,
                    useOnDigital: true,
                    updatedAt: true,
                  },
                },
              },
            },
          },
        },
        groupItems: {
          orderBy: [{ position: 'asc' }, { id: 'asc' }],
          select: {
            position: true,
            sourceListingId: true,
            sourceListing: {
              select: {
                localDirectoryName: true,
                title: true,
                listingItem: true,
                listingDescription: true,
                artworkOrientation: true,
                roomTheme: true,
                primaryColour: true,
                secondaryColour: true,
                thumbnailFileName: true,
                thumbnailUpdatedAt: true,
                downloadsRevision: true,
                dropboxRevision: true,
                dropboxSyncedAt: true,
                dropboxBundle: { select: { sharedUrl: true } },
                ourCategory: { select: { roomTheme: true } },
              },
            },
          },
        },
        images: {
          orderBy: [{ rank: 'asc' }, { id: 'asc' }],
          select: {
            localFileName: true,
            originalFileName: true,
            rank: true,
            fullWidth: true,
            fullHeight: true,
            ourCategoryImageTemplateId: true,
          },
        },
        files: {
          orderBy: [{ rank: 'asc' }, { id: 'asc' }],
          select: {
            localFileName: true,
            originalFileName: true,
            filename: true,
            rank: true,
            sizeBytes: true,
            widthPixels: true,
            heightPixels: true,
            jpegQuality: true,
            rawJson: true,
          },
        },
        dropboxBundle: { select: { folderPath: true, sharedUrl: true } },
      },
    }),
    storedFingerprint(listingId),
  ]);

  if (!data || !listing) throw new Error('Listing not found.');

  const fingerprint = createListingOverviewFingerprint({
    version: GENERATION_FINGERPRINT_VERSION,
    sectionName: data.section.sectionName,
    subSectionName: data.subSection.name,
    personalisationTextAreas: data.listing.personalisationTextAreas,
    artworkOrientation: data.listing.artworkOrientation,
    printCropSettings: data.listing.printCropSettings,
    listing,
  });
  const hasInstructions = listing.files.some(isDropboxInstructionPdfFile);
  const incompleteItems: string[] = [];
  if (!data.template) {
    incompleteItems.push('listing template');
  } else {
    if (data.template.imageTemplates.length === 0) {
      incompleteItems.push('image templates (the selected template has none)');
    } else {
      incompleteItems.push(...data.template.imageTemplates
        .filter((template) => !template.generated)
        .map((template) => `image "${template.name}"`));
    }

    if (!data.listing.title.trim()) incompleteItems.push('print title');
    if (!data.listing.description.trim()) incompleteItems.push('print description');
    if (!data.listing.digitalTitle.trim()) incompleteItems.push('digital-download title');
    if (!data.listing.digitalDescription.trim()) incompleteItems.push('digital-download description');
    if (data.tags.length === 0) incompleteItems.push('Etsy tags');
    if ((data.listing.quantity ?? 0) <= 0) incompleteItems.push('print quantity');
    if ((data.listing.digitalQuantity ?? 0) <= 0) incompleteItems.push('digital-download quantity');
    if (!data.listing.primaryColour.trim()) incompleteItems.push('primary colour');
    if (!data.listing.secondaryColour.trim()) incompleteItems.push('secondary colour');

    if (data.template.templateType === 'multiple') {
      if (!hasInstructions) incompleteItems.push('grouped download instructions PDF');
    } else {
      const downloads = getPrintableDownloadStatus(listing.files);
      incompleteItems.push(...downloads.items
        .filter((item) => !item.created)
        .map((item) => `${item.label} digital download`));
      if (!downloads.guideCreated) incompleteItems.push('How to Print guide');
      if (!downloads.complete && downloads.items.every((item) => item.created) && downloads.guideCreated) {
        incompleteItems.push('digital downloads with one consistent orientation');
      }
      if (!hasInstructions) incompleteItems.push('Dropbox download instructions PDF');
      if (!data.dropbox.current) incompleteItems.push('current Dropbox upload');
    }
  }

  return {
    data,
    fingerprint,
    previousFingerprint,
    complete: incompleteItems.length === 0,
    incompleteItems,
  };
}

export async function recordCurrentListingOverviewFingerprint(context: ListingEditorContext) {
  const snapshot = await loadGenerationSnapshot(context);
  if (!snapshot.complete) {
    throw new Error(
      `The listing generation fingerprint cannot be recorded because these items are incomplete: ${snapshot.incompleteItems.join(', ')}.`,
    );
  }
  await saveFingerprint(Number(context.listingId), snapshot.fingerprint);
  return snapshot.data;
}

async function regenerateListingOverview(context: ListingEditorContext) {
  const current = await getListingEditorData(context);
  if (!current) throw new Error('Listing not found.');
  if (current.template?.templateType !== 'multiple') {
    if (!current.listing.printCropSettings) throw new Error('Complete Set Size before generating this listing.');
    if (current.etsyProducts.config.customisePrints && !current.listing.personalisationTextAreas) {
      throw new Error('Complete Set Text Areas before generating this listing.');
    }
  }
  await deleteAllListingImages(context);
  await generateListingTemplateImages(context);
  const data = await getListingEditorData(context);
  if (!data) throw new Error('Listing not found.');

  if (data.template?.templateType === 'multiple') {
    await generateMultipleListingDetailsWithBedrock(context);
    await createGroupedDropboxInstructionPdf(context);
  } else {
    await generateListingDetailsWithBedrock(context);
    for (const spec of PRINTABLE_DOWNLOAD_SPECS) await generateListingPrintableDownload(context, spec.key);
    await generateListingHowToPrintGuide(context);
    await createOrUpdateDropbox(context);
    await createDropboxInstructionPdf(context);
  }
}

export async function generateListingOverview(
  context: ListingEditorContext,
  mode: 'all' | 'changed',
): Promise<ListingOverviewGenerationResult> {
  const before = await loadGenerationSnapshot(context);
  if (mode === 'changed' && before.complete) {
    if (before.previousFingerprint === before.fingerprint) {
      return { data: before.data, generation: { regenerated: false, baselineCreated: false } };
    }
    if (!before.previousFingerprint) {
      // Existing completed listings predate fingerprint tracking. Record their
      // current state once so the first Only Changed run does not rebuild all
      // legacy listings unnecessarily.
      await saveFingerprint(Number(context.listingId), before.fingerprint);
      return { data: before.data, generation: { regenerated: false, baselineCreated: true } };
    }
  }

  await regenerateListingOverview(context);
  const after = await loadGenerationSnapshot(context);
  if (!after.complete) {
    throw new Error(`Generation finished, but these items are still incomplete: ${after.incompleteItems.join(', ')}.`);
  }
  await saveFingerprint(Number(context.listingId), after.fingerprint);
  return { data: after.data, generation: { regenerated: true, baselineCreated: false } };
}
