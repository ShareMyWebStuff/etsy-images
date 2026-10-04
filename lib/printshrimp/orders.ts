import { readFile as readLocalFile } from 'node:fs/promises';
import path from 'node:path';

import {
  createOrUpdateDropbox,
  getOrCreateDropboxFileUrl,
  isDropboxPathNotFoundError,
} from '@/lib/dropbox-bundle';
import { getListingDirectoryPath } from '@/lib/local-shop-directory';
import { prisma } from '@/lib/prisma';
import {
  convertPrintShrimpArtwork,
  getPrintShrimpRatioForSize,
  mapPrintShrimpRatioFiles,
  PRINTSHRIMP_SUPPORTED_SIZES,
  validatePrintShrimpBaseSku,
} from '@/lib/printshrimp/artwork';
import {
  getPrintShrimpClientConfig,
  PrintShrimpAdapterError,
  PrintShrimpConfigurationError,
} from '@/lib/printshrimp/client';
import {
  getPrintShrimpCustomFont,
  type PrintShrimpCustomFontId,
} from '@/lib/printshrimp/custom-fonts';
import {
  stagePrintShrimpArtwork,
} from '@/lib/printshrimp/s3-staging';
import { readFile as readStorageFile } from '@/lib/s3-listing-storage';
import { createPersonalisedPrintMaster } from '@/lib/thumbnail-personalisation';

const PRINTSHRIMP_API_BASE_URL = 'https://api.printshrimp.com/functions/v1/';
const PRINTSHRIMP_GET_ORDER_PATH = 'api-get-order';
const PRINTSHRIMP_CREATE_ORDER_PATH = 'api-create-order';
const PRINTSHRIMP_API_KEY_HEADER = 'x-api-key';
const ORDERS_PER_PAGE = 25;

export type PrintShrimpOrder = Record<string, unknown> & {
  order_id?: string;
  external_order_number?: string | null;
  status?: string;
  paid?: boolean;
};

type PrintShrimpOrderListResponse = {
  success?: boolean;
  orders?: PrintShrimpOrder[];
  page?: number;
  total_orders?: number;
  error?: string;
};

type PrintShrimpCreateOrderResponse = Record<string, unknown> & {
  success?: boolean;
  order?: PrintShrimpOrder;
  error?: string;
  message?: string;
};

export type PreparedPrintShrimpOrderPayload = Record<string, unknown> & {
  external_order_number: string;
  customerInfo: Record<string, unknown>;
  products: Array<Record<string, unknown>>;
};

export type PrintShrimpOrderProduct = {
  listingId: string;
  name: string;
  sku: string;
  sectionId: string;
  sectionName: string;
  dropboxFolderUrl: string;
  availableSizes: string[];
  artworkFileNames: Record<string, string>;
  ready: boolean;
  unavailableReason: string | null;
};

export type PrintShrimpOrdersPageData = {
  configured: boolean;
  configurationMessage: string;
  products: PrintShrimpOrderProduct[];
  sizes: string[];
};

export type PrintShrimpOrderPreviewInput = {
  listingId: string;
  size: string;
  productType: 'Print' | 'Frame';
  paperType: string;
  frameColour: string;
  fontId: PrintShrimpCustomFontId;
  topText: string;
  bottomText: string;
  externalOrderNumber: string;
  giftMessage: string;
  name: string;
  email: string;
  address1: string;
  address2: string;
  city: string;
  state: string;
  zip: string;
  country: string;
  phone: string;
  shipping: string;
};

