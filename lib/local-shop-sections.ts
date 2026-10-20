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

async function fetchEtsySections<T>(shopId: bigint, init?: RequestInit, sectionId?: number) {
  const accessToken = await getValidEtsyAccessToken();
  const response = await fetch(
    `https://openapi.etsy.com/v3/application/shops/${encodeURIComponent(shopId.toString())}/sections${sectionId === undefined ? '' : `/${encodeURIComponent(sectionId)}`}`,
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

export type EtsyDownloadSectionOption = { id: number; title: string };
export type EtsySectionUsage = 'printFrames' | 'customisedPrints' | 'digitalDownloads';
export type RegisteredEtsySectionOption = {
  id: number;
  etsyShopSectionId: number;
  title: string;
  useForPrintFrames: boolean;
  useForCustomisedPrints: boolean;
  useForDigitalDownloads: boolean;
};

export type EtsyCategoryListRow = RegisteredEtsySectionOption & {
  listingCount: number;
};

export type EtsyCategoriesPageData = {
  shopId: string;
  categories: EtsyCategoryListRow[];
};

type RegisteredEtsySectionRow = RegisteredEtsySectionOption;

async function getRegisteredEtsySections(etsyShopId: bigint): Promise<RegisteredEtsySectionOption[]> {
  const rows = await prisma.$queryRaw<RegisteredEtsySectionRow[]>`
    SELECT id, etsyShopSectionId, title, useForPrintFrames, useForCustomisedPrints, useForDigitalDownloads
    FROM etsy_download_sections
    WHERE etsyShopId = ${etsyShopId}
    ORDER BY title, id
  `;
  return rows.map((row) => ({
    ...row,
    useForPrintFrames: Boolean(row.useForPrintFrames),
    useForCustomisedPrints: Boolean(row.useForCustomisedPrints),
    useForDigitalDownloads: Boolean(row.useForDigitalDownloads),
  }));
}

async function getRemoteEtsyShopSections(shop: LocalShop): Promise<EtsyDownloadSectionOption[]> {
  const response = await fetchEtsySections<EtsyCollectionResponse<EtsyShopSectionResponse>>(shop.etsyShopId);
  return (response.results ?? [])
    .map((section) => ({ id: Number(section.shop_section_id), title: section.title?.trim() ?? '' }))
    .filter((section) => Number.isSafeInteger(section.id) && section.id > 0 && section.id <= 2_147_483_647 && section.title);
}

export async function getRemoteEtsySectionIds(shopId: string) {
  const shop = await getShopByEtsyShopId(shopId);
  return (await getRemoteEtsyShopSections(shop)).map((section) => section.id);
}

export async function getEtsyDownloadSections(shopId: string): Promise<EtsyDownloadSectionOption[]> {
  const shop = await getShopByEtsyShopId(shopId);
  const [registered, remote] = await Promise.all([
    getRegisteredEtsySections(shop.etsyShopId),
    getRemoteEtsyShopSections(shop),
  ]);
  const registeredIds = new Set(
    registered.filter((section) => section.useForDigitalDownloads).map((section) => section.etsyShopSectionId),
  );
  return remote
    .filter((section) => registeredIds.has(section.id))
    .sort((first, second) => first.title.localeCompare(second.title));
}

export async function registerEtsySection(
  shopId: string,
  title: string,
  requestedUsages: EtsySectionUsage | EtsySectionUsage[],
): Promise<RegisteredEtsySectionOption> {
  const usages = Array.isArray(requestedUsages) ? [...new Set(requestedUsages)] : [requestedUsages];
  if (usages.length === 0 || usages.some((usage) => !['printFrames', 'customisedPrints', 'digitalDownloads'].includes(usage))) {
    throw new Error('Select at least one Etsy section product type.');
  }
  const shop = await getShopByEtsyShopId(shopId);
  const trimmedTitle = title.trim();
  if (!trimmedTitle) throw new Error('Enter an Etsy section name.');
  if (trimmedTitle.length > 191) throw new Error('The Etsy section name must be 191 characters or fewer.');
  const remoteSections = await getRemoteEtsyShopSections(shop);
  const matchingRemote = remoteSections.find((section) => normalizeForCompare(section.title) === normalizeForCompare(trimmedTitle));
  const created = matchingRemote ?? await fetchEtsySections<EtsyShopSectionResponse>(shop.etsyShopId, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ title: trimmedTitle }),
  });
  const id = Number('id' in created ? created.id : created.shop_section_id);
  if (!Number.isSafeInteger(id) || id <= 0 || id > 2_147_483_647) throw new Error('Etsy did not return a valid shop section id.');
  const section = { id, title: created.title?.trim() || trimmedTitle };
  const existingRegistration = await prisma.etsyDownloadSection.findUnique({
    where: { etsyShopId_etsyShopSectionId: { etsyShopId: shop.etsyShopId, etsyShopSectionId: section.id } },
    select: { id: true },
  });
  const stored = await prisma.etsyDownloadSection.upsert({
    where: { etsyShopId_etsyShopSectionId: { etsyShopId: shop.etsyShopId, etsyShopSectionId: section.id } },
    create: { etsyShopId: shop.etsyShopId, etsyShopSectionId: section.id, title: section.title },
    update: { title: section.title },
    select: { id: true },
  });
  if (!existingRegistration) {
    await prisma.$executeRawUnsafe(
      'UPDATE etsy_download_sections SET useForPrintFrames = FALSE, useForCustomisedPrints = FALSE, useForDigitalDownloads = FALSE WHERE id = ?',
      stored.id,
    );
  }
  const usageFlags: Record<EtsySectionUsage, string> = {
    printFrames: 'useForPrintFrames',
    customisedPrints: 'useForCustomisedPrints',
    digitalDownloads: 'useForDigitalDownloads',
  };
  for (const usage of usages) {
    await prisma.$executeRawUnsafe(
      `UPDATE etsy_download_sections SET \`${usageFlags[usage]}\` = TRUE WHERE id = ?`,
      stored.id,
    );
  }
  const registered = (await getRegisteredEtsySections(shop.etsyShopId)).find((candidate) => candidate.id === stored.id);
  if (!registered) throw new Error('The Etsy section was created but could not be registered locally.');
  return registered;
}

