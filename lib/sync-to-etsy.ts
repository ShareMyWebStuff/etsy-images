import { prisma } from '@/lib/prisma';
import { SINGLE_LISTINGS_SUB_SECTION_NAME } from '@/lib/shop-sub-sections';
import { deleteListingFromEtsy, makeListingInactive, publishListing, syncListingToEtsy } from '@/lib/local-listings';
import { createOrLinkEtsyShopSection } from '@/lib/local-shop-sections';
import { resolveEtsyListingMode } from '@/lib/etsy-product-inventory';
import { inspectListingZipStorage, isDropboxInstructionPdfFile } from '@/lib/dropbox-bundle';
import { getListingDirectoryPath } from '@/lib/local-shop-directory';

const MAX_ETSY_ZIP_SIZE_BYTES = 20 * 1024 * 1024;

export type SyncToEtsyData = {
  sections: Array<{
    id: string;
    shopId: string;
    sectionName: string;
    showSubject: boolean;
    hasEtsySection: boolean;
    hasSyncedListings: boolean;
    listings: Array<{ id: string; listingName: string; subjectName: string; localDirectoryName: string | null; subSectionId: string; subSectionName: string; hasEtsyListing: boolean; isSynced: boolean; isPublished: boolean; isInactive: boolean; canSync: boolean; pendingChanges: string[]; syncDisabledReason: string | null; etsyProductType: 'physical' | 'digital'; etsyListingMode: 'physical' | 'download' | 'both'; etsyCategory: string; listOnEtsy: boolean }>;
  }>;
};

