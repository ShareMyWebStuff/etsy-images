import { Prisma } from '@prisma/client';
import { prisma } from '@/lib/prisma';
import { getEtsyKeystring, getValidEtsyAccessToken, readSavedTokens } from '@/lib/etsy-oauth';
import { shopDirectoryExists } from '@/lib/local-shop-directory';
import { ensureSingleListingsSubSection } from '@/lib/shop-sub-sections';
import { ensureListingProductDefaultsInTransaction } from '@/lib/listing-products';

type EtsyApiOptions = {
  accessToken: string;
};

type EtsyCollectionResponse<T> = {
  count?: number;
  results?: T[];
};

type EtsyShopResponse = {
  shop_id?: number | string | null;
  user_id?: number | string | null;
  shop_name?: string | null;
  title?: string | null;
  announcement?: string | null;
  url?: string | null;
};

type EtsyShopSectionResponse = {
  shop_section_id?: number | string | null;
  title?: string | null;
  rank?: number | null;
  active_listing_count?: number | null;
};

type EtsyListingPrice =
  | string
  | number
  | {
      amount?: number | null;
      divisor?: number | null;
      currency_code?: string | null;
    }
  | null
  | undefined;

type EtsyListingResponse = {
  listing_id?: number | string | null;
  shop_id?: number | string | null;
  user_id?: number | string | null;
  title?: string | null;
  description?: string | null;
  state?: string | null;
  url?: string | null;
  quantity?: number | null;
  price?: EtsyListingPrice;
  taxonomy_id?: number | null;
  listing_type?: 'physical' | 'download' | 'both' | string | null;
  shop_section_id?: number | string | null;
  who_made?: string | null;
  is_supply?: boolean | null;
  when_made?: string | null;
  should_auto_renew?: boolean | null;
  is_personalizable?: boolean | null;
  personalization_is_required?: boolean | null;
  language?: string | null;
  created_timestamp?: number | null;
  updated_timestamp?: number | null;
  original_creation_timestamp?: number | null;
  ending_timestamp?: number | null;
  tags?: string[] | null;
  materials?: string[] | null;
  shop?: {
    shop_name?: string | null;
  } | null;
};

type EtsyListingImageResponse = {
  listing_image_id?: number | string | null;
  rank?: number | null;
  url_75x75?: string | null;
  url_170x135?: string | null;
  url_570xN?: string | null;
  url_fullxfull?: string | null;
  full_height?: number | null;
  full_width?: number | null;
};

type EtsyListingFileResponse = {
  listing_file_id?: number | string | null;
  rank?: number | null;
  filename?: string | null;
  filesize?: string | null;
  size_bytes?: number | null;
  filetype?: string | null;
  create_timestamp?: number | null;
  created_timestamp?: number | null;
};

export type ShopSectionSummaryRow = {
  id: string;
  shopName: string;
  section: string;
  noOfListings: number;
};

export type ShopSummaryRow = {
  id: string;
  shopName: string;
  noOfSections: number;
  hasLocalDirectory: boolean;
};

export type ShopSectionsPageData = {
  shop: {
    id: string;
    shopName: string;
  };
  sections: Array<{
    id: string;
    subSectionId: string | null;
    sectionName: string;
    roomTheme: string;
    noOfActive: number;
    noOfDraft: number;
    noOfListings: number;
    numberOfDownloads: number | null;
    includeAllDownloads: boolean;
    hasEtsyShopSection: boolean;
  }>;
};

const LISTING_STATES = ['active', 'draft', 'inactive', 'expired', 'sold_out'] as const;

function getEtsyApiKeyHeader() {
  const sharedSecret = process.env.ETSY_SHARED_SECRET;

  if (!sharedSecret) {
    throw new Error('Missing ETSY_SHARED_SECRET environment variable.');
  }

  return `${getEtsyKeystring()}:${sharedSecret}`;
}

function toNullableString(value: number | string | null | undefined) {
  if (value === null || value === undefined) {
    return null;
  }

  return String(value);
}

