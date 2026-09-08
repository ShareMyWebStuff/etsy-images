import { updateEtsyListingPrice } from '@/lib/local-listings';
import { prisma } from '@/lib/prisma';

export type PriceUpdateData = {
  sections: Array<{
    id: string;
    name: string;
    shopName: string;
    listingCount: number;
  }>;
};

export async function getPriceUpdateData(): Promise<PriceUpdateData> {
  const sections = await prisma.etsyShopSection.findMany({
    where: { shop: { isNot: null } },
    orderBy: [{ title: 'asc' }],
    include: {
      shop: { select: { shopName: true, title: true, etsyShopId: true } },
      subSections: {
        orderBy: [{ name: 'asc' }],
        select: { id: true, name: true, _count: { select: { listings: true } } },
      },
    },
  });

  return {
    sections: sections.map((section) => ({
      id: String(section.id),
      name: section.title,
      shopName: section.shop?.shopName ?? section.shop?.title ?? `Shop ${section.shop?.etsyShopId ?? ''}`,
      listingCount: section.subSections.reduce((total, subSection) => total + subSection._count.listings, 0),
    })),
  };
}

export type BulkPriceUpdateResult = {
  localUpdated: number;
  etsyUpdated: number;
  etsyFailed: number;
  failures: string[];
};

export async function updateSectionPrices(sectionId: string, priceAmount: number): Promise<BulkPriceUpdateResult> {
  const numericSectionId = Number(sectionId);
  if (!Number.isInteger(numericSectionId)) throw new Error('Choose a valid section.');
  if (!Number.isInteger(priceAmount) || priceAmount <= 0) throw new Error('Enter a valid price greater than zero.');

  const section = await prisma.etsyShopSection.findUnique({
    where: { id: numericSectionId },
    include: {
      shop: true,
      subSections: { include: { listings: { orderBy: [{ localDirectoryName: 'asc' }, { title: 'asc' }], select: { id: true, etsyId: true, title: true, localDirectoryName: true } } } },
    },
  });
  if (!section?.shop) throw new Error('Section context not found.');
  const listings = section.subSections.flatMap((subSection) => subSection.listings);

  const changedAt = new Date();
  const localUpdate = await prisma.etsyListing.updateMany({
    where: { subSection: { shopSectionId: section.id } },
    data: {
      priceAmount,
      priceDivisor: 100,
      priceCurrencyCode: 'GBP',
      lastLocalChangeAt: changedAt,
      detailsChanged: true,
    },
  });

  let etsyUpdated = 0;
  const failures: string[] = [];
  for (const listing of listings) {
    if (!listing.etsyId) continue;
    try {
      await updateEtsyListingPrice(section.shop.etsyShopId.toString(), listing.etsyId, priceAmount);
      await prisma.etsyListing.update({ where: { id: listing.id }, data: { lastSyncedAt: new Date(), detailsChanged: false } });
      etsyUpdated += 1;
    } catch (error) {
      failures.push(`${listing.localDirectoryName ?? listing.title}: ${error instanceof Error ? error.message : 'Etsy update failed.'}`);
    }
  }

  return { localUpdated: localUpdate.count, etsyUpdated, etsyFailed: failures.length, failures };
}