export async function submitPreparedPrintShrimpOrder(
  payload: PreparedPrintShrimpOrderPayload,
  fetchOverride: typeof fetch = fetch,
) {
  const config = getPrintShrimpClientConfig();
  if (!config) throw new PrintShrimpConfigurationError('Set PRINTSHRIMP_API_KEY before creating a PrintShrimp order.');
  let response: Response;
  try {
    response = await fetchOverride(new URL(PRINTSHRIMP_CREATE_ORDER_PATH, PRINTSHRIMP_API_BASE_URL), {
      method: 'POST',
      headers: {
        Accept: 'application/json',
        'Content-Type': 'application/json',
        [PRINTSHRIMP_API_KEY_HEADER]: config.apiKey,
      },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(config.timeoutMilliseconds),
      cache: 'no-store',
    });
  } catch (error) {
    const timedOut = error instanceof Error && (error.name === 'AbortError' || error.name === 'TimeoutError');
    throw new PrintShrimpAdapterError(
      timedOut
        ? 'The PrintShrimp create-order request timed out; the order may have been received.'
        : 'The PrintShrimp create-order API could not be reached; the order may have been received.',
      true,
    );
  }
  const responsePayload = await response.json().catch(() => ({})) as PrintShrimpCreateOrderResponse;
  if (!response.ok || responsePayload.success === false) {
    throw new PrintShrimpAdapterError(
      `PrintShrimp API returned ${response.status}: ${safeRemoteMessage(responsePayload.error ?? responsePayload.message, config.apiKey)}`,
      [408, 425, 429, 500, 502, 503, 504].includes(response.status),
    );
  }
  return responsePayload;
}

function safeRemoteMessage(value: unknown, apiKey: string) {
  const original = typeof value === 'string' ? value : 'PrintShrimp rejected the request.';
  return original
    .split(apiKey).join('[redacted]')
    .replace(/https?:\/\/\S+/gi, '[remote URL]')
    .slice(0, 800);
}

async function requestOrderPage(page: number) {
  const config = getPrintShrimpClientConfig();
  if (!config) throw new PrintShrimpConfigurationError('Set PRINTSHRIMP_API_KEY before retrieving PrintShrimp orders.');

  const url = new URL(PRINTSHRIMP_GET_ORDER_PATH, PRINTSHRIMP_API_BASE_URL);
  url.searchParams.set('page', String(page));
  let response: Response;
  try {
    response = await fetch(url, {
      method: 'GET',
      headers: {
        Accept: 'application/json',
        [PRINTSHRIMP_API_KEY_HEADER]: config.apiKey,
      },
      signal: AbortSignal.timeout(config.timeoutMilliseconds),
      cache: 'no-store',
    });
  } catch (error) {
    const timedOut = error instanceof Error && (error.name === 'AbortError' || error.name === 'TimeoutError');
    throw new PrintShrimpAdapterError(
      timedOut ? 'The PrintShrimp order request timed out.' : 'The PrintShrimp order API could not be reached.',
      true,
    );
  }

  const payload = await response.json().catch(() => ({})) as PrintShrimpOrderListResponse;
  if (!response.ok || payload.success === false) {
    throw new PrintShrimpAdapterError(
      `PrintShrimp API returned ${response.status}: ${safeRemoteMessage(payload.error, config.apiKey)}`,
      [408, 425, 429, 500, 502, 503, 504].includes(response.status),
    );
  }
  if (!Array.isArray(payload.orders)) {
    throw new PrintShrimpAdapterError('PrintShrimp returned an invalid order list.');
  }
  return {
    orders: payload.orders,
    totalOrders: Number.isInteger(payload.total_orders) ? Number(payload.total_orders) : payload.orders.length,
  };
}

export async function retrievePrintShrimpOrders() {
  const firstPage = await requestOrderPage(1);
  const allOrders = [...firstPage.orders];
  const pageCount = Math.max(1, Math.ceil(firstPage.totalOrders / ORDERS_PER_PAGE));
  for (let page = 2; page <= pageCount; page += 1) {
    const nextPage = await requestOrderPage(page);
    allOrders.push(...nextPage.orders);
  }

  const seen = new Set<string>();
  const orders = allOrders.filter((order, index) => {
    const identity = typeof order.order_id === 'string' && order.order_id
      ? order.order_id
      : `${String(order.external_order_number ?? '')}:${index}`;
    if (seen.has(identity)) return false;
    seen.add(identity);
    return true;
  });
  return { orders, totalOrders: firstPage.totalOrders };
}