function toNullableNumber(value: number | string | null | undefined) {
  if (value === null || value === undefined || value === '') {
    return null;
  }

  const numericValue = Number(value);
  return Number.isFinite(numericValue) ? numericValue : null;
}

function toRequiredBigInt(value: number | string | bigint | null | undefined, fieldName: string) {
  if (value === null || value === undefined || value === '') {
    throw new Error(`Missing Etsy ${fieldName}.`);
  }

  try {
    return BigInt(value);
  } catch {
    throw new Error(`Invalid Etsy ${fieldName}: ${value}.`);
  }
}

function parsePrice(price: EtsyListingPrice) {
  if (price === null || price === undefined) {
    return null;
  }

  if (typeof price === 'object') {
    const amount = price.amount;
    const divisor = price.divisor;

    if (typeof amount !== 'number' || typeof divisor !== 'number' || divisor === 0) {
      return null;
    }

    return amount / divisor;
  }

  const numericPrice = Number(price);
  return Number.isFinite(numericPrice) ? numericPrice : null;
}

function parsePriceParts(price: EtsyListingPrice) {
  if (price === null || price === undefined) {
    return {
      amount: null,
      divisor: null,
      currencyCode: null,
    };
  }

  if (typeof price === 'object') {
    return {
      amount: typeof price.amount === 'number' ? price.amount : null,
      divisor: typeof price.divisor === 'number' ? price.divisor : null,
      currencyCode: typeof price.currency_code === 'string' ? price.currency_code : null,
    };
  }

  const numericPrice = Number(price);

  return {
    amount: Number.isFinite(numericPrice) ? Math.round(numericPrice * 100) : null,
    divisor: Number.isFinite(numericPrice) ? 100 : null,
    currencyCode: null,
  };
}

function toRawJson(value: unknown) {
  return JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue;
}

function extractResults<T>(payload: EtsyCollectionResponse<T> | T[] | T) {
  if (Array.isArray(payload)) {
    return payload;
  }

  if (payload && typeof payload === 'object' && 'results' in payload && Array.isArray(payload.results)) {
    return payload.results;
  }

  return [payload as T];
}

async function fetchEtsyJson<T>(path: string, options: EtsyApiOptions) {
  const response = await fetch(`https://openapi.etsy.com/v3/application${path}`, {
    signal: AbortSignal.timeout(30_000),
    headers: {
      Accept: 'application/json',
      Authorization: `Bearer ${options.accessToken}`,
      'x-api-key': getEtsyApiKeyHeader(),
    },
  });
  const responseText = await response.text();

  if (!response.ok) {
    throw new Error(`Etsy API returned ${response.status} ${response.statusText}${responseText ? `: ${responseText}` : ''}`);
  }

  return JSON.parse(responseText) as T;
}

async function tryFetchEtsyJson<T>(path: string, options: EtsyApiOptions) {
  const response = await fetch(`https://openapi.etsy.com/v3/application${path}`, {
    signal: AbortSignal.timeout(30_000),
    headers: {
      Accept: 'application/json',
      Authorization: `Bearer ${options.accessToken}`,
      'x-api-key': getEtsyApiKeyHeader(),
    },
  });

  if (!response.ok) {
    return null;
  }

  return (await response.json()) as T;
}

async function fetchOptionalEtsyJson<T>(path: string, options: EtsyApiOptions) {
  const response = await fetch(`https://openapi.etsy.com/v3/application${path}`, {
    signal: AbortSignal.timeout(30_000),
    headers: {
      Accept: 'application/json',
      Authorization: `Bearer ${options.accessToken}`,
      'x-api-key': getEtsyApiKeyHeader(),
    },
  });
  const responseText = await response.text();

  if (response.status === 404) {
    return null;
  }

  if (!response.ok) {
    throw new Error(`Etsy API returned ${response.status} ${response.statusText}${responseText ? `: ${responseText}` : ''}`);
  }

  return JSON.parse(responseText) as T;
}