async function reconcileRegisteredEtsySection(
  etsyShopId: bigint,
  section: RegisteredEtsySectionOption,
  remoteSection: EtsyDownloadSectionOption,
) {
  const existing = await prisma.etsyDownloadSection.findUnique({
    where: {
      etsyShopId_etsyShopSectionId: {
        etsyShopId,
        etsyShopSectionId: remoteSection.id,
      },
    },
    select: {
      id: true,
      useForPrintFrames: true,
      useForCustomisedPrints: true,
      useForDigitalDownloads: true,
    },
  });
  if (existing && existing.id !== section.id) {
    await prisma.$transaction(async (transaction) => {
      await transaction.ourCategory.updateMany({
        where: { printFrameSectionId: section.id },
        data: { printFrameSectionId: existing.id },
      });
      await transaction.ourCategory.updateMany({
        where: { customisedSectionId: section.id },
        data: { customisedSectionId: existing.id },
      });
      await transaction.ourCategory.updateMany({
        where: { downloadSectionId: section.id },
        data: { downloadSectionId: existing.id },
      });
      await transaction.etsyDownloadSection.update({
        where: { id: existing.id },
        data: {
          title: section.title,
          useForPrintFrames: existing.useForPrintFrames || section.useForPrintFrames,
          useForCustomisedPrints: existing.useForCustomisedPrints || section.useForCustomisedPrints,
          useForDigitalDownloads: existing.useForDigitalDownloads || section.useForDigitalDownloads,
        },
      });
      await transaction.etsyDownloadSection.delete({ where: { id: section.id } });
    });
    return remoteSection.id;
  }

  await prisma.etsyDownloadSection.update({
    where: { id: section.id },
    data: {
      etsyShopSectionId: remoteSection.id,
      title: section.title,
    },
  });
  return remoteSection.id;
}

export async function ensureRegisteredEtsySectionExists(shopId: string, registeredSectionId: number) {
  const shop = await getShopByEtsyShopId(shopId);
  const section = (await getRegisteredEtsySections(shop.etsyShopId))
    .find((candidate) => candidate.id === registeredSectionId);
  if (!section) throw new Error('The Etsy category selected on the template no longer exists in the database.');

  const remoteSections = await getRemoteEtsyShopSections(shop);
  const matchingId = remoteSections.find((candidate) => candidate.id === section.etsyShopSectionId);
  if (matchingId) {
    if (normalizeForCompare(matchingId.title) !== normalizeForCompare(section.title)) {
      await fetchEtsySections<unknown>(shop.etsyShopId, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({ title: section.title }),
      }, matchingId.id);
    }
    return reconcileRegisteredEtsySection(shop.etsyShopId, section, { id: matchingId.id, title: section.title });
  }

  const matchingTitle = remoteSections.find((candidate) => (
    normalizeForCompare(candidate.title) === normalizeForCompare(section.title)
  ));
  if (matchingTitle) {
    return reconcileRegisteredEtsySection(shop.etsyShopId, section, matchingTitle);
  }

  const created = await fetchEtsySections<EtsyShopSectionResponse>(shop.etsyShopId, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ title: section.title }),
  });
  const createdId = Number(created.shop_section_id);
  if (!Number.isSafeInteger(createdId) || createdId <= 0 || createdId > 2_147_483_647) {
    throw new Error(`Etsy did not return a valid shop section id for "${section.title}".`);
  }
  return reconcileRegisteredEtsySection(shop.etsyShopId, section, { id: createdId, title: section.title });
}