export async function getPrintShrimpOrdersPageData(): Promise<PrintShrimpOrdersPageData> {
  const config = getPrintShrimpClientConfig();
  const listings = await prisma.etsyListing.findMany({
    select: {
      id: true,
      title: true,
      localDirectoryName: true,
      downloadsRevision: true,
      dropboxRevision: true,
      dropboxSyncedAt: true,
      productConfig: { select: { sku: true } },
      dropboxBundle: { select: { sharedUrl: true } },
      subSection: {
        select: {
          shopSection: { select: { id: true, title: true } },
        },
      },
      files: {
        select: {
          id: true,
          localFileName: true,
          originalFileName: true,
          widthPixels: true,
          heightPixels: true,
          rawJson: true,
        },
      },
    },
    orderBy: [{ title: 'asc' }, { id: 'asc' }],
  });

  const products = listings.flatMap((listing): PrintShrimpOrderProduct[] => {
    const sku = listing.productConfig?.sku?.trim();
    const section = listing.subSection?.shopSection;
    if (!sku || !section) return [];
    const mapping = mapPrintShrimpRatioFiles(listing.files);
    const artworkFileNames: Record<string, string> = {};
    for (const size of PRINTSHRIMP_SUPPORTED_SIZES) {
      const ratio = getPrintShrimpRatioForSize(size);
      const file = ratio ? mapping.files.get(ratio) : null;
      const fileName = file?.originalFileName ?? file?.localFileName;
      if (fileName) artworkFileNames[size] = fileName;
    }
    const availableSizes = PRINTSHRIMP_SUPPORTED_SIZES.filter((size) => Boolean(artworkFileNames[size]));
    const dropboxFolderUrl = listing.dropboxBundle?.sharedUrl?.trim() ?? '';
    const ready = availableSizes.length > 0;
    return [{
      listingId: String(listing.id),
      name: listing.localDirectoryName ?? listing.title,
      sku,
      sectionId: String(section.id),
      sectionName: section.title,
      dropboxFolderUrl,
      availableSizes,
      artworkFileNames,
      ready,
      unavailableReason: ready
        ? null
        : 'This listing has no recognised printable artwork files.',
    }];
  });

  return {
    configured: config !== null,
    configurationMessage: config
      ? 'PrintShrimp API is configured.'
      : 'Set PRINTSHRIMP_API_KEY before retrieving orders.',
    products,
    sizes: [...PRINTSHRIMP_SUPPORTED_SIZES],
  };
}

type PrintShrimpOrderPreviewDependencies = {
  readStorageFile(storagePath: string): Promise<Buffer>;
  readFont(filePath: string): Promise<Buffer>;
  personalise: typeof createPersonalisedPrintMaster;
  convert: typeof convertPrintShrimpArtwork;
};

type PrintShrimpOrderSubmissionDependencies = Partial<PrintShrimpOrderPreviewDependencies> & {
  fetch?: typeof fetch;
  stage?(objectKey: string, contents: Buffer): Promise<string>;
  createStagingPath?(fileName: string): string;
};

function textValue(value: unknown, label: string, maximumLength: number) {
  if (typeof value !== 'string') throw new Error(`${label} is invalid.`);
  const trimmed = value.trim();
  if (trimmed.length > maximumLength) throw new Error(`${label} must be ${maximumLength} characters or fewer.`);
  return trimmed;
}

function safeFilePart(value: string) {
  return value.replace(/[^a-z0-9_-]+/gi, '-').replace(/^-+|-+$/g, '') || 'order';
}

