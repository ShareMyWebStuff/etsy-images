import { prisma } from '@/lib/prisma';
import { renameSubSectionDirectory } from '@/lib/local-shop-directory';

export const SINGLE_LISTINGS_SUB_SECTION_NAME = 'SingleListings';

export type ShopSubSectionsPageData = {
  shop: {
    id: string;
    shopName: string;
  };
  section: {
    id: string;
    sectionName: string;
  };
  subSections: Array<{
    id: string;
    name: string;
    noOfListings: number;
    numberOfDownloads: number | null;
    includeAllDownloads: boolean;
    isSingleListings: boolean;
  }>;
};

type CreateShopSubSectionInput = {
  shopId: string;
  sectionId: string;
  name: string;
  numberOfDownloads?: number | null;
  includeAllDownloads: boolean;
};

function normalizeName(name: string) {
  return name.trim();
}

function normalizeForCompare(value: string) {
  return value.trim().toLocaleLowerCase();
}

async function getShopSection(shopId: string, sectionId: string) {
  let etsyShopId: bigint;
  const numericSectionId = Number(sectionId);

  try {
    etsyShopId = BigInt(shopId);
  } catch {
    throw new Error('Invalid shop id.');
  }

  if (!Number.isInteger(numericSectionId)) {
    throw new Error('Invalid section id.');
  }

  const shop = await prisma.etsyShop.findUnique({
    where: {
      etsyShopId,
    },
    select: {
      id: true,
      etsyShopId: true,
      shopName: true,
      title: true,
    },
  });

  if (!shop) {
    throw new Error('Shop not found.');
  }

  const section = await prisma.etsyShopSection.findFirst({
    where: {
      id: numericSectionId,
      OR: [
        {
          shopId: shop.id,
        },
        {
          etsyShopId: shop.etsyShopId,
        },
      ],
    },
    select: {
      id: true,
      title: true,
    },
  });

  if (!section) {
    throw new Error('Section not found.');
  }

  return {
    shop,
    section,
  };
}

export async function ensureSingleListingsSubSection(shopSectionId: number) {
  return prisma.etsyShopSubSection.upsert({
    where: {
      shopSectionId_name: {
        shopSectionId,
        name: SINGLE_LISTINGS_SUB_SECTION_NAME,
      },
    },
    update: {},
    create: {
      shopSectionId,
      name: SINGLE_LISTINGS_SUB_SECTION_NAME,
      includeAllDownloads: true,
    },
    select: {
      id: true,
    },
  });
}

export async function getShopSubSectionsPageData(shopId: string, sectionId: string): Promise<ShopSubSectionsPageData | null> {
  let shopSection;

  try {
    shopSection = await getShopSection(shopId, sectionId);
  } catch {
    return null;
  }

  await ensureSingleListingsSubSection(shopSection.section.id);

  const subSections = await prisma.etsyShopSubSection.findMany({
    where: {
      shopSectionId: shopSection.section.id,
    },
    orderBy: [{ name: 'asc' }],
    select: {
      id: true,
      name: true,
      numberOfDownloads: true,
      includeAllDownloads: true,
      _count: {
        select: {
          listings: true,
        },
      },
    },
  });
  const sectionWithEtsyId = await prisma.etsyShopSection.findUnique({
    where: {
      id: shopSection.section.id,
    },
    select: {
      etsyShopSectionId: true,
    },
  });
  const singleListingsUnassignedCount =
    sectionWithEtsyId?.etsyShopSectionId === null
      ? 0
      : await prisma.etsyListing.count({
          where: {
            shopId: shopSection.shop.etsyShopId.toString(),
            shopSectionId: Number(sectionWithEtsyId?.etsyShopSectionId),
            subSectionId: null,
          },
        });

  return {
    shop: {
      id: shopSection.shop.etsyShopId.toString(),
      shopName: shopSection.shop.shopName ?? shopSection.shop.title ?? `Shop ${shopSection.shop.etsyShopId}`,
    },
    section: {
      id: String(shopSection.section.id),
      sectionName: shopSection.section.title,
    },
    subSections: subSections
      .map((subSection) => ({
          id: String(subSection.id),
          name: subSection.name,
          noOfListings:
            subSection.name === SINGLE_LISTINGS_SUB_SECTION_NAME
              ? subSection._count.listings + singleListingsUnassignedCount
              : subSection._count.listings,
          numberOfDownloads: subSection.numberOfDownloads,
          includeAllDownloads: subSection.includeAllDownloads,
          isSingleListings: subSection.name === SINGLE_LISTINGS_SUB_SECTION_NAME,
        }))
      .sort((first, second) => {
        if (first.isSingleListings) {
          return -1;
        }

        if (second.isSingleListings) {
          return 1;
        }

        if (first.includeAllDownloads !== second.includeAllDownloads) {
          return first.includeAllDownloads ? 1 : -1;
        }

        const firstDownloads = first.numberOfDownloads ?? Number.MAX_SAFE_INTEGER;
        const secondDownloads = second.numberOfDownloads ?? Number.MAX_SAFE_INTEGER;
        return firstDownloads - secondDownloads || first.name.localeCompare(second.name);
      }),
  };
}