type EtsyCategoryListingRow = {
  id: number;
  ourCategoryId: number | null;
  shopSectionId: number | null;
  etsyDownloadShopSectionId: number | null;
  downloadSectionId: number | null;
};

type EtsyCategoryAssignmentRow = {
  id: number;
  printFrameSectionId: number | null;
  customisedSectionId: number | null;
  downloadSectionId: number | null;
};

function validateEtsySectionUsages(usages: EtsySectionUsage[]) {
  const uniqueUsages = [...new Set(usages)];
  if (uniqueUsages.length === 0 || uniqueUsages.some((usage) => !['printFrames', 'customisedPrints', 'digitalDownloads'].includes(usage))) {
    throw new Error('Select at least one Etsy category product type.');
  }
  return uniqueUsages;
}

async function getManagedEtsyShop(shopId?: string) {
  if (shopId) return getShopByEtsyShopId(shopId);
  const configuredShopId = process.env.ETSY_SHOP_ID?.trim();
  const shop = configuredShopId && /^\d+$/.test(configuredShopId)
    ? await prisma.etsyShop.findUnique({
      where: { etsyShopId: BigInt(configuredShopId) },
      select: { id: true, etsyShopId: true, shopName: true, title: true },
    })
    : await prisma.etsyShop.findFirst({
      orderBy: { id: 'asc' },
      select: { id: true, etsyShopId: true, shopName: true, title: true },
    });
  if (!shop) throw new Error('Create or connect an Etsy shop before managing Etsy Categories.');
  return shop;
}

async function getEtsyCategoryListingCounts(shop: LocalShop, sections: RegisteredEtsySectionOption[]) {
  const [listings, assignments] = await Promise.all([
    prisma.$queryRaw<EtsyCategoryListingRow[]>`
      SELECT listing.id, listing.ourCategoryId, listing.shopSectionId,
             listing.etsyDownloadShopSectionId, product.downloadSectionId
      FROM etsy_listings listing
      LEFT JOIN etsy_listing_product_configs product ON product.listingId = listing.id
      WHERE listing.shopId = ${shop.etsyShopId.toString()}
    `,
    prisma.$queryRaw<EtsyCategoryAssignmentRow[]>`
      SELECT id, printFrameSectionId, customisedSectionId, downloadSectionId
      FROM our_categories
      WHERE shopId = ${shop.id}
    `,
  ]);
  const sectionIdsByRemoteId = new Map<number, number[]>();
  for (const section of sections) {
    const matchingIds = sectionIdsByRemoteId.get(section.etsyShopSectionId) ?? [];
    matchingIds.push(section.id);
    sectionIdsByRemoteId.set(section.etsyShopSectionId, matchingIds);
  }
  const sectionIdsByOurCategoryId = new Map<number, number[]>();
  for (const assignment of assignments) {
    sectionIdsByOurCategoryId.set(assignment.id, [
      assignment.printFrameSectionId,
      assignment.customisedSectionId,
      assignment.downloadSectionId,
    ].filter((id): id is number => id !== null));
  }
  const listingIdsBySectionId = new Map(sections.map((section) => [section.id, new Set<number>()]));
  for (const listing of listings) {
    const usedSectionIds = new Set<number>();
    for (const remoteId of [listing.shopSectionId, listing.etsyDownloadShopSectionId, listing.downloadSectionId]) {
      if (remoteId === null) continue;
      for (const sectionId of sectionIdsByRemoteId.get(remoteId) ?? []) usedSectionIds.add(sectionId);
    }
    if (listing.ourCategoryId !== null) {
      for (const sectionId of sectionIdsByOurCategoryId.get(listing.ourCategoryId) ?? []) usedSectionIds.add(sectionId);
    }
    for (const sectionId of usedSectionIds) listingIdsBySectionId.get(sectionId)?.add(listing.id);
  }
  return new Map([...listingIdsBySectionId].map(([sectionId, listingIds]) => [sectionId, listingIds.size]));
}

async function getEtsyCategoriesForShop(shop: LocalShop): Promise<EtsyCategoryListRow[]> {
  const sections = await getRegisteredEtsySections(shop.etsyShopId);
  const listingCounts = await getEtsyCategoryListingCounts(shop, sections);
  return sections.map((section) => ({ ...section, listingCount: listingCounts.get(section.id) ?? 0 }));
}

export async function getEtsyCategoriesPageData(shopId?: string): Promise<EtsyCategoriesPageData> {
  const shop = await getManagedEtsyShop(shopId);
  return {
    shopId: shop.etsyShopId.toString(),
    categories: await getEtsyCategoriesForShop(shop),
  };
}

