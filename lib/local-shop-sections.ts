import { Prisma } from '@prisma/client';
import {
  createSectionDirectory,
  sectionDirectoryExists,
  shopDirectoryExists,
} from '@/lib/local-shop-directory';
import { prisma } from '@/lib/prisma';
import { getEtsyKeystring, getValidEtsyAccessToken } from '@/lib/etsy-oauth';

type LocalShop = {
  id: number;
  etsyShopId: bigint;
  shopName: string | null;
  title: string | null;
};

function normalizeSectionName(sectionName: string) {
  return sectionName.trim();
}

function normalizeForCompare(value: string) {
  return value.trim().toLocaleLowerCase();
}

type EtsyShopSectionResponse = {
  shop_section_id?: number | string;
  title?: string;
  rank?: number;
  active_listing_count?: number;
};

type EtsyCollectionResponse<T> = {
  results?: T[];
};

function getEtsyApiKeyHeader() {
  const sharedSecret = process.env.ETSY_SHARED_SECRET;

  if (!sharedSecret) {
    throw new Error('Missing ETSY_SHARED_SECRET environment variable.');
  }

  return `${getEtsyKeystring()}:${sharedSecret}`;
}

async function fetchEtsySections<T>(shopId: bigint, init?: RequestInit) {
  const accessToken = await getValidEtsyAccessToken();
  const response = await fetch(
    `https://openapi.etsy.com/v3/application/shops/${encodeURIComponent(shopId.toString())}/sections`,
    {
      ...init,
      signal: AbortSignal.timeout(30_000),
      headers: {
        Accept: 'application/json',
        Authorization: `Bearer ${accessToken}`,
        'x-api-key': getEtsyApiKeyHeader(),
        ...init?.headers,
      },
    }
  );
  const responseText = await response.text();

  if (!response.ok) {
    throw new Error(`Etsy API returned ${response.status} ${response.statusText}${responseText ? `: ${responseText}` : ''}`);
  }

  return (responseText ? JSON.parse(responseText) : null) as T;
}

function getShopDisplayName(shop: LocalShop) {
  return shop.shopName ?? shop.title ?? `Shop ${shop.etsyShopId}`;
}

