import { NextResponse } from 'next/server';
import { Prisma } from '@prisma/client';
import { prisma } from '@/lib/prisma';
import { getValidEtsyAccessToken } from '@/lib/etsy-oauth';

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

type EtsyListing = {
  listing_id?: number | string;
  shop_id?: number | string | null;
  user_id?: number | string | null;
  title?: string;
  description?: string | null;
  state?: string | null;
  url?: string | null;
  quantity?: number | null;
  price?: EtsyListingPrice;
  taxonomy_id?: number | null;
  shop_section_id?: number | null;
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
  images?: EtsyListingImage[] | null;
  shop?: {
    shop_name?: string | null;
  } | null;
};

type EtsyListingImage = {
  listing_image_id?: number | string | null;
  rank?: number | null;
  url_75x75?: string | null;
  url_170x135?: string | null;
  url_570xN?: string | null;
  url_fullxfull?: string | null;
  full_height?: number | null;
  full_width?: number | null;
};

type EtsyListingResponse = {
  count?: number;
  results?: EtsyListing[];
};

type ListingState = 'active' | 'draft';

async function getRequiredEtsyConfig(state: ListingState) {
  const shopId = process.env.ETSY_SHOP_ID;
  const keystring = process.env.ETSY_KEYSTRING ?? process.env.ETSY_API_KEY;
  const sharedSecret = process.env.ETSY_SHARED_SECRET;

  const missing = [
    !shopId ? 'ETSY_SHOP_ID' : null,
    !keystring ? 'ETSY_KEYSTRING' : null,
    !sharedSecret ? 'ETSY_SHARED_SECRET' : null,
  ].filter(Boolean);

  if (missing.length > 0) {
    throw new Error(`Missing ${missing.join(', ')} environment variable${missing.length === 1 ? '' : 's'}.`);
  }

  if (!shopId || !keystring || !sharedSecret) {
    throw new Error('Missing Etsy environment variables.');
  }

  if (!/^\d+$/.test(shopId)) {
    throw new Error('ETSY_SHOP_ID must be the numeric Etsy shop id, not the app keystring or shared secret.');
  }

  return {
    shopId,
    apiKey: `${keystring}:${sharedSecret}`,
    accessToken: state === 'draft' ? await getValidEtsyAccessToken() : null,
  };
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
      currencyCode: 'currency_code' in price && typeof price.currency_code === 'string' ? price.currency_code : null,
    };
  }

  const numericPrice = Number(price);

  return {
    amount: Number.isFinite(numericPrice) ? Math.round(numericPrice * 100) : null,
    divisor: Number.isFinite(numericPrice) ? 100 : null,
    currencyCode: null,
  };
}

function toNullableString(value: number | string | null | undefined) {
  if (value === null || value === undefined) {
    return null;
  }

  return String(value);
}

function toRawJson(value: unknown) {
  return JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue;
}