async function getAuthenticatedUserId(accessToken: string) {
  const me = await tryFetchEtsyJson<{ user_id?: number | string }>('/users/me', { accessToken });
  const userId = toNullableString(me?.user_id);

  if (userId) {
    return userId;
  }

  const savedTokens = await readSavedTokens();
  const tokenUserId = savedTokens?.access_token.match(/^(\d+)\./)?.[1] ?? accessToken.match(/^(\d+)\./)?.[1];

  if (!tokenUserId) {
    throw new Error('Unable to determine Etsy user id from OAuth token.');
  }

  return tokenUserId;
}

async function syncEtsyListingDownload(
  shopId: string,
  userId: string,
  listing: EtsyListingResponse,
  images: EtsyListingImageResponse[],
  files: EtsyListingFileResponse[]
) {
  if (!listing.listing_id) {
    return null;
  }

  const etsyId = String(listing.listing_id);
  const price = parsePriceParts(listing.price);
  const rawJson = toRawJson(listing);
  const importedProductType = listing.listing_type === 'download' ? 'digital' : 'physical';
  const importedTaxonomyId = importedProductType === 'digital' ? 2078 : listing.taxonomy_id ?? 121;

  const savedListing = await prisma.$transaction(async (tx) => {
    await tx.listing.upsert({
      where: { etsyId },
      update: {
        title: listing.title ?? `Listing ${etsyId}`,
        price: parsePrice(listing.price),
        shopName: listing.shop?.shop_name ?? null,
      },
      create: {
        etsyId,
        title: listing.title ?? `Listing ${etsyId}`,
        price: parsePrice(listing.price),
        shopName: listing.shop?.shop_name ?? null,
      },
    });

    const existingListing = await tx.etsyListing.findUnique({
      where: { etsyId },
      select: {
        productConfig: { select: { id: true } },
        detailsChanged: true,
        tagsChanged: true,
        imagesChanged: true,
        downloadsChanged: true,
        productsChanged: true,
      },
    });
    const shouldInitializeProducts = !existingListing?.productConfig;
    const preserveLocalDetails = existingListing?.detailsChanged === true;
    const preserveLocalProducts = existingListing?.productsChanged === true;
    const savedListing = await tx.etsyListing.upsert({
      where: {
        etsyId,
      },
      update: {
        shopId: toNullableString(listing.shop_id) ?? shopId,
        userId: toNullableString(listing.user_id) ?? userId,
        ...(preserveLocalDetails ? {} : {
          title: listing.title ?? `Listing ${etsyId}`,
          description: listing.description ?? null,
          quantity: listing.quantity ?? null,
          whoMade: listing.who_made ?? null,
          isSupply: listing.is_supply ?? null,
          whenMade: listing.when_made ?? null,
          shouldAutoRenew: listing.should_auto_renew ?? null,
          language: listing.language ?? null,
        }),
        state: listing.state ?? null,
        url: listing.url ?? null,
        ...(preserveLocalProducts ? {} : {
          priceAmount: price.amount,
          priceDivisor: price.divisor,
          priceCurrencyCode: price.currencyCode,
        }),
        ...(shouldInitializeProducts
          ? {
              taxonomyId: importedTaxonomyId,
              etsyProductType: importedProductType,
            }
          : {}),
        shopSectionId: toNullableNumber(listing.shop_section_id),
        isPersonalizable: listing.is_personalizable ?? null,
        personalizationIsRequired: listing.personalization_is_required ?? null,
        createdTimestamp: listing.created_timestamp ?? null,
        updatedTimestamp: listing.updated_timestamp ?? null,
        originalCreationTimestamp: listing.original_creation_timestamp ?? null,
        endingTimestamp: listing.ending_timestamp ?? null,
        rawJson,
        downloadedAt: new Date(),
      },
      create: {
        etsyId,
        shopId: toNullableString(listing.shop_id) ?? shopId,
        userId: toNullableString(listing.user_id) ?? userId,
        title: listing.title ?? `Listing ${etsyId}`,
        description: listing.description ?? null,
        state: listing.state ?? null,
        url: listing.url ?? null,
        quantity: listing.quantity ?? null,
        priceAmount: price.amount,
        priceDivisor: price.divisor,
        priceCurrencyCode: price.currencyCode,
        taxonomyId: importedTaxonomyId,
        etsyProductType: importedProductType,
        shopSectionId: toNullableNumber(listing.shop_section_id),
        whoMade: listing.who_made ?? null,
        isSupply: listing.is_supply ?? null,
        whenMade: listing.when_made ?? null,
        shouldAutoRenew: listing.should_auto_renew ?? null,
        isPersonalizable: listing.is_personalizable ?? null,
        personalizationIsRequired: listing.personalization_is_required ?? null,
        language: listing.language ?? null,
        createdTimestamp: listing.created_timestamp ?? null,
        updatedTimestamp: listing.updated_timestamp ?? null,
        originalCreationTimestamp: listing.original_creation_timestamp ?? null,
        endingTimestamp: listing.ending_timestamp ?? null,
        rawJson,
      },
      select: {
        id: true,
        etsyId: true,
      },
    });

    if (existingListing?.tagsChanged !== true) {
      await tx.etsyListingTag.deleteMany({ where: { listingId: savedListing.id } });
      if (listing.tags && listing.tags.length > 0) {
        await tx.etsyListingTag.createMany({
          data: listing.tags.map((tag, index) => ({ listingId: savedListing.id, tag, position: index })),
        });
      }
    }

    await tx.etsyListingMaterial.deleteMany({ where: { listingId: savedListing.id } });
    if (listing.materials && listing.materials.length > 0) {
      await tx.etsyListingMaterial.createMany({
        data: listing.materials.map((material, index) => ({ listingId: savedListing.id, material, position: index })),
      });
    }

    if (existingListing?.imagesChanged !== true) {
      const localImages = await tx.etsyListingImage.findMany({ where: { listingId: savedListing.id } });
      const byRemoteId = new Map(localImages.flatMap((image) => image.etsyImageId ? [[image.etsyImageId, image] as const] : []));
      const returnedIds = new Set<string>();
      let imagesNeedResync = false;
      for (const image of images) {
        const remoteId = toNullableString(image.listing_image_id);
        if (!remoteId) continue;
        returnedIds.add(remoteId);
        const data = {
          rank: image.rank ?? null,
          url75x75: image.url_75x75 ?? null,
          url170x135: image.url_170x135 ?? null,
          url570xN: image.url_570xN ?? null,
          urlFullxFull: image.url_fullxfull ?? null,
          fullHeight: image.full_height ?? null,
          fullWidth: image.full_width ?? null,
        };
        const localImage = byRemoteId.get(remoteId);
        if (localImage) {
          await tx.etsyListingImage.update({ where: { id: localImage.id }, data });
        } else {
          await tx.etsyListingImage.create({ data: { listingId: savedListing.id, etsyImageId: remoteId, ...data } });
        }
      }
      for (const localImage of localImages) {
        if (!localImage.etsyImageId || returnedIds.has(localImage.etsyImageId)) continue;
        if (localImage.localFileName) {
          imagesNeedResync = true;
          await tx.etsyListingImage.update({
            where: { id: localImage.id },
            data: { etsyImageId: null, url75x75: null, url170x135: null, url570xN: null, urlFullxFull: null },
          });
        } else {
          await tx.etsyListingImage.delete({ where: { id: localImage.id } });
        }
      }
      if (imagesNeedResync) {
        await tx.etsyListing.update({
          where: { id: savedListing.id },
          data: { imagesChanged: true, lastLocalChangeAt: new Date() },
        });
      }
    }

    if (existingListing?.downloadsChanged !== true) {
      const [localFiles, localZips] = await Promise.all([
        tx.etsyListingFile.findMany({ where: { listingId: savedListing.id } }),
        tx.etsyListingZip.findMany({ where: { listingId: savedListing.id } }),
      ]);
      const byRemoteId = new Map(localFiles.flatMap((file) => file.etsyListingFileId ? [[file.etsyListingFileId, file] as const] : []));
      const zipRemoteIds = new Set(localZips.flatMap((zip) => zip.etsyListingFileId ? [zip.etsyListingFileId] : []));
      const returnedIds = new Set<string>();
      let downloadsNeedResync = false;
      for (const file of files) {
        const remoteId = toNullableString(file.listing_file_id);
        if (!remoteId) continue;
        returnedIds.add(remoteId);
        if (zipRemoteIds.has(remoteId)) continue;
        const data = {
          rank: file.rank ?? null,
          filename: file.filename ?? null,
          filesize: file.filesize ?? null,
          sizeBytes: file.size_bytes ?? null,
          filetype: file.filetype ?? null,
          createTimestamp: file.create_timestamp ?? null,
          createdTimestamp: file.created_timestamp ?? null,
          rawJson: toRawJson(file),
        };
        const localFile = byRemoteId.get(remoteId);
        if (localFile) {
          await tx.etsyListingFile.update({ where: { id: localFile.id }, data });
        } else {
          await tx.etsyListingFile.create({
            data: { listingId: savedListing.id, etsyListingFileId: remoteId, ...data },
          });
        }
      }
      for (const localFile of localFiles) {
        if (!localFile.etsyListingFileId || returnedIds.has(localFile.etsyListingFileId)) continue;
        if (localFile.localFileName) {
          downloadsNeedResync = true;
          await tx.etsyListingFile.update({ where: { id: localFile.id }, data: { etsyListingFileId: null } });
        } else {
          await tx.etsyListingFile.delete({ where: { id: localFile.id } });
        }
      }
      for (const localZip of localZips) {
        if (localZip.etsyListingFileId && !returnedIds.has(localZip.etsyListingFileId)) {
          downloadsNeedResync = true;
          await tx.etsyListingZip.update({ where: { id: localZip.id }, data: { etsyListingFileId: null } });
        }
      }
      if (downloadsNeedResync) {
        await tx.etsyListing.update({
          where: { id: savedListing.id },
          data: { downloadsChanged: true, lastLocalChangeAt: new Date() },
        });
      }
    }

    await ensureListingProductDefaultsInTransaction(tx, savedListing.id, {
      digitalDownload: listing.listing_type === 'download' || listing.listing_type === 'both',
    });
    return savedListing;
  });
  return savedListing;
}

