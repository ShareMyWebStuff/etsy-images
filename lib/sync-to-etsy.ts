import { prisma } from '@/lib/prisma';
import { SINGLE_LISTINGS_SUB_SECTION_NAME } from '@/lib/shop-sub-sections';
import { deleteListingFromEtsy, makeListingInactive, publishListing, syncListingToEtsy } from '@/lib/local-listings';
import { createOrLinkEtsyShopSection } from '@/lib/local-shop-sections';

const MAX_ETSY_ZIP_SIZE_BYTES = 20 * 1024 * 1024;

export type SyncToEtsyData = {
  sections: Array<{
    id: string;
    shopId: string;
    sectionName: string;
    showSubject: boolean;
    hasEtsySection: boolean;
    hasSyncedListings: boolean;
    listings: Array<{ id: string; listingName: string; subjectName: string; localDirectoryName: string | null; subSectionId: string; subSectionName: string; hasEtsyListing: boolean; isSynced: boolean; isPublished: boolean; isInactive: boolean; canSync: boolean; pendingChanges: string[]; syncDisabledReason: string | null }>;
  }>;
};

export async function getSyncToEtsyData(): Promise<SyncToEtsyData> {
  const sections = await prisma.etsyShopSection.findMany({
    where: { shop: { isNot: null } },
    orderBy: [{ title: 'asc' }],
    include: {
      shop: { select: { etsyShopId: true } },
      subSections: {
        include: {
          listings: {
            orderBy: [{ localDirectoryName: 'asc' }, { title: 'asc' }],
            include: {
              sourceSection: { select: { title: true } },
              zippedFiles: { select: { sizeBytes: true } },
              files: { select: { localFileName: true, sizeBytes: true } },
            },
          },
        },
      },
    },
  });

  return {
    sections: sections.map((section) => ({
      id: String(section.id),
      shopId: section.shop!.etsyShopId.toString(),
      sectionName: section.title,
      showSubject: section.includeAllDownloads || [3, 6, 12].includes(section.numberOfDownloads),
      hasEtsySection: section.etsyShopSectionId !== null,
      hasSyncedListings: section.subSections.some((subSection) => subSection.listings.some((listing) => listing.etsyId !== null)),
      listings: section.subSections
        .sort((a, b) => {
          if (a.name === SINGLE_LISTINGS_SUB_SECTION_NAME) return -1;
          if (b.name === SINGLE_LISTINGS_SUB_SECTION_NAME) return 1;
          return a.name.localeCompare(b.name);
        })
        .flatMap((subSection) => subSection.listings.map((listing) => {
          const hasZippedFiles = listing.zippedFiles.length > 0;
          const hasDropboxPdf = listing.files.length === 1
            && /\.pdf$/i.test(listing.files[0].localFileName ?? '')
            && (listing.files[0].sizeBytes ?? 0) <= MAX_ETSY_ZIP_SIZE_BYTES;
          const hasEtsyDownloads = hasZippedFiles || hasDropboxPdf;
          const hasOversizedZip = listing.zippedFiles.some((zip) => zip.sizeBytes > MAX_ETSY_ZIP_SIZE_BYTES);
          const pendingChanges = [
            listing.detailsChanged ? 'Details' : null,
            listing.tagsChanged ? 'Tags' : null,
            listing.imagesChanged ? 'Images' : null,
            listing.downloadsChanged ? 'Downloads' : null,
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
            hasEtsyListing: listing.etsyId !== null,
            isSynced: listing.etsyId !== null && listing.state === 'draft' && !needsSync && hasCurrentSection,
            isPublished: listing.etsyId !== null && (listing.state === 'active' || listing.state === 'published'),
            isInactive: listing.etsyId !== null && listing.state === 'inactive',
            canSync: hasEtsyDownloads && !hasOversizedZip && needsSync,
            pendingChanges: listing.etsyId === null ? ['New listing'] : pendingChanges,
            syncDisabledReason: !hasEtsyDownloads
              ? 'Create the ZIP files or Dropbox PDF before syncing.'
              : hasOversizedZip
                ? 'Each ZIP file must be 20 MB or smaller.'
                : !needsSync
                  ? 'No local changes have been made since the last Etsy sync.'
                  : null,
          };
        })),
    })),
  };
}

export async function syncOneListing(listingId: string) {
  const listing = await prisma.etsyListing.findUnique({
    where: { id: Number(listingId) },
    include: {
      zippedFiles: { select: { sizeBytes: true } },
      files: { select: { localFileName: true, sizeBytes: true } },
      subSection: { include: { shopSection: { include: { shop: true } } } },
    },
  });
  const section = listing?.subSection?.shopSection;
  const shop = section?.shop;
  if (!listing || !listing.subSection || !section || !shop) throw new Error('Listing context not found.');
  if (listing.etsyId !== null
    && !listing.detailsChanged
    && !listing.tagsChanged
    && !listing.imagesChanged
    && !listing.downloadsChanged) {
    throw new Error('No local changes have been made since the last Etsy sync.');
  }
  const hasDropboxPdf = listing.files.length === 1
    && /\.pdf$/i.test(listing.files[0].localFileName ?? '')
    && (listing.files[0].sizeBytes ?? 0) <= MAX_ETSY_ZIP_SIZE_BYTES;
  if (listing.zippedFiles.length === 0 && !hasDropboxPdf) {
    throw new Error('Create the ZIP files or Dropbox PDF before syncing.');
  }
  if (listing.zippedFiles.some((zip) => zip.sizeBytes > MAX_ETSY_ZIP_SIZE_BYTES)) {
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