async function syncEtsyListingDownload(shopId: string, listing: EtsyListing) {
  if (!listing.listing_id) {
    return;
  }

  const price = parsePriceParts(listing.price);
  const etsyId = String(listing.listing_id);
  const rawJson = toRawJson(listing);

  await prisma.$transaction(async (tx) => {
    const savedListing = await tx.etsyListing.upsert({
      where: {
        etsyId,
      },
      update: {
        shopId: toNullableString(listing.shop_id) ?? shopId,
        userId: toNullableString(listing.user_id),
        title: listing.title ?? `Listing ${etsyId}`,
        description: listing.description ?? null,
        state: listing.state ?? null,
        url: listing.url ?? null,
        quantity: listing.quantity ?? null,
        priceAmount: price.amount,
        priceDivisor: price.divisor,
        priceCurrencyCode: price.currencyCode,
        taxonomyId: listing.taxonomy_id ?? null,
        shopSectionId: listing.shop_section_id ?? null,
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
        downloadedAt: new Date(),
      },
      create: {
        etsyId,
        shopId: toNullableString(listing.shop_id) ?? shopId,
        userId: toNullableString(listing.user_id),
        title: listing.title ?? `Listing ${etsyId}`,
        description: listing.description ?? null,
        state: listing.state ?? null,
        url: listing.url ?? null,
        quantity: listing.quantity ?? null,
        priceAmount: price.amount,
        priceDivisor: price.divisor,
        priceCurrencyCode: price.currencyCode,
        taxonomyId: listing.taxonomy_id ?? null,
        shopSectionId: listing.shop_section_id ?? null,
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
    });

    await tx.etsyListingTag.deleteMany({
      where: {
        listingId: savedListing.id,
      },
    });
    await tx.etsyListingMaterial.deleteMany({
      where: {
        listingId: savedListing.id,
      },
    });
    await tx.etsyListingImage.deleteMany({
      where: {
        listingId: savedListing.id,
      },
    });

    const tags = listing.tags ?? [];
    const materials = listing.materials ?? [];
    const images = listing.images ?? [];

    if (tags.length > 0) {
      await tx.etsyListingTag.createMany({
        data: tags.map((tag, index) => ({
          listingId: savedListing.id,
          tag,
          position: index,
        })),
      });
    }

    if (materials.length > 0) {
      await tx.etsyListingMaterial.createMany({
        data: materials.map((material, index) => ({
          listingId: savedListing.id,
          material,
          position: index,
        })),
      });
    }

    if (images.length > 0) {
      await tx.etsyListingImage.createMany({
        data: images.map((image) => ({
          listingId: savedListing.id,
          etsyImageId: toNullableString(image.listing_image_id),
          rank: image.rank ?? null,
          url75x75: image.url_75x75 ?? null,
          url170x135: image.url_170x135 ?? null,
          url570xN: image.url_570xN ?? null,
          urlFullxFull: image.url_fullxfull ?? null,
          fullHeight: image.full_height ?? null,
          fullWidth: image.full_width ?? null,
        })),
      });
    }
  });
}

async function syncListingsFromEtsy(state: ListingState) {
  const { shopId, apiKey, accessToken } = await getRequiredEtsyConfig(state);
  const pageLimit = 100;
  const allListings: EtsyListing[] = [];
  const pages: EtsyListingResponse[] = [];
  let totalCount: number | null = null;
  let offset = 0;

  while (true) {
    const etsyUrl =
      state === 'draft'
        ? `https://openapi.etsy.com/v3/application/shops/${encodeURIComponent(
            shopId
          )}/listings?state=draft&limit=${pageLimit}&offset=${offset}`
        : `https://openapi.etsy.com/v3/application/shops/${encodeURIComponent(
            shopId
          )}/listings/active?limit=${pageLimit}&offset=${offset}`;

    const response = await fetch(etsyUrl, {
      signal: AbortSignal.timeout(30_000),
      headers: {
        Accept: 'application/json',
        'x-api-key': apiKey,
        ...(state === 'draft' ? { Authorization: `Bearer ${accessToken}` } : {}),
      },
    });

    if (!response.ok) {
      const responseText = await response.text();
      throw new Error(
        `Etsy API returned ${response.status} ${response.statusText}${responseText ? `: ${responseText}` : ''}`
      );
    }

    const payload = (await response.json()) as EtsyListingResponse;
    const listings = payload.results ?? [];
    pages.push(payload);
    allListings.push(...listings);
    totalCount = typeof payload.count === 'number' ? payload.count : totalCount;

    offset += listings.length;

    if (listings.length === 0 || listings.length < pageLimit || (totalCount !== null && offset >= totalCount)) {
      break;
    }
  }

  const syncedEtsyIds: string[] = [];

  for (const listing of allListings) {
    if (!listing.listing_id) {
      continue;
    }

    const etsyId = String(listing.listing_id);
    const priceValue = parsePrice(listing.price);
    syncedEtsyIds.push(etsyId);

    await prisma.listing.upsert({
      where: {
        etsyId,
      },
      update: {
        title: listing.title ?? `Listing ${listing.listing_id}`,
        price: priceValue,
        shopName: listing.shop?.shop_name ?? null,
      },
      create: {
        etsyId: String(listing.listing_id),
        title: listing.title ?? `Listing ${listing.listing_id}`,
        price: priceValue,
        shopName: listing.shop?.shop_name ?? null,
      },
    });

    await syncEtsyListingDownload(shopId, listing);
  }

  return {
    syncedEtsyIds,
    etsyResponse: {
      count: totalCount ?? allListings.length,
      downloaded: allListings.length,
      pages: pages.length,
      results: allListings,
    },
  };
}

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const shouldRefresh = searchParams.get('refresh') === '1';
    const state = searchParams.get('state') === 'draft' ? 'draft' : 'active';
    let syncedEtsyIds: string[] | null = null;
    let etsyResponse: EtsyListingResponse | null = null;

    if (shouldRefresh) {
      const syncResult = await syncListingsFromEtsy(state);
      syncedEtsyIds = syncResult.syncedEtsyIds;
      etsyResponse = syncResult.etsyResponse;
    }

    const listings = await prisma.listing.findMany({
      where: syncedEtsyIds ? { etsyId: { in: syncedEtsyIds } } : undefined,
      orderBy: { createdAt: 'desc' },
      select: {
        id: true,
        title: true,
        price: true,
        shopName: true,
      },
    });

    return NextResponse.json({ listings, etsyResponse });
  } catch (error) {
    console.error('Failed to load listings:', error);
    return NextResponse.json(
      {
        error: error instanceof Error ? error.message : 'Unable to fetch listings from Etsy.',
      },
      { status: 500 }
    );
  }
}