export async function syncEtsyShops() {
  const accessToken = await getValidEtsyAccessToken();
  const userId = await getAuthenticatedUserId(accessToken);
  const authenticatedUserId = toRequiredBigInt(userId, 'user_id');
  const etsyResponse = await fetchEtsyJson<EtsyCollectionResponse<EtsyShopResponse> | EtsyShopResponse[] | EtsyShopResponse>(
    `/users/${encodeURIComponent(userId)}/shops`,
    { accessToken }
  );
  const shops = extractResults<EtsyShopResponse>(etsyResponse).filter((shop) => shop.shop_id);
  const savedShops = [];

  for (const shop of shops) {
    const etsyShopId = toRequiredBigInt(shop.shop_id, 'shop_id');
    const shopUserId = shop.user_id === null || shop.user_id === undefined ? authenticatedUserId : toRequiredBigInt(shop.user_id, 'user_id');

    const savedShop = await prisma.etsyShop.upsert({
        where: {
          etsyShopId,
        },
        update: {
          userId: shopUserId,
          shopName: shop.shop_name ?? null,
          title: shop.title ?? null,
          announcement: shop.announcement ?? null,
          url: shop.url ?? null,
          downloadedAt: new Date(),
        },
        create: {
          etsyShopId,
          userId: shopUserId,
          shopName: shop.shop_name ?? null,
          title: shop.title ?? null,
          announcement: shop.announcement ?? null,
          url: shop.url ?? null,
        },
        select: {
          id: true,
          etsyShopId: true,
          userId: true,
          shopName: true,
          title: true,
        },
      });

    savedShops.push({
      ...savedShop,
      etsyShopId: savedShop.etsyShopId.toString(),
      userId: savedShop.userId.toString(),
    });
  }

  return {
    userId,
    shops: savedShops,
    etsyResponse,
  };
}