async function getShopByEtsyShopId(shopId: string) {
  let etsyShopId: bigint;

  try {
    etsyShopId = BigInt(shopId);
  } catch {
    throw new Error('Invalid shop id.');
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

  return shop;
}

async function getExistingSectionTitles(shop: LocalShop) {
  const sections = await prisma.etsyShopSection.findMany({
    where: {
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
      title: true,
    },
  });

  return new Set(sections.map((section) => normalizeForCompare(section.title)));
}

async function assertSectionMissingFromDatabase(shop: LocalShop, sectionName: string) {
  const existingSectionTitles = await getExistingSectionTitles(shop);

  if (existingSectionTitles.has(normalizeForCompare(sectionName))) {
    throw new Error(`A section named "${sectionName}" already exists in the database.`);
  }
}

export async function createLocalShopSection(
  shopId: string,
  sectionName: string,
  numberOfDownloads: number | null,
  includeAllDownloads: boolean,
  roomTheme: string
) {
  const shop = await getShopByEtsyShopId(shopId);
  const shopName = getShopDisplayName(shop);
  const trimmedSectionName = normalizeSectionName(sectionName);
  const trimmedRoomTheme = roomTheme.trim();
  if (Array.from(trimmedRoomTheme).length > 200) throw new Error('The room theme cannot be longer than 200 characters.');
  const savedRoomTheme = includeAllDownloads || (numberOfDownloads ?? 1) > 1 ? null : trimmedRoomTheme || null;

  if (!(await shopDirectoryExists(shopName))) {
    throw new Error(`The local shop folder "${shopName}" does not exist.`);
  }

  await assertSectionMissingFromDatabase(shop, trimmedSectionName);

  if (await sectionDirectoryExists(shopName, trimmedSectionName)) {
    throw new Error(`A local folder named "${trimmedSectionName}" already exists for this shop. Use Import instead.`);
  }

  await createSectionDirectory(shopName, trimmedSectionName);
  const section = await prisma.etsyShopSection.create({
    data: {
      shopId: shop.id,
      etsyShopId: shop.etsyShopId,
      title: trimmedSectionName,
      roomTheme: savedRoomTheme,
      rawJson: Prisma.JsonNull,
      numberOfDownloads: includeAllDownloads ? 1 : numberOfDownloads ?? 1,
      includeAllDownloads,
    },
    select: {
      id: true,
    },
  });

  await prisma.etsyShopSubSection.create({
    data: {
      shopSectionId: section.id,
      name: trimmedSectionName,
      numberOfDownloads: includeAllDownloads ? null : numberOfDownloads ?? 1,
      includeAllDownloads,
    },
  });

  return section;
}

export async function createOrLinkEtsyShopSection(shopId: string, sectionId: string) {
  const shop = await getShopByEtsyShopId(shopId);
  const numericSectionId = Number(sectionId);

  if (!Number.isInteger(numericSectionId)) {
    throw new Error('Invalid section id.');
  }

  const localSection = await prisma.etsyShopSection.findFirst({
    where: {
      id: numericSectionId,
      OR: [{ shopId: shop.id }, { etsyShopId: shop.etsyShopId }],
    },
    select: { id: true, title: true, etsyShopSectionId: true },
  });

  if (!localSection) {
    throw new Error('Section not found.');
  }

  if (localSection.etsyShopSectionId !== null) {
    const etsyShopSectionId = Number(localSection.etsyShopSectionId);

    return prisma.$transaction(async (tx) => {
      const section = await tx.etsyShopSection.update({
        where: { id: localSection.id },
        data: {
          shopId: shop.id,
          etsyShopId: shop.etsyShopId,
        },
      });

      await tx.etsyListing.updateMany({
        where: {
          shopId: shop.etsyShopId.toString(),
          shopSectionId: null,
          subSection: { shopSectionId: localSection.id },
        },
        data: { shopSectionId: etsyShopSectionId },
      });

      return section;
    });
  }

  const response = await fetchEtsySections<EtsyCollectionResponse<EtsyShopSectionResponse>>(shop.etsyShopId);
  let etsySection = (response.results ?? []).find(
    (section) => section.title && normalizeForCompare(section.title) === normalizeForCompare(localSection.title)
  );

  if (!etsySection) {
    etsySection = await fetchEtsySections<EtsyShopSectionResponse>(shop.etsyShopId, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ title: localSection.title }),
    });
  }

  if (etsySection.shop_section_id === undefined || etsySection.shop_section_id === null) {
    throw new Error('Etsy did not return a shop section id.');
  }

  const etsyShopSectionId = Number(etsySection.shop_section_id);

  return prisma.$transaction(async (tx) => {
    const section = await tx.etsyShopSection.update({
      where: { id: localSection.id },
      data: {
        shopId: shop.id,
        etsyShopId: shop.etsyShopId,
        etsyShopSectionId: String(etsySection.shop_section_id),
        rank: etsySection.rank ?? null,
        activeListingCount: etsySection.active_listing_count ?? null,
        rawJson: JSON.parse(JSON.stringify(etsySection)) as Prisma.InputJsonValue,
        downloadedAt: new Date(),
      },
    });

    await tx.etsyListing.updateMany({
      where: {
        shopId: shop.etsyShopId.toString(),
        shopSectionId: null,
        subSection: { shopSectionId: localSection.id },
      },
      data: { shopSectionId: etsyShopSectionId },
    });

    return section;
  });
}