async function loadOrderListing(listingId: number) {
  return prisma.etsyListing.findUnique({
    where: { id: listingId },
    select: {
      title: true,
      localDirectoryName: true,
      productConfig: { select: { sku: true } },
      subSection: {
        select: {
          name: true,
          shopSection: {
            select: {
              title: true,
              shop: { select: { etsyShopId: true, shopName: true, title: true } },
            },
          },
        },
      },
      files: {
        select: {
          id: true,
          localFileName: true,
          originalFileName: true,
          widthPixels: true,
          heightPixels: true,
          rawJson: true,
        },
      },
    },
  });
}

type OrderListing = NonNullable<Awaited<ReturnType<typeof loadOrderListing>>>;

async function renderCustomOrderArtwork(input: {
  listing: OrderListing;
  listingId: number;
  sku: string;
  size: string;
  topText: string;
  bottomText: string;
  fontId: PrintShrimpCustomFontId;
  externalOrderNumber: string;
  dependencies: PrintShrimpOrderPreviewDependencies;
}) {
  const fontChoice = getPrintShrimpCustomFont(input.fontId);
  if (!fontChoice) throw new Error('Select a valid custom text font.');
  const ratio = getPrintShrimpRatioForSize(input.size);
  const sourceFile = ratio ? mapPrintShrimpRatioFiles(input.listing.files).files.get(ratio) : null;
  if (!sourceFile?.localFileName || !sourceFile.widthPixels || !sourceFile.heightPixels) {
    throw new Error(`No valid digital download artwork is available for ${input.size}.`);
  }
  const section = input.listing.subSection?.shopSection;
  const shop = section?.shop;
  if (!input.listing.subSection || !section || !shop) throw new Error('The listing storage location could not be resolved.');
  const shopName = shop.shopName ?? shop.title ?? `Shop ${shop.etsyShopId}`;
  const listingPath = getListingDirectoryPath(
    shopName,
    section.title,
    input.listing.subSection.name,
    input.listing.localDirectoryName ?? `Listing-${input.listingId}`,
  );
  const [source, font] = await Promise.all([
    input.dependencies.readStorageFile(path.join(listingPath, 'downloads', sourceFile.localFileName)),
    input.dependencies.readFont(path.join(process.cwd(), 'public', 'fonts', ...fontChoice.relativePath)),
  ]);
  const personalised = await input.dependencies.personalise(
    source,
    font,
    { headerText: input.topText, footerText: input.bottomText, textTransform: 'NONE' },
    {
      width: sourceFile.widthPixels,
      height: sourceFile.heightPixels,
      density: 300,
      requireSourceAlpha: false,
      fontFamily: fontChoice.family,
      fontWeight: fontChoice.weight,
    },
  );
  const converted = await input.dependencies.convert(personalised.buffer);
  if (converted.jpeg.byteLength > 50 * 1024 * 1024) {
    throw new Error('The customised PrintShrimp artwork exceeds the 50 MB limit.');
  }
  return {
    buffer: converted.jpeg,
    fileName: `${safeFilePart(input.externalOrderNumber)}-${safeFilePart(input.sku)}-${safeFilePart(input.size)}-custom.jpg`,
  };
}