export async function createShopSubSection(input: CreateShopSubSectionInput) {
  const name = normalizeName(input.name);

  if (!name) {
    throw new Error('Enter a sub section name.');
  }

  if (normalizeForCompare(name) === normalizeForCompare(SINGLE_LISTINGS_SUB_SECTION_NAME)) {
    throw new Error(`${SINGLE_LISTINGS_SUB_SECTION_NAME} is created automatically.`);
  }

  const allowedDownloadCounts = new Set([1, 3, 6, 12]);
  if (!input.includeAllDownloads && !allowedDownloadCounts.has(input.numberOfDownloads ?? 0)) {
    throw new Error('Choose 1, 3, 6, 12, or All downloads.');
  }

  const { section } = await getShopSection(input.shopId, input.sectionId);
  await ensureSingleListingsSubSection(section.id);

  const existingSubSections = await prisma.etsyShopSubSection.findMany({
    where: {
      shopSectionId: section.id,
    },
    select: {
      name: true,
    },
  });
  const existingNames = new Set(existingSubSections.map((subSection) => normalizeForCompare(subSection.name)));

  if (existingNames.has(normalizeForCompare(name))) {
    throw new Error(`A sub section named "${name}" already exists.`);
  }

  return prisma.etsyShopSubSection.create({
    data: {
      shopSectionId: section.id,
      name,
      includeAllDownloads: input.includeAllDownloads,
      numberOfDownloads: input.includeAllDownloads ? null : input.numberOfDownloads,
    },
    select: {
      id: true,
    },
  });
}

export async function renameShopSubSection(
  shopId: string,
  sectionId: string,
  subSectionId: string,
  requestedName: string
) {
  const name = normalizeName(requestedName);
  if (!name) throw new Error('Enter a sub section name.');
  if (normalizeForCompare(name) === normalizeForCompare(SINGLE_LISTINGS_SUB_SECTION_NAME)) {
    throw new Error(`The name ${SINGLE_LISTINGS_SUB_SECTION_NAME} is reserved.`);
  }

  const { shop, section } = await getShopSection(shopId, sectionId);
  const numericSubSectionId = Number(subSectionId);
  if (!Number.isInteger(numericSubSectionId)) throw new Error('Invalid sub section id.');

  const subSection = await prisma.etsyShopSubSection.findFirst({
    where: { id: numericSubSectionId, shopSectionId: section.id },
    select: { id: true, name: true },
  });
  if (!subSection) throw new Error('Sub section not found.');
  if (subSection.name === SINGLE_LISTINGS_SUB_SECTION_NAME) {
    throw new Error(`${SINGLE_LISTINGS_SUB_SECTION_NAME} cannot be renamed.`);
  }
  if (subSection.name === name) return;

  const duplicate = await prisma.etsyShopSubSection.findFirst({
    where: {
      shopSectionId: section.id,
      id: { not: subSection.id },
      name,
    },
    select: { id: true },
  });
  if (duplicate) throw new Error(`A sub section named "${name}" already exists.`);

  const shopName = shop.shopName ?? shop.title ?? `Shop ${shop.etsyShopId}`;
  const directoryRenamed = await renameSubSectionDirectory(shopName, section.title, subSection.name, name);

  try {
    await prisma.etsyShopSubSection.update({
      where: { id: subSection.id },
      data: { name },
    });
  } catch (error) {
    if (directoryRenamed) {
      await renameSubSectionDirectory(shopName, section.title, name, subSection.name);
    }
    throw error;
  }
}

export async function deleteShopSubSection(shopId: string, sectionId: string, subSectionId: string) {
  const { section } = await getShopSection(shopId, sectionId);
  const numericSubSectionId = Number(subSectionId);

  if (!Number.isInteger(numericSubSectionId)) {
    throw new Error('Invalid sub section id.');
  }

  const subSection = await prisma.etsyShopSubSection.findFirst({
    where: {
      id: numericSubSectionId,
      shopSectionId: section.id,
    },
    select: {
      id: true,
      name: true,
      _count: {
        select: {
          listings: true,
        },
      },
    },
  });

  if (!subSection) {
    throw new Error('Sub section not found.');
  }

  if (subSection.name === SINGLE_LISTINGS_SUB_SECTION_NAME) {
    throw new Error(`${SINGLE_LISTINGS_SUB_SECTION_NAME} cannot be deleted.`);
  }

  if (subSection._count.listings > 0) {
    throw new Error(`Cannot delete "${subSection.name}" because it has listings.`);
  }

  await prisma.etsyShopSubSection.delete({
    where: {
      id: subSection.id,
    },
  });
}