export async function renameShopSection(shopId: string, sectionId: string, sectionName: string) {
  const shop = await getShopByEtsyShopId(shopId);
  const numericSectionId = Number(sectionId);
  const trimmedSectionName = normalizeSectionName(sectionName);
  if (!Number.isInteger(numericSectionId)) throw new Error('Invalid section id.');
  if (!trimmedSectionName) throw new Error('Section name is required.');

  const section = await prisma.etsyShopSection.findFirst({
    where: { id: numericSectionId, OR: [{ shopId: shop.id }, { etsyShopId: shop.etsyShopId }] },
    select: { id: true, title: true, etsyShopSectionId: true },
  });
  if (!section) throw new Error('Section not found.');

  const duplicate = await prisma.etsyShopSection.findFirst({
    where: { id: { not: section.id }, OR: [{ shopId: shop.id }, { etsyShopId: shop.etsyShopId }], title: trimmedSectionName },
    select: { id: true },
  });
  if (duplicate) throw new Error(`A section named "${trimmedSectionName}" already exists.`);

  if (section.etsyShopSectionId !== null) {
    const accessToken = await getValidEtsyAccessToken();
    const response = await fetch(
      `https://openapi.etsy.com/v3/application/shops/${encodeURIComponent(shop.etsyShopId.toString())}/sections/${encodeURIComponent(section.etsyShopSectionId)}`,
      {
        method: 'PUT',
        signal: AbortSignal.timeout(30_000),
        headers: {
          Accept: 'application/json',
          Authorization: `Bearer ${accessToken}`,
          'x-api-key': getEtsyApiKeyHeader(),
          'Content-Type': 'application/x-www-form-urlencoded',
        },
        body: new URLSearchParams({ title: trimmedSectionName }),
      }
    );
    const responseText = await response.text();
    if (!response.ok) {
      throw new Error(`Etsy API returned ${response.status} ${response.statusText}${responseText ? `: ${responseText}` : ''}`);
    }
  }

  return prisma.$transaction(async (tx) => {
    await tx.etsyShopSubSection.updateMany({
      where: { shopSectionId: section.id, name: section.title },
      data: { name: trimmedSectionName },
    });
    return tx.etsyShopSection.update({
      where: { id: section.id },
      data: { title: trimmedSectionName, downloadedAt: new Date() },
    });
  });
}

export async function deleteEtsyShopSection(sectionId: string) {
  const numericSectionId = Number(sectionId);
  if (!Number.isInteger(numericSectionId)) throw new Error('Invalid section id.');

  const section = await prisma.etsyShopSection.findUnique({
    where: { id: numericSectionId },
    include: {
      shop: true,
      subSections: {
        select: {
          listings: { where: { etsyId: { not: null } }, select: { id: true }, take: 1 },
        },
      },
    },
  });
  if (!section?.shop) throw new Error('Section context not found.');
  if (section.etsyShopSectionId === null) throw new Error('This section has not been added to Etsy.');
  if (section.subSections.some((subSection) => subSection.listings.length > 0)) {
    throw new Error('Delete the synced Etsy listings before deleting this Etsy section.');
  }

  const accessToken = await getValidEtsyAccessToken();
  const response = await fetch(
    `https://openapi.etsy.com/v3/application/shops/${encodeURIComponent(section.shop.etsyShopId.toString())}/sections/${encodeURIComponent(section.etsyShopSectionId)}`,
    {
      method: 'DELETE',
      signal: AbortSignal.timeout(30_000),
      headers: {
        Accept: 'application/json',
        Authorization: `Bearer ${accessToken}`,
        'x-api-key': getEtsyApiKeyHeader(),
      },
    }
  );
  const responseText = await response.text();
  if (!response.ok) {
    throw new Error(`Etsy API returned ${response.status} ${response.statusText}${responseText ? `: ${responseText}` : ''}`);
  }

  return prisma.$transaction(async (tx) => {
    await tx.etsyListing.updateMany({
      where: { subSection: { shopSectionId: section.id } },
      data: { shopSectionId: null },
    });
    return tx.etsyShopSection.update({
      where: { id: section.id },
      data: {
        etsyShopSectionId: null,
        rank: null,
        activeListingCount: 0,
        rawJson: Prisma.JsonNull,
      },
    });
  });
}

export async function deleteLocalShopSection(shopId: string, sectionId: string) {
  const shop = await getShopByEtsyShopId(shopId);
  const numericSectionId = Number(sectionId);

  if (!Number.isInteger(numericSectionId)) {
    throw new Error('Invalid section id.');
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
      etsyShopSectionId: true,
      title: true,
      activeListingCount: true,
    },
  });

  if (!section) {
    throw new Error('Section not found.');
  }

  const listingCount = await prisma.etsyListing.count({
    where: { subSection: { shopSectionId: section.id } },
  });

  if (listingCount > 0 || (section.activeListingCount ?? 0) > 0) {
    throw new Error(`Cannot delete "${section.title}" because it has listings.`);
  }

  await prisma.etsyShopSection.delete({
    where: {
      id: section.id,
    },
  });
}