export async function syncEtsyShopSections() {
  const accessToken = await getValidEtsyAccessToken();
  const { shops, etsyResponse: shopsResponse } = await syncEtsyShops();
  const sectionResponses = [];
  const savedSections = [];

  for (const shop of shops) {
    const etsyResponse = await fetchEtsyJson<
      EtsyCollectionResponse<EtsyShopSectionResponse> | EtsyShopSectionResponse[] | EtsyShopSectionResponse
    >(`/shops/${encodeURIComponent(shop.etsyShopId)}/sections`, { accessToken });
    const sections = extractResults<EtsyShopSectionResponse>(etsyResponse).filter((section) => section.shop_section_id);
    sectionResponses.push({
      etsyShopId: shop.etsyShopId,
      etsyResponse,
    });

    for (const section of sections) {
      const etsyShopSectionId = String(section.shop_section_id);
      const etsyShopId = toRequiredBigInt(shop.etsyShopId, 'shop_id');
      const existingSection = await prisma.etsyShopSection.findFirst({
        where: {
          OR: [
            {
              shopId: shop.id,
              etsyShopSectionId,
            },
            {
              etsyShopId,
              etsyShopSectionId,
            },
          ],
        },
        select: {
          id: true,
        },
      });

      const sectionData = {
        shopId: shop.id,
        etsyShopId,
        etsyShopSectionId,
        title: section.title ?? `Section ${etsyShopSectionId}`,
        rank: section.rank ?? null,
        activeListingCount: section.active_listing_count ?? null,
        rawJson: toRawJson(section),
      };
      const savedSection = existingSection
        ? await prisma.etsyShopSection.update({
            where: {
              id: existingSection.id,
            },
            data: {
              ...sectionData,
              downloadedAt: new Date(),
            },
            select: {
              id: true,
              etsyShopId: true,
              etsyShopSectionId: true,
              title: true,
              rank: true,
              activeListingCount: true,
            },
          })
        : await prisma.etsyShopSection.create({
            data: sectionData,
            select: {
              id: true,
              etsyShopId: true,
              etsyShopSectionId: true,
              title: true,
              rank: true,
              activeListingCount: true,
            },
          });

      await ensureSingleListingsSubSection(savedSection.id);

      savedSections.push({
        ...savedSection,
        etsyShopId: savedSection.etsyShopId?.toString() ?? null,
      });
    }
  }

  return {
    shops,
    sections: savedSections,
    etsyResponse: {
      shops: shopsResponse,
      sections: sectionResponses,
    },
  };
}