export async function getSyncToEtsyData(): Promise<SyncToEtsyData> {
  const sections = await prisma.etsyShopSection.findMany({
    where: { shop: { isNot: null } },
    orderBy: [{ title: 'asc' }],
    include: {
      shop: { select: { etsyShopId: true, shopName: true, title: true } },
      subSections: {
        include: {
          listings: {
            orderBy: [{ localDirectoryName: 'asc' }, { title: 'asc' }],
            include: {
              sourceSection: { select: { title: true } },
              zippedFiles: { select: { fileName: true, sizeBytes: true } },
              files: { select: { localFileName: true, sizeBytes: true, rawJson: true } },
              dropboxFiles: {
                select: {
                  groupNumber: true,
                  sourceListingId: true,
                  sourceDirectoryName: true,
                  localFileName: true,
                  originalFileName: true,
                },
              },
              productConfig: { select: { listOnEtsy: true, digitalDownload: true } },
            },
          },
        },
      },
    },
  });

  return {
    sections: await Promise.all(sections.map(async (section) => ({
      id: String(section.id),
      shopId: section.shop!.etsyShopId.toString(),
      sectionName: section.title,
      showSubject: section.includeAllDownloads || [3, 6, 12].includes(section.numberOfDownloads),
      hasEtsySection: section.etsyShopSectionId !== null,
      hasSyncedListings: section.subSections.some((subSection) => subSection.listings.some((listing) => listing.etsyId !== null)),
      listings: await Promise.all(section.subSections
        .sort((a, b) => {
          if (a.name === SINGLE_LISTINGS_SUB_SECTION_NAME) return -1;
          if (b.name === SINGLE_LISTINGS_SUB_SECTION_NAME) return 1;
          return a.name.localeCompare(b.name);
        })
        .flatMap((subSection) => subSection.listings.map(async (listing) => {
          const hasZippedFiles = listing.zippedFiles.length > 0;
          const hasDropboxPdf = listing.files.some((file) =>
            isDropboxInstructionPdfFile(file)
            && /\.pdf$/i.test(file.localFileName ?? '')
            && (file.sizeBytes ?? 0) <= MAX_ETSY_ZIP_SIZE_BYTES
          );
          const hasEtsyDownloads = hasZippedFiles || hasDropboxPdf;
          const hasOversizedZip = listing.zippedFiles.some((zip) => zip.sizeBytes > MAX_ETSY_ZIP_SIZE_BYTES);
          const etsyProductType = listing.etsyProductType === 'digital' ? 'digital' as const : 'physical' as const;
          const etsyListingMode = resolveEtsyListingMode(
            etsyProductType,
            listing.productConfig?.digitalDownload ?? false
          ).listingType;
          const requiresEtsyDownloads = etsyListingMode === 'download' || etsyListingMode === 'both';
          const listingPath = getListingDirectoryPath(
            section.shop!.shopName ?? section.shop!.title ?? `Shop ${section.shop!.etsyShopId}`,
            section.title,
            subSection.name,
            listing.localDirectoryName ?? `Listing-${listing.id}`,
          );
          const zipStorageStatus = requiresEtsyDownloads
            ? await inspectListingZipStorage(listing, listingPath)
            : null;
          const zipsAreCurrent = zipStorageStatus?.valid ?? true;
          const listOnEtsy = listing.productConfig?.listOnEtsy ?? true;
          const pendingChanges = [
            listing.detailsChanged ? 'Details' : null,
            listing.tagsChanged ? 'Tags' : null,
            listing.imagesChanged ? 'Images' : null,
            listing.downloadsChanged ? 'Downloads' : null,
            listing.productsChanged ? 'Etsy Products' : null,
          ].filter((area): area is string => area !== null);
          const needsSync = listing.etsyId === null || pendingChanges.length > 0;
          const sectionEtsyId = section.etsyShopSectionId === null ? null : Number(section.etsyShopSectionId);
          const hasCurrentSection = sectionEtsyId !== null && listing.shopSectionId === sectionEtsyId;
          return {
            id: String(listing.id),
            listingName: listing.localDirectoryName ?? listing.title,
            subjectName: listing.sourceSection?.title ?? 'Uncategorised',
            localDirectoryName: listing.localDirectoryName,
            subSectionId: String(subSection.id),
            subSectionName: subSection.name,
            etsyProductType,
            etsyListingMode,
            etsyCategory: etsyProductType === 'digital' ? 'Digital Prints' : 'Giclée Prints',
            listOnEtsy,
            hasEtsyListing: listing.etsyId !== null,
            isSynced: listing.etsyId !== null && listing.state === 'draft' && !needsSync && hasCurrentSection,
            isPublished: listing.etsyId !== null && (listing.state === 'active' || listing.state === 'published'),
            isInactive: listing.etsyId !== null && listing.state === 'inactive',
            canSync: listOnEtsy
              ? (!requiresEtsyDownloads || (hasEtsyDownloads && zipsAreCurrent && !hasOversizedZip)) && needsSync
              : listing.etsyId !== null && listing.productsChanged,
            pendingChanges: listing.etsyId === null ? ['New listing'] : pendingChanges,
            syncDisabledReason: !listOnEtsy && listing.etsyId === null
              ? 'This listing is set not to be listed on Etsy.'
              : requiresEtsyDownloads && !hasEtsyDownloads
              ? 'Create the ZIP files or Dropbox PDF before syncing.'
              : requiresEtsyDownloads && !zipsAreCurrent
                ? zipStorageStatus?.message ?? 'Create the ZIP files before syncing.'
              : requiresEtsyDownloads && hasOversizedZip
                ? 'Each ZIP file must be 20 MB or smaller.'
                : !needsSync
                  ? 'No local changes have been made since the last Etsy sync.'
                  : null,
          };
        }))),
    }))),
  };
}