export async function createPrintShrimpOrderPreview(
  input: PrintShrimpOrderPreviewInput,
  overrides: Partial<PrintShrimpOrderPreviewDependencies> = {},
) {
  const dependencies: PrintShrimpOrderPreviewDependencies = {
    readStorageFile,
    readFont: readLocalFile,
    personalise: createPersonalisedPrintMaster,
    convert: convertPrintShrimpArtwork,
    ...overrides,
  };
  const listingId = Number(input.listingId);
  if (!Number.isInteger(listingId) || listingId < 1) throw new Error('Select a valid listing.');
  if (!PRINTSHRIMP_SUPPORTED_SIZES.some((candidate) => candidate === input.size)) {
    throw new Error('Select a valid PrintShrimp size.');
  }
  if (input.productType !== 'Print' && input.productType !== 'Frame') throw new Error('Select Print or Frame.');
  if (!['Matte', 'Satin', 'Gloss'].includes(input.paperType)) throw new Error('Select a valid paper type.');
  if (!['Black', 'White', 'Oak'].includes(input.frameColour)) throw new Error('Select a valid frame colour.');
  const topText = textValue(input.topText, 'Top text', 40);
  const bottomText = textValue(input.bottomText, 'Bottom text', 40);
  const externalOrderNumber = textValue(input.externalOrderNumber, 'ORDER No', 100);
  if (!getPrintShrimpCustomFont(input.fontId)) throw new Error('Select a valid custom text font.');

  const listing = await loadOrderListing(listingId);
  if (!listing) throw new Error('The selected listing no longer exists.');
  const sku = validatePrintShrimpBaseSku(listing.productConfig?.sku);
  const custom = Boolean(topText || bottomText);
  let customArtwork: Awaited<ReturnType<typeof renderCustomOrderArtwork>> | null = null;

  if (custom) {
    customArtwork = await renderCustomOrderArtwork({
      listing,
      listingId,
      sku,
      size: input.size,
      topText,
      bottomText,
      fontId: input.fontId,
      externalOrderNumber,
      dependencies,
    });
  }

  const product = customArtwork
    ? input.productType === 'Frame'
      ? {
        size: input.size,
        type: 'Frame',
        variant: input.frameColour,
      }
      : {
        size: input.size,
        type: 'Print',
        paper_type: input.paperType,
      }
    : input.productType === 'Frame'
      ? { sku, size: input.size, type: 'Frame', variant: input.frameColour }
      : { sku, size: input.size, type: 'Print', paper_type: input.paperType };

  return {
    custom,
    folderUrl: null as string | null,
    artworkUrl: null as string | null,
    fileName: customArtwork?.fileName ?? null,
    customArtwork,
    payload: {
      external_order_number: externalOrderNumber,
      gift_message: input.giftMessage,
      customerInfo: {
        name: input.name,
        email: input.email,
        address1: input.address1,
        address2: input.address2,
        city: input.city,
        state: input.state,
        zip: input.zip,
        country: input.country,
        phone: input.phone,
        shipping: input.shipping,
      },
      products: [product],
    },
  };
}

type InternalPreparedPrintShrimpOrder = Awaited<ReturnType<typeof createPrintShrimpOrderPreview>>;
type PreparedPrintShrimpOrder = Omit<InternalPreparedPrintShrimpOrder, 'customArtwork'>;

export class PrintShrimpOrderSubmissionError extends PrintShrimpAdapterError {
  constructor(
    message: string,
    transient: boolean,
    readonly httpStatus: number | null,
    readonly prepared: PreparedPrintShrimpOrder,
    readonly response: PrintShrimpCreateOrderResponse | null = null,
  ) {
    super(message, transient);
  }
}