async function syncListingsForShop(shopId: string, userId: string, accessToken: string) {
  const pageLimit = 100;
  const savedListings = [];
  let downloadedListings = 0;
  let downloadedImages = 0;
  let downloadedFiles = 0;

  for (const state of LISTING_STATES) {
    let offset = 0;
    let totalCount: number | null = null;

    while (true) {
      const payload = await fetchEtsyJson<EtsyCollectionResponse<EtsyListingResponse>>(
        `/shops/${encodeURIComponent(shopId)}/listings?state=${state}&limit=${pageLimit}&offset=${offset}`,
        { accessToken }
      );
      const listings = payload.results ?? [];

      totalCount = typeof payload.count === 'number' ? payload.count : totalCount;
      downloadedListings += listings.length;

      for (const listing of listings) {
        if (!listing.listing_id) {
          continue;
        }

        const listingId = String(listing.listing_id);
        const [imagesPayload, filesPayload] = await Promise.all([
          fetchEtsyJson<EtsyCollectionResponse<EtsyListingImageResponse>>(
            `/listings/${encodeURIComponent(listingId)}/images`,
            { accessToken }
          ),
          fetchOptionalEtsyJson<EtsyCollectionResponse<EtsyListingFileResponse>>(
            `/shops/${encodeURIComponent(shopId)}/listings/${encodeURIComponent(listingId)}/files`,
            { accessToken }
          ),
        ]);
        const images = imagesPayload.results ?? [];
        const files = filesPayload?.results ?? [];
        const savedListing = await syncEtsyListingDownload(shopId, userId, listing, images, files);

        downloadedImages += images.length;
        downloadedFiles += files.length;

        if (savedListing) {
          savedListings.push(savedListing);
        }
      }

      offset += listings.length;

      if (listings.length === 0 || listings.length < pageLimit || (totalCount !== null && offset >= totalCount)) {
        break;
      }
    }
  }

  return {
    shopId,
    listings: savedListings,
    counts: {
      listings: downloadedListings,
      images: downloadedImages,
      files: downloadedFiles,
    },
  };
}