export async function syncOneListing(listingId: string) {
  const listing = await prisma.etsyListing.findUnique({
    where: { id: Number(listingId) },
    include: {
      zippedFiles: { select: { fileName: true, sizeBytes: true } },
      files: { select: { localFileName: true, sizeBytes: true, rawJson: true } },
      dropboxFiles: {
        select: {
          groupNumber: true,
          sourceListingId: true,
          sourceDirectoryName: true,
          localFileName: true,
          originalFileName: true,
        },
      },
      productConfig: { select: { listOnEtsy: true, digitalDownload: true } },
      subSection: { include: { shopSection: { include: { shop: true } } } },
    },
  });
  const section = listing?.subSection?.shopSection;
  const shop = section?.shop;
  if (!listing || !listing.subSection || !section || !shop) throw new Error('Listing context not found.');
  if (listing.productConfig?.listOnEtsy === false) {
    if (listing.etsyId !== null) {
      if (listing.state === 'active' || listing.state === 'published') {
        await makeListingInactive(shop.etsyShopId.toString(), String(section.id), String(listing.subSection.id), String(listing.id));
      } else if (listing.state !== 'inactive') {
        // Etsy documents Draft -> Publish/Delete, while deactivation is for a
        // previously published listing. Remove a draft when it is explicitly unset.
        await deleteListingFromEtsy(shop.etsyShopId.toString(), String(section.id), String(listing.subSection.id), String(listing.id));
      }
      await prisma.etsyListing.update({
        where: { id: listing.id },
        data: {
          productsChanged: false,
          lastSyncedAt: listing.state === 'active' || listing.state === 'published' || listing.state === 'inactive'
            ? new Date()
            : null,
        },
      });
    }
    return;
  }
  if (listing.etsyId !== null
    && !listing.detailsChanged
    && !listing.tagsChanged
    && !listing.imagesChanged
    && !listing.downloadsChanged
    && !listing.productsChanged) {
    throw new Error('No local changes have been made since the last Etsy sync.');
  }
  const hasDropboxPdf = listing.files.some((file) =>
    isDropboxInstructionPdfFile(file)
    && /\.pdf$/i.test(file.localFileName ?? '')
    && (file.sizeBytes ?? 0) <= MAX_ETSY_ZIP_SIZE_BYTES
  );
  const etsyListingMode = resolveEtsyListingMode(
    listing.etsyProductType,
    listing.productConfig?.digitalDownload ?? false
  ).listingType;
  const requiresEtsyDownloads = etsyListingMode === 'download' || etsyListingMode === 'both';
  if (requiresEtsyDownloads && listing.zippedFiles.length === 0 && !hasDropboxPdf) {
    throw new Error('Create the ZIP files or Dropbox PDF before syncing.');
  }
  if (requiresEtsyDownloads) {
    const listingPath = getListingDirectoryPath(
      shop.shopName ?? shop.title ?? `Shop ${shop.etsyShopId}`,
      section.title,
      listing.subSection.name,
      listing.localDirectoryName ?? `Listing-${listing.id}`,
    );
    const zipStorageStatus = await inspectListingZipStorage(listing, listingPath);
    if (!zipStorageStatus.valid) {
      throw new Error(zipStorageStatus.message ?? 'Create the ZIP files before syncing.');
    }
  }
  if (requiresEtsyDownloads && listing.zippedFiles.some((zip) => zip.sizeBytes > MAX_ETSY_ZIP_SIZE_BYTES)) {
    throw new Error('Each ZIP file must be 20 MB or smaller.');
  }
  await syncListingToEtsy(shop.etsyShopId.toString(), String(section.id), String(listing.subSection.id), String(listing.id));
}

export async function publishOneListing(listingId: string) {
  const listing = await prisma.etsyListing.findUnique({
    where: { id: Number(listingId) },
    include: { subSection: { include: { shopSection: { include: { shop: true } } } } },
  });
  const section = listing?.subSection?.shopSection;
  const shop = section?.shop;
  if (!listing || !listing.subSection || !section || !shop) throw new Error('Listing context not found.');
  await publishListing(shop.etsyShopId.toString(), String(section.id), String(listing.subSection.id), String(listing.id));
}

export async function makeOneListingInactive(listingId: string) {
  const listing = await prisma.etsyListing.findUnique({
    where: { id: Number(listingId) },
    include: { subSection: { include: { shopSection: { include: { shop: true } } } } },
  });
  const section = listing?.subSection?.shopSection;
  const shop = section?.shop;
  if (!listing || !listing.subSection || !section || !shop) throw new Error('Listing context not found.');
  if (listing.state !== 'active' && listing.state !== 'published') throw new Error('Only a published listing can be made inactive.');
  await makeListingInactive(shop.etsyShopId.toString(), String(section.id), String(listing.subSection.id), String(listing.id));
}

export async function deleteOneListingFromEtsy(listingId: string) {
  const listing = await prisma.etsyListing.findUnique({
    where: { id: Number(listingId) },
    include: { subSection: { include: { shopSection: { include: { shop: true } } } } },
  });
  const section = listing?.subSection?.shopSection;
  const shop = section?.shop;
  if (!listing || !listing.subSection || !section || !shop) throw new Error('Listing context not found.');
  await deleteListingFromEtsy(shop.etsyShopId.toString(), String(section.id), String(listing.subSection.id), String(listing.id));
}

export async function syncSectionListings(sectionId: string) {
  const section = await prisma.etsyShopSection.findUnique({
    where: { id: Number(sectionId) },
    include: { shop: true },
  });
  if (!section?.shop) throw new Error('Section context not found.');
  if (section.etsyShopSectionId === null) {
    await createOrLinkEtsyShopSection(section.shop.etsyShopId.toString(), String(section.id));
  }
}