export async function submitPrintShrimpOrder(
  input: PrintShrimpOrderPreviewInput,
  overrides: PrintShrimpOrderSubmissionDependencies = {},
) {
  const {
    fetch: fetchOverride,
    stage: stageOverride,
    createStagingPath: createStagingPathOverride,
    ...previewOverrides
  } = overrides;
  const internalPrepared = await createPrintShrimpOrderPreview(input, previewOverrides);
  const { customArtwork, ...publicPrepared } = internalPrepared;
  let prepared: PreparedPrintShrimpOrder = publicPrepared;
  const config = getPrintShrimpClientConfig();
  if (!config) throw new PrintShrimpConfigurationError('Set PRINTSHRIMP_API_KEY before creating a PrintShrimp order.');
  const fetchOrder = fetchOverride ?? fetch;
  const stage = stageOverride ?? stagePrintShrimpArtwork;
  const createStagingPath = createStagingPathOverride
    ?? ((fileName: string) => `printshrimp-staging/custom-orders/${safeFilePart(input.externalOrderNumber)}/${fileName}`);
  if (customArtwork) {
      const stagingPath = createStagingPath(customArtwork.fileName);
      let stagedArtworkUrl: string;
      try {
        stagedArtworkUrl = await stage(stagingPath, customArtwork.buffer);
      } catch (error) {
        throw new PrintShrimpOrderSubmissionError(
          `The custom artwork could not be saved in the PrintShrimp upload bucket: ${error instanceof Error ? error.message : 'Unknown upload error.'}`,
          false,
          null,
          prepared,
        );
      }
      if (new URL(stagedArtworkUrl).protocol !== 'https:') {
        throw new PrintShrimpOrderSubmissionError(
          'The PrintShrimp upload bucket returned an artwork URL that does not use HTTPS.',
          false,
          null,
          prepared,
        );
      }
      const product = input.productType === 'Frame'
        ? {
          size: input.size,
          type: 'Frame',
          variant: input.frameColour,
          image: { artwork_url: stagedArtworkUrl },
        }
        : {
          size: input.size,
          type: 'Print',
          paper_type: input.paperType,
          image: { artwork_url: stagedArtworkUrl },
        };
      prepared = {
        ...prepared,
        artworkUrl: stagedArtworkUrl,
        fileName: customArtwork.fileName,
        payload: {
          ...prepared.payload,
          products: [product],
        },
      };
  }

  let response: Response;
  try {
    response = await fetchOrder(new URL(PRINTSHRIMP_CREATE_ORDER_PATH, PRINTSHRIMP_API_BASE_URL), {
      method: 'POST',
      headers: {
        Accept: 'application/json',
        'Content-Type': 'application/json',
        [PRINTSHRIMP_API_KEY_HEADER]: config.apiKey,
      },
      body: JSON.stringify(prepared.payload),
      signal: AbortSignal.timeout(config.timeoutMilliseconds),
      cache: 'no-store',
    });
  } catch (error) {
    const timedOut = error instanceof Error && (error.name === 'AbortError' || error.name === 'TimeoutError');
    throw new PrintShrimpOrderSubmissionError(
      timedOut
        ? 'The PrintShrimp create-order request timed out. Check PrintShrimp before trying again because the order may have been received.'
        : 'The PrintShrimp create-order API could not be reached. Check PrintShrimp before trying again because the order may have been received.',
      true,
      null,
      prepared,
    );
  }

  const responsePayload = await response.json().catch(() => ({})) as PrintShrimpCreateOrderResponse;
  if (!response.ok || responsePayload.success === false) {
    throw new PrintShrimpOrderSubmissionError(
      `PrintShrimp API returned ${response.status}: ${safeRemoteMessage(responsePayload.error ?? responsePayload.message, config.apiKey)}`,
      [408, 425, 429, 500, 502, 503, 504].includes(response.status),
      response.status,
      prepared,
      responsePayload,
    );
  }
  return {
    ...prepared,
    order: responsePayload.order ?? null,
    response: responsePayload,
  };
}

export type PrintShrimpCustomArtworkPreviewInput = Pick<
  PrintShrimpOrderPreviewInput,
  'listingId' | 'size' | 'topText' | 'bottomText' | 'fontId' | 'externalOrderNumber'
>;