export async function syncEtsyUserData() {
  const accessToken = await getValidEtsyAccessToken();
  const { shops, sections } = await syncEtsyShopSections();
  const shopResults = [];
  let listingsCount = 0;
  let imagesCount = 0;
  let filesCount = 0;

  for (const shop of shops) {
    const userId = shop.userId ?? (await getAuthenticatedUserId(accessToken));
    const shopResult = await syncListingsForShop(shop.etsyShopId, userId, accessToken);

    listingsCount += shopResult.counts.listings;
    imagesCount += shopResult.counts.images;
    filesCount += shopResult.counts.files;
    shopResults.push(shopResult);
  }

  return {
    shops,
    sections,
    shopResults,
    counts: {
      shops: shops.length,
      sections: sections.length,
      listings: listingsCount,
      images: imagesCount,
      files: filesCount,
    },
  };
}

export async function getShopSectionSummary(): Promise<ShopSectionSummaryRow[]> {
  const shops = await prisma.etsyShop.findMany({
    orderBy: [{ shopName: 'asc' }, { etsyShopId: 'asc' }],
    include: {
      sections: {
        orderBy: [{ rank: 'asc' }, { title: 'asc' }],
      },
    },
  });
  const listingCounts = await prisma.etsyListing.groupBy({
    by: ['shopId', 'shopSectionId'],
    _count: {
      _all: true,
    },
  });
  const countMap = new Map<string, number>();

  for (const count of listingCounts) {
    countMap.set(`${count.shopId}:${count.shopSectionId ?? 'none'}`, count._count._all);
  }

  return shops.flatMap((shop) => {
    const rows: ShopSectionSummaryRow[] = [];
    const shopName = shop.shopName ?? shop.title ?? `Shop ${shop.etsyShopId}`;
    const unsectionedCount = countMap.get(`${shop.etsyShopId}:none`) ?? 0;

    for (const section of shop.sections) {
      const sectionId = toNullableNumber(section.etsyShopSectionId);
      const mapKey = `${shop.etsyShopId}:${sectionId ?? 'none'}`;
      const hasLocalCount = countMap.has(mapKey);

      rows.push({
        id: `${shop.etsyShopId}-${section.etsyShopSectionId}`,
        shopName,
        section: section.title,
        noOfListings: hasLocalCount ? countMap.get(mapKey) ?? 0 : section.activeListingCount ?? 0,
      });
    }

    if (unsectionedCount > 0 || shop.sections.length === 0) {
      rows.push({
        id: `${shop.etsyShopId}-unsectioned`,
        shopName,
        section: 'Unsectioned',
        noOfListings: unsectionedCount,
      });
    }

    return rows;
  });
}