export async function createManagedEtsyCategory(shopId: string, title: string, usages: EtsySectionUsage[]) {
  const trimmedTitle = title.trim();
  if (!trimmedTitle) throw new Error('Enter an Etsy category name.');
  const shop = await getShopByEtsyShopId(shopId);
  const categories = await getEtsyCategoriesForShop(shop);
  if (categories.some((category) => normalizeForCompare(category.title) === normalizeForCompare(trimmedTitle))) {
    throw new Error(`An Etsy category named "${trimmedTitle}" already exists.`);
  }
  await registerEtsySection(shopId, trimmedTitle, validateEtsySectionUsages(usages));
  return getEtsyCategoriesPageData(shopId);
}

export async function updateManagedEtsyCategory(
  shopId: string,
  categoryId: string,
  title: string,
  usages: EtsySectionUsage[],
) {
  const id = Number(categoryId);
  if (!Number.isSafeInteger(id) || id <= 0) throw new Error('Choose a valid Etsy category.');
  const trimmedTitle = title.trim();
  if (!trimmedTitle) throw new Error('Enter an Etsy category name.');
  if (trimmedTitle.length > 191) throw new Error('The Etsy category name must be 191 characters or fewer.');
  const requestedUsages = validateEtsySectionUsages(usages);
  const shop = await getShopByEtsyShopId(shopId);
  const categories = await getEtsyCategoriesForShop(shop);
  const category = categories.find((item) => item.id === id);
  if (!category) throw new Error('Etsy category not found.');
  if (category.listingCount > 0) throw new Error('This Etsy category cannot be edited while listings use it.');
  const duplicate = categories.find((item) => item.id !== id && normalizeForCompare(item.title) === normalizeForCompare(trimmedTitle));
  if (duplicate) throw new Error(`An Etsy category named "${trimmedTitle}" already exists.`);

  await fetchEtsySections<unknown>(shop.etsyShopId, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ title: trimmedTitle }),
  }, category.etsyShopSectionId);

  const useForPrintFrames = requestedUsages.includes('printFrames');
  const useForCustomisedPrints = requestedUsages.includes('customisedPrints');
  const useForDigitalDownloads = requestedUsages.includes('digitalDownloads');
  await prisma.$transaction(async (transaction) => {
    await transaction.$executeRawUnsafe(
      `UPDATE etsy_download_sections
       SET title = ?, useForPrintFrames = ?, useForCustomisedPrints = ?, useForDigitalDownloads = ?, updatedAt = NOW()
       WHERE id = ? AND etsyShopId = ?`,
      trimmedTitle,
      useForPrintFrames,
      useForCustomisedPrints,
      useForDigitalDownloads,
      id,
      shop.etsyShopId,
    );
    if (!useForPrintFrames) {
      await transaction.$executeRawUnsafe('UPDATE our_categories SET printFrameSectionId = NULL WHERE printFrameSectionId = ?', id);
    }
    if (!useForCustomisedPrints) {
      await transaction.$executeRawUnsafe('UPDATE our_categories SET customisedSectionId = NULL WHERE customisedSectionId = ?', id);
    }
    if (!useForDigitalDownloads) {
      await transaction.$executeRawUnsafe('UPDATE our_categories SET downloadSectionId = NULL WHERE downloadSectionId = ?', id);
    }
  });
  return getEtsyCategoriesPageData(shopId);
}

export async function deleteManagedEtsyCategory(shopId: string, categoryId: string) {
  const id = Number(categoryId);
  if (!Number.isSafeInteger(id) || id <= 0) throw new Error('Choose a valid Etsy category.');
  const shop = await getShopByEtsyShopId(shopId);
  const categories = await getEtsyCategoriesForShop(shop);
  const category = categories.find((item) => item.id === id);
  if (!category) throw new Error('Etsy category not found.');
  if (category.listingCount > 0) throw new Error('This Etsy category cannot be deleted while listings use it.');

  await fetchEtsySections<unknown>(shop.etsyShopId, { method: 'DELETE' }, category.etsyShopSectionId);
  await prisma.etsyDownloadSection.delete({ where: { id } });
  return getEtsyCategoriesPageData(shopId);
}

export async function createEtsyDownloadSection(shopId: string, title: string): Promise<EtsyDownloadSectionOption> {
  const section = await registerEtsySection(shopId, title, 'digitalDownloads');
  return { id: section.etsyShopSectionId, title: section.title };
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
  sectionName: string
) {
  const shop = await getShopByEtsyShopId(shopId);
  const shopName = getShopDisplayName(shop);
  const trimmedSectionName = normalizeSectionName(sectionName);

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
      rawJson: Prisma.JsonNull,
    },
    select: {
      id: true,
    },
  });

  await prisma.etsyShopSubSection.create({
    data: {
      shopSectionId: section.id,
      name: trimmedSectionName,
      numberOfDownloads: 1,
      includeAllDownloads: false,
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