export async function generatePrintShrimpCustomArtworkPreview(
  input: PrintShrimpCustomArtworkPreviewInput,
  overrides: Partial<PrintShrimpOrderPreviewDependencies> = {},
) {
  const dependencies: PrintShrimpOrderPreviewDependencies = {
    readStorageFile,
    readFont: readLocalFile,
    personalise: createPersonalisedPrintMaster,
    convert: convertPrintShrimpArtwork,
    ...overrides,
  };
  const listingId = Number(input.listingId);
  if (!Number.isInteger(listingId) || listingId < 1) throw new Error('Select a valid listing.');
  if (!PRINTSHRIMP_SUPPORTED_SIZES.some((candidate) => candidate === input.size)) {
    throw new Error('Select a valid PrintShrimp size.');
  }
  const topText = textValue(input.topText, 'Top text', 40);
  const bottomText = textValue(input.bottomText, 'Bottom text', 40);
  if (!topText && !bottomText) throw new Error('Enter Top text or Bottom text before generating the preview.');
  if (!getPrintShrimpCustomFont(input.fontId)) throw new Error('Select a valid custom text font.');
  const externalOrderNumber = textValue(input.externalOrderNumber, 'ORDER No', 100);
  const listing = await loadOrderListing(listingId);
  if (!listing) throw new Error('The selected listing no longer exists.');
  const sku = validatePrintShrimpBaseSku(listing.productConfig?.sku);
  return renderCustomOrderArtwork({
    listing,
    listingId,
    sku,
    size: input.size,
    topText,
    bottomText,
    fontId: input.fontId,
    externalOrderNumber,
    dependencies,
  });
}

export async function getPrintShrimpOrderArtworkUrl(listingId: string, size: string) {
  const parsedListingId = Number(listingId);
  if (!Number.isInteger(parsedListingId) || parsedListingId < 1) throw new Error('Select a valid listing.');
  if (!PRINTSHRIMP_SUPPORTED_SIZES.some((candidate) => candidate === size)) throw new Error('Select a valid PrintShrimp size.');

  const listing = await prisma.etsyListing.findUnique({
    where: { id: parsedListingId },
    select: {
      downloadsRevision: true,
      dropboxRevision: true,
      dropboxSyncedAt: true,
      dropboxBundle: { select: { folderPath: true, sharedUrl: true } },
      subSection: {
        select: {
          id: true,
          shopSection: {
            select: {
              id: true,
              shop: { select: { etsyShopId: true } },
            },
          },
        },
      },
      files: {
        select: {
          id: true,
          localFileName: true,
          originalFileName: true,
          widthPixels: true,
          heightPixels: true,
          rawJson: true,
        },
      },
    },
  });
  if (!listing) throw new Error('The selected listing no longer exists.');
  if (!listing.dropboxBundle?.sharedUrl || listing.dropboxSyncedAt === null
    || listing.dropboxRevision !== listing.downloadsRevision) {
    throw new Error('Update this listing on the Dropbox tab before creating an order.');
  }

  const ratio = getPrintShrimpRatioForSize(size);
  const sourceFile = ratio ? mapPrintShrimpRatioFiles(listing.files).files.get(ratio) : null;
  const fileName = sourceFile?.originalFileName ?? sourceFile?.localFileName;
  if (!fileName || fileName !== path.basename(fileName)) {
    throw new Error(`No valid Dropbox artwork is available for ${size}.`);
  }

  const resolveArtworkUrl = () => getOrCreateDropboxFileUrl(listing.dropboxBundle!.folderPath, fileName);
  let artworkUrl: string;
  try {
    artworkUrl = await resolveArtworkUrl();
  } catch (error) {
    if (!isDropboxPathNotFoundError(error)) throw error;
    const section = listing.subSection?.shopSection;
    if (!listing.subSection || !section?.shop) {
      throw new Error('The Dropbox artwork is missing and the listing context could not be resolved.');
    }
    // Listings synced before the unzipped Dropbox change can still contain the
    // legacy ZIP while their revision looks current. Refresh that managed
    // folder once, then resolve the new individual artwork link.
    await createOrUpdateDropbox({
      shopId: section.shop.etsyShopId.toString(),
      sectionId: String(section.id),
      subSectionId: String(listing.subSection.id),
      listingId: String(parsedListingId),
    });
    artworkUrl = await resolveArtworkUrl();
  }

  return {
    fileName,
    folderUrl: listing.dropboxBundle.sharedUrl,
    artworkUrl,
  };
}