export async function getShopSummary(): Promise<ShopSummaryRow[]> {
  const shops = await prisma.etsyShop.findMany({
    orderBy: [{ shopName: 'asc' }, { etsyShopId: 'asc' }],
    select: {
      id: true,
      etsyShopId: true,
      shopName: true,
      title: true,
    },
  });
  const sections = await prisma.etsyShopSection.findMany({
    select: {
      shopId: true,
      etsyShopId: true,
    },
  });

  return Promise.all(
    shops.map(async (shop) => {
      const shopName = shop.shopName ?? shop.title ?? `Shop ${shop.etsyShopId}`;

      return {
        id: shop.etsyShopId.toString(),
        shopName,
        noOfSections: sections.filter((section) => {
          return section.shopId === shop.id || section.etsyShopId?.toString() === shop.etsyShopId.toString();
        }).length,
        hasLocalDirectory: await shopDirectoryExists(shopName),
      };
    })
  );
}

export async function getShopSectionsPageData(shopId: string): Promise<ShopSectionsPageData | null> {
  let etsyShopId: bigint;

  try {
    etsyShopId = BigInt(shopId);
  } catch {
    return null;
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
    return null;
  }

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
    orderBy: [{ includeAllDownloads: 'asc' }, { numberOfDownloads: 'asc' }, { title: 'asc' }],
    select: {
      id: true,
      etsyShopSectionId: true,
      title: true,
      roomTheme: true,
      activeListingCount: true,
      numberOfDownloads: true,
      includeAllDownloads: true,
      subSections: {
        select: { id: true, _count: { select: { listings: true } } },
      },
    },
  });
  const allListingCounts = await prisma.etsyListing.groupBy({
    by: ['shopSectionId'],
    where: {
      shopId: shop.etsyShopId.toString(),
    },
    _count: {
      _all: true,
    },
  });
  const listingCounts = await prisma.etsyListing.groupBy({
    by: ['shopSectionId', 'state'],
    where: {
      shopId: shop.etsyShopId.toString(),
      state: {
        in: ['active', 'draft'],
      },
    },
    _count: {
      _all: true,
    },
  });
  const allCountMap = new Map<string, number>();
  const countMap = new Map<string, number>();

  for (const count of allListingCounts) {
    allCountMap.set(`${count.shopSectionId ?? 'none'}`, count._count._all);
  }

  for (const count of listingCounts) {
    countMap.set(`${count.shopSectionId ?? 'none'}:${count.state ?? 'none'}`, count._count._all);
  }

  return {
    shop: {
      id: shop.etsyShopId.toString(),
      shopName: shop.shopName ?? shop.title ?? `Shop ${shop.etsyShopId}`,
    },
    sections: sections.map((section) => {
      const etsyShopSectionId = toNullableNumber(section.etsyShopSectionId);
      const activeCount = etsyShopSectionId === null ? 0 : countMap.get(`${etsyShopSectionId}:active`) ?? 0;
      const draftCount = etsyShopSectionId === null ? 0 : countMap.get(`${etsyShopSectionId}:draft`) ?? 0;
      const localListingsCount = section.subSections.reduce((total, subSection) => total + subSection._count.listings, 0);
      const listingsCount = etsyShopSectionId === null ? localListingsCount : allCountMap.get(`${etsyShopSectionId}`) ?? localListingsCount;
      const activeListingCount = activeCount || section.activeListingCount || 0;

      return {
        id: String(section.id),
        subSectionId: section.subSections[0] ? String(section.subSections[0].id) : null,
        sectionName: section.title,
        roomTheme: section.roomTheme ?? '',
        noOfActive: activeListingCount,
        noOfDraft: draftCount,
        noOfListings: Math.max(listingsCount, activeListingCount + draftCount),
        numberOfDownloads: section.includeAllDownloads ? null : section.numberOfDownloads,
        includeAllDownloads: section.includeAllDownloads,
        hasEtsyShopSection: section.etsyShopSectionId !== null,
      };
    }),
  };
}
