import { Prisma, type EtsyOrderProcessingStatus } from '@prisma/client';

import {
  acknowledgeEtsyReceiptForProcessing,
  getEtsyReceipt,
  getEtsyReceipts,
  getEtsyReceiptTransactions,
  type EtsyReceiptResponse,
  type EtsyTransactionResponse,
} from '@/lib/etsy-accounting-api';
import { getEtsyOAuthConnectionStatus, getEtsyOrderAccessToken } from '@/lib/etsy-oauth';
import { prisma } from '@/lib/prisma';
import { PRINTSHRIMP_SUPPORTED_SIZES } from '@/lib/printshrimp/artwork';
import { PrintShrimpAdapterError } from '@/lib/printshrimp/client';
import { getPrintShrimpCustomFont, type PrintShrimpCustomFontId } from '@/lib/printshrimp/custom-fonts';
import {
  generatePrintShrimpCustomArtworkPreview,
  submitPreparedPrintShrimpOrder,
  type PreparedPrintShrimpOrderPayload,
} from '@/lib/printshrimp/orders';
import { stagePrintShrimpArtwork } from '@/lib/printshrimp/s3-staging';

const ORDER_SYNC_OVERLAP_SECONDS = 7 * 24 * 60 * 60;
const ACTIVE_PROCESSING_STATUSES: EtsyOrderProcessingStatus[] = ['UNPROCESSED', 'BLOCKED', 'FAILED', 'UNKNOWN'];
const FONT_ID_BY_NAME: Record<string, PrintShrimpCustomFontId> = {
  nunito: 'nunito-semibold',
  fredoka: 'fredoka-bold',
  quicksand: 'quicksand-semibold',
  'patrick hand': 'patrick-hand-regular',
  caveat: 'caveat-bold',
  sacramento: 'sacramento-regular',
};

const ORDER_INCLUDE = Prisma.validator<Prisma.EtsyOrderInclude>()({
  items: {
    orderBy: { id: 'asc' },
    include: {
      listing: {
        select: {
          id: true,
          title: true,
          localDirectoryName: true,
          shopId: true,
          subSectionId: true,
          subSection: { select: { shopSectionId: true } },
        },
      },
    },
  },
  attempts: { orderBy: { attemptNumber: 'asc' } },
});

type JsonRecord = Record<string, unknown>;

function record(value: unknown): JsonRecord | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value) ? value as JsonRecord : null;
}

function text(value: unknown, maximum = 10_000) {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed ? trimmed.slice(0, maximum) : null;
}

function positiveInteger(value: unknown) {
  const parsed = typeof value === 'number' ? value : typeof value === 'string' && /^\d+$/.test(value) ? Number(value) : NaN;
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : null;
}

function positiveBigInt(value: unknown) {
  const stringValue = typeof value === 'number' || typeof value === 'bigint' || typeof value === 'string'
    ? String(value)
    : '';
  return /^\d+$/.test(stringValue) && stringValue !== '0' ? BigInt(stringValue) : null;
}

function epochDate(...values: unknown[]) {
  const seconds = values.map(positiveInteger).find((value) => value !== null);
  return seconds === undefined ? null : new Date(seconds * 1000);
}

function jsonValue(value: unknown): Prisma.InputJsonValue {
  return JSON.parse(JSON.stringify(value ?? {})) as Prisma.InputJsonValue;
}

function normalizedStatus(value: unknown) {
  return (text(value, 50) ?? '').toLocaleLowerCase();
}

export function processingStatusForReceipt(receipt: EtsyReceiptResponse, existing?: EtsyOrderProcessingStatus | null) {
  const status = normalizedStatus(receipt.status);
  const canceled = receipt.is_canceled === true || receipt.was_canceled === true || status === 'canceled' || status === 'cancelled';
  const shipped = receipt.is_shipped === true || receipt.was_shipped === true || status === 'completed';
  if (canceled) return 'CANCELED' as const;
  if (shipped) return 'COMPLETED' as const;
  if (existing === 'SUBMITTED' || existing === 'PROCESSING' || existing === 'FAILED' || existing === 'UNKNOWN') return existing;
  return receipt.is_paid === true && status === 'paid' ? 'UNPROCESSED' as const : 'BLOCKED' as const;
}

function variationPairs(transaction: EtsyTransactionResponse) {
  const variations = Array.isArray(transaction.variations) ? transaction.variations : [];
  return variations.flatMap((variation) => {
    const item = record(variation);
    const name = text(item?.formatted_name ?? item?.property_name ?? item?.name, 100);
    const value = text(item?.formatted_value ?? item?.value ?? item?.value_name, 500);
    return name && value ? [{ name, value }] : [];
  });
}

function variationValue(pairs: Array<{ name: string; value: string }>, ...names: RegExp[]) {
  return pairs.find((pair) => names.some((name) => name.test(pair.name)))?.value ?? null;
}

export function normalizePrintShrimpOrderSize(value: string | null | undefined) {
  if (!value) return null;
  const compact = value
    .replace(/[”″"]/g, '')
    .replace(/\binches?\b/gi, '')
    .replace(/\s+/g, '')
    .replace(/×/g, 'x')
    .toLocaleLowerCase();
  const aSize = compact.match(/^a([1-5])(?:\b|$)/i)?.[0]?.toUpperCase();
  if (aSize && PRINTSHRIMP_SUPPORTED_SIZES.some((size) => size === aSize)) return aSize;
  const dimension = compact.match(/(\d+)x(\d+)(cm)?/i);
  if (!dimension) return null;
  const candidate = `${Number(dimension[1])}x${Number(dimension[2])}${dimension[3] ? 'cm' : ''}`;
  return PRINTSHRIMP_SUPPORTED_SIZES.find((size) => size.toLocaleLowerCase() === candidate.toLocaleLowerCase()) ?? null;
}

function fontIdFromValue(value: string | null) {
  const normalized = value?.trim().toLocaleLowerCase() ?? '';
  if (!normalized || normalized.includes('no custom')) return 'nunito-semibold' as const;
  return Object.entries(FONT_ID_BY_NAME).find(([name]) => normalized.includes(name))?.[1] ?? 'nunito-semibold';
}

export function parseEtsyOrderTransaction(transaction: EtsyTransactionResponse) {
  const transactionRecord = transaction as JsonRecord;
  const productData = record(transactionRecord.product_data);
  const pairs = variationPairs(transaction);
  const frameValue = variationValue(pairs, /frame/i, /finish/i);
  const topText = variationValue(pairs, /^top\s*text$/i, /text.*top/i)?.slice(0, 40) ?? null;
  const bottomText = variationValue(pairs, /^bottom\s*text$/i, /text.*bottom/i)?.slice(0, 40) ?? null;
  const fontValue = variationValue(pairs, /^font(?:\s*style)?$/i);
  const noFrame = !frameValue || /no\s*frame|unframed/i.test(frameValue);
  return {
    etsyTransactionId: positiveBigInt(transaction.transaction_id),
    etsyListingId: positiveBigInt(transaction.listing_id),
    sku: text(transactionRecord.sku ?? productData?.sku, 100),
    title: text(transaction.title, 500),
    quantity: positiveInteger(transaction.quantity) ?? 1,
    size: normalizePrintShrimpOrderSize(variationValue(pairs, /^sizes?$/i, /print\s*sizes?/i)),
    productType: noFrame ? 'Print' as const : 'Frame' as const,
    frameColour: noFrame ? null : /white/i.test(frameValue) ? 'White' : /oak|natural/i.test(frameValue) ? 'Oak' : 'Black',
    paperType: 'Matte' as const,
    fontId: fontIdFromValue(fontValue),
    topText,
    bottomText,
    isCustomised: Boolean(topText || bottomText),
    rawJson: jsonValue(transaction),
  };
}

async function persistEtsyOrderReceipt(
  etsyShopId: bigint,
  receipt: EtsyReceiptResponse,
  suppliedTransactions?: EtsyTransactionResponse[],
) {
  const etsyReceiptId = positiveBigInt(receipt.receipt_id);
  if (!etsyReceiptId) throw new Error('Etsy returned an order without a valid receipt id.');
  const transactions = suppliedTransactions ?? (Array.isArray(receipt.transactions) ? receipt.transactions : []);
  const parsedItems = transactions.map(parseEtsyOrderTransaction).filter((item) => item.etsyTransactionId !== null);
  const listingIds = [...new Set(parsedItems.flatMap((item) => item.etsyListingId ? [item.etsyListingId.toString()] : []))];
  const skus = [...new Set(parsedItems.flatMap((item) => item.sku ? [item.sku] : []))];
  const listingMatchers: Prisma.EtsyListingWhereInput[] = [];
  if (listingIds.length > 0) {
    listingMatchers.push({ etsyId: { in: listingIds } }, { etsyDownloadId: { in: listingIds } });
  }
  if (skus.length > 0) {
    listingMatchers.push(
      { products: { some: { sku: { in: skus } } } },
      { productConfig: { is: { sku: { in: skus } } } },
    );
  }
  const localListings = listingMatchers.length > 0
    ? await prisma.etsyListing.findMany({
      where: { OR: listingMatchers },
      select: {
        id: true,
        etsyId: true,
        etsyDownloadId: true,
        productConfig: { select: { sku: true } },
        products: { select: { sku: true } },
      },
    })
    : [];
  const localByEtsyId = new Map(localListings.flatMap((listing) => [listing.etsyId, listing.etsyDownloadId]
    .filter((etsyId): etsyId is string => Boolean(etsyId))
    .map((etsyId) => [etsyId, listing] as const)));
  const localBySku = new Map(localListings.flatMap((listing) => [
    listing.productConfig?.sku,
    ...listing.products.map((product) => product.sku),
  ]
    .filter((sku): sku is string => Boolean(sku))
    .map((sku) => [sku.toLocaleLowerCase(), listing] as const)));

  return prisma.$transaction(async (tx) => {
    const existing = await tx.etsyOrder.findUnique({
      where: { etsyShopId_etsyReceiptId: { etsyShopId, etsyReceiptId } },
      select: { id: true, processingStatus: true },
    });
    const processingStatus = processingStatusForReceipt(receipt, existing?.processingStatus);
    const status = text(receipt.status, 50);
    const isCanceled = processingStatus === 'CANCELED';
    const isShipped = receipt.is_shipped === true || receipt.was_shipped === true || normalizedStatus(status) === 'completed';
    const common = {
      etsyStatus: status,
      processingStatus,
      name: text(receipt.name, 255),
      buyerEmail: text(receipt.buyer_email ?? receipt.payment_email, 320),
      address1: text(receipt.first_line, 500),
      address2: text(receipt.second_line, 500),
      city: text(receipt.city, 191),
      state: text(receipt.state, 191),
      postcode: text(receipt.zip, 50),
      countryIso: text(receipt.country_iso, 2)?.toUpperCase() ?? null,
      isPaid: receipt.is_paid === true,
      isShipped,
      isCanceled,
      isGift: receipt.is_gift === true,
      giftMessage: text(receipt.gift_message),
      orderedAt: epochDate(receipt.created_timestamp, receipt.create_timestamp),
      updatedAtEtsy: epochDate(receipt.updated_timestamp, receipt.update_timestamp),
      lastStatusCheckedAt: new Date(),
      rawJson: jsonValue({ ...receipt, transactions }),
      ...(processingStatus === 'CANCELED' || processingStatus === 'COMPLETED' ? { processError: null } : {}),
    };
    const order = await tx.etsyOrder.upsert({
      where: { etsyShopId_etsyReceiptId: { etsyShopId, etsyReceiptId } },
      create: { etsyShopId, etsyReceiptId, ...common },
      update: common,
    });
    const existingItems = await tx.etsyOrderItem.findMany({ where: { orderId: order.id } });
    const existingByTransaction = new Map(existingItems.map((item) => [item.etsyTransactionId.toString(), item]));
    const keptTransactions: bigint[] = [];
    for (const item of parsedItems) {
      const transactionId = item.etsyTransactionId!;
      keptTransactions.push(transactionId);
      const localListing = (item.etsyListingId ? localByEtsyId.get(item.etsyListingId.toString()) : null)
        ?? (item.sku ? localBySku.get(item.sku.toLocaleLowerCase()) : null);
      const previous = existingByTransaction.get(transactionId.toString());
      const inputsChanged = previous && (
        previous.size !== item.size
        || previous.topText !== item.topText
        || previous.bottomText !== item.bottomText
        || previous.fontId !== item.fontId
      );
      const itemData = {
        etsyListingId: item.etsyListingId,
        listingId: localListing?.id ?? null,
        sku: item.sku ?? localListing?.productConfig?.sku ?? null,
        title: item.title,
        quantity: item.quantity,
        size: item.size,
        productType: item.productType,
        frameColour: item.frameColour,
        paperType: item.paperType,
        fontId: item.fontId,
        topText: item.topText,
        bottomText: item.bottomText,
        isCustomised: item.isCustomised,
        rawJson: item.rawJson,
        ...(inputsChanged ? { artworkUrl: null, artworkFileName: null, artworkGeneratedAt: null } : {}),
      };
      await tx.etsyOrderItem.upsert({
        where: { orderId_etsyTransactionId: { orderId: order.id, etsyTransactionId: transactionId } },
        create: { orderId: order.id, etsyTransactionId: transactionId, ...itemData },
        update: itemData,
      });
    }
    await tx.etsyOrderItem.deleteMany({
      where: { orderId: order.id, ...(keptTransactions.length > 0 ? { etsyTransactionId: { notIn: keptTransactions } } : {}) },
    });
    return order;
  });
}

async function receiptWithTransactions(accessToken: string, etsyShopId: bigint, receipt: EtsyReceiptResponse) {
  const receiptId = positiveBigInt(receipt.receipt_id);
  if (!receiptId) return null;
  const transactions = Array.isArray(receipt.transactions)
    ? receipt.transactions
    : await getEtsyReceiptTransactions({ accessToken, shopId: etsyShopId.toString(), receiptId: receiptId.toString() });
  return { receipt, transactions };
}

export async function syncEtsyOrders() {
  const accessToken = await getEtsyOrderAccessToken(false);
  const shops = await prisma.etsyShop.findMany({ select: { etsyShopId: true } });
  const summary = { shops: shops.length, downloaded: 0, refreshed: 0 };
  for (const { etsyShopId } of shops) {
    const syncThrough = new Date();
    await prisma.etsyOrderSyncState.upsert({
      where: { etsyShopId },
      create: { etsyShopId, syncStartedAt: syncThrough },
      update: { syncStartedAt: syncThrough, lastError: null },
    });
    try {
      const state = await prisma.etsyOrderSyncState.findUniqueOrThrow({ where: { etsyShopId } });
      const minimum = state.lastSuccessfulSyncAt
        ? Math.max(946684800, Math.floor(state.lastSuccessfulSyncAt.getTime() / 1000) - ORDER_SYNC_OVERLAP_SECONDS)
        : null;
      const receipts = await getEtsyReceipts({
        accessToken,
        shopId: etsyShopId.toString(),
        minLastModified: minimum,
        maxLastModified: minimum ? Math.floor(syncThrough.getTime() / 1000) : null,
      });
      const refreshedIds = new Set<string>();
      for (const receipt of receipts) {
        const loaded = await receiptWithTransactions(accessToken, etsyShopId, receipt);
        if (!loaded) continue;
        await persistEtsyOrderReceipt(etsyShopId, loaded.receipt, loaded.transactions);
        const receiptId = positiveBigInt(receipt.receipt_id)!;
        refreshedIds.add(receiptId.toString());
        summary.downloaded += 1;
      }

      const unprocessed = await prisma.etsyOrder.findMany({
        where: {
          etsyShopId,
          printShrimpSubmittedAt: null,
          processingStatus: { in: ACTIVE_PROCESSING_STATUSES },
        },
        select: { etsyReceiptId: true },
      });
      for (const { etsyReceiptId } of unprocessed) {
        if (refreshedIds.has(etsyReceiptId.toString())) continue;
        const receipt = await getEtsyReceipt({ accessToken, shopId: etsyShopId.toString(), receiptId: etsyReceiptId.toString() });
        const loaded = await receiptWithTransactions(accessToken, etsyShopId, receipt);
        if (!loaded) continue;
        await persistEtsyOrderReceipt(etsyShopId, loaded.receipt, loaded.transactions);
        summary.refreshed += 1;
      }
      await prisma.etsyOrderSyncState.update({
        where: { etsyShopId },
        data: { lastSuccessfulSyncAt: syncThrough, syncStartedAt: null, lastError: null },
      });
    } catch (error) {
      await prisma.etsyOrderSyncState.update({
        where: { etsyShopId },
        data: { syncStartedAt: null, lastError: error instanceof Error ? error.message : 'Order sync failed.' },
      });
      throw error;
    }
  }
  return summary;
}

export function buildLocalListingHref(listing: {
  id: number;
  shopId: string;
  subSectionId: number | null;
  subSection: { shopSectionId: number } | null;
}) {
  if (!listing.subSectionId || !listing.subSection) return null;
  return `/listings/edit?${new URLSearchParams({
    shopId: listing.shopId,
    sectionId: String(listing.subSection.shopSectionId),
    subSectionId: String(listing.subSectionId),
    listingId: String(listing.id),
  })}`;
}

function serializeOrder(order: Awaited<ReturnType<typeof loadOrder>>) {
  if (!order) return null;
  return {
    id: String(order.id),
    etsyReceiptId: order.etsyReceiptId.toString(),
    etsyShopId: order.etsyShopId.toString(),
    name: order.name ?? '',
    buyerEmail: order.buyerEmail ?? '',
    address1: order.address1 ?? '',
    address2: order.address2 ?? '',
    city: order.city ?? '',
    state: order.state ?? '',
    postcode: order.postcode ?? '',
    countryIso: order.countryIso ?? '',
    isPaid: order.isPaid,
    isShipped: order.isShipped,
    isCanceled: order.isCanceled,
    isGift: order.isGift,
    giftMessage: order.giftMessage ?? '',
    etsyStatus: order.etsyStatus ?? '',
    processingStatus: order.processingStatus,
    orderedAt: order.orderedAt?.toISOString() ?? null,
    updatedAtEtsy: order.updatedAtEtsy?.toISOString() ?? null,
    printShrimpAttemptedAt: order.printShrimpAttemptedAt?.toISOString() ?? null,
    printShrimpSubmittedAt: order.printShrimpSubmittedAt?.toISOString() ?? null,
    printShrimpOrderId: order.printShrimpOrderId ?? null,
    processError: order.processError ?? null,
    rawJson: order.rawJson,
    items: order.items.map((item) => ({
      id: String(item.id),
      etsyTransactionId: item.etsyTransactionId.toString(),
      etsyListingId: item.etsyListingId?.toString() ?? null,
      listingId: item.listingId ? String(item.listingId) : null,
      listingName: item.listing?.localDirectoryName ?? item.listing?.title ?? null,
      listingHref: item.listing ? buildLocalListingHref(item.listing) : null,
      sku: item.sku ?? '',
      title: item.title ?? '',
      quantity: item.quantity,
      size: item.size ?? '',
      productType: item.productType ?? '',
      frameColour: item.frameColour ?? '',
      paperType: item.paperType ?? '',
      fontId: item.fontId ?? '',
      topText: item.topText ?? '',
      bottomText: item.bottomText ?? '',
      isCustomised: item.isCustomised,
      artworkUrl: item.artworkUrl,
      artworkFileName: item.artworkFileName,
      artworkGeneratedAt: item.artworkGeneratedAt?.toISOString() ?? null,
      rawJson: item.rawJson,
    })),
    attempts: order.attempts.map((attempt) => ({
      id: String(attempt.id),
      attemptNumber: attempt.attemptNumber,
      explicitResend: attempt.explicitResend,
      status: attempt.status,
      error: attempt.error,
      attemptedAt: attempt.attemptedAt.toISOString(),
      completedAt: attempt.completedAt?.toISOString() ?? null,
    })),
  };
}

async function loadOrder(orderId: number) {
  return prisma.etsyOrder.findUnique({
    where: { id: orderId },
    include: ORDER_INCLUDE,
  });
}

function parseOrderId(value: string) {
  const orderId = Number(value);
  if (!Number.isSafeInteger(orderId) || orderId < 1) throw new Error('Choose a valid Etsy order.');
  return orderId;
}

function buildOrderPayload(order: NonNullable<Awaited<ReturnType<typeof loadOrder>>>, resendNumber?: number) {
  const missing = [
    !order.name && 'recipient name',
    !order.buyerEmail && 'email address',
    !order.address1 && 'address line 1',
    !order.city && 'town or city',
    !order.postcode && 'postcode',
    !order.countryIso && 'country',
    order.items.length === 0 && 'order items',
  ].filter((value): value is string => Boolean(value));
  const products: Array<Record<string, unknown>> = [];
  for (const item of order.items) {
    if (!item.listingId) missing.push(`${item.title || 'item'} local listing match`);
    if (!item.size) missing.push(`${item.title || 'item'} supported size`);
    if (!item.sku) missing.push(`${item.title || 'item'} SKU`);
    if (item.isCustomised && !item.artworkUrl) missing.push(`${item.title || 'item'} customised artwork`);
    if (!item.size || !item.productType || !item.sku) continue;
    const base = item.productType === 'Frame'
      ? { size: item.size, type: 'Frame', variant: item.frameColour || 'Black' }
      : { size: item.size, type: 'Print', paper_type: item.paperType || 'Matte' };
    const product = item.isCustomised
      ? { ...base, image: { artwork_url: item.artworkUrl } }
      : { sku: item.sku, ...base };
    for (let quantity = 0; quantity < Math.max(1, item.quantity); quantity += 1) products.push(product);
  }
  const externalOrderNumber = `ETSY-${order.etsyReceiptId.toString()}${resendNumber ? `-R${resendNumber}` : ''}`;
  const payload: PreparedPrintShrimpOrderPayload = {
    external_order_number: externalOrderNumber,
    gift_message: order.giftMessage ?? '',
    customerInfo: {
      name: order.name ?? '',
      email: order.buyerEmail ?? '',
      address1: order.address1 ?? '',
      address2: order.address2 ?? '',
      city: order.city ?? '',
      state: order.state ?? '',
      zip: order.postcode ?? '',
      country: order.countryIso ?? '',
      phone: '',
      shipping: 'standard',
    },
    products,
  };
  return { payload, missing: [...new Set(missing)] };
}

export async function getEtsyOrdersPageData() {
  const [orders, connection] = await Promise.all([
    prisma.etsyOrder.findMany({
      orderBy: [{ orderedAt: 'desc' }, { id: 'desc' }],
      take: 500,
      include: ORDER_INCLUDE,
    }),
    getEtsyOAuthConnectionStatus(),
  ]);
  return {
    orders: orders.map((order) => serializeOrder(order)!),
    reconnectUrl: '/api/etsy/connect?returnTo=/etsy/orders',
    connected: connection.connected,
    hasTransactionsReadScope: connection.hasTransactionsScope,
    hasTransactionsWriteScope: connection.hasTransactionsWriteScope,
  };
}

export async function getEtsyOrderDetails(orderIdValue: string) {
  const order = await loadOrder(parseOrderId(orderIdValue));
  if (!order) throw new Error('Etsy order not found.');
  const { payload, missing } = buildOrderPayload(order);
  return {
    order: serializeOrder(order)!,
    payload,
    missing,
    isCustomised: order.items.some((item) => item.isCustomised),
    canCreate: missing.length === 0 && order.processingStatus === 'UNPROCESSED' && order.attempts.length === 0,
  };
}

export async function generateEtsyOrderArtwork(orderIdValue: string) {
  const orderId = parseOrderId(orderIdValue);
  const order = await loadOrder(orderId);
  if (!order) throw new Error('Etsy order not found.');
  const generated: Array<{ itemId: string; url: string; fileName: string }> = [];
  for (const item of order.items.filter((candidate) => candidate.isCustomised)) {
    if (!item.listingId) throw new Error(`${item.title || 'The customised item'} is not linked to a local listing.`);
    if (!item.size) throw new Error(`${item.title || 'The customised item'} does not have a supported PrintShrimp size.`);
    const fontId = getPrintShrimpCustomFont(item.fontId) ? item.fontId as PrintShrimpCustomFontId : 'nunito-semibold';
    const rendered = await generatePrintShrimpCustomArtworkPreview({
      listingId: String(item.listingId),
      size: item.size,
      topText: item.topText ?? '',
      bottomText: item.bottomText ?? '',
      fontId,
      externalOrderNumber: `ETSY-${order.etsyReceiptId.toString()}`,
    });
    const objectKey = `printshrimp-staging/etsy-orders/${order.etsyReceiptId.toString()}/${item.id}-${rendered.fileName}`;
    const url = await stagePrintShrimpArtwork(objectKey, rendered.buffer);
    await prisma.etsyOrderItem.update({
      where: { id: item.id },
      data: { artworkUrl: url, artworkFileName: rendered.fileName, artworkGeneratedAt: new Date() },
    });
    generated.push({ itemId: String(item.id), url, fileName: rendered.fileName });
  }
  if (generated.length === 0) throw new Error('This Etsy order has no customised items.');
  return { generated, details: await getEtsyOrderDetails(String(orderId)) };
}

async function refreshOneOrder(orderId: number) {
  const order = await prisma.etsyOrder.findUnique({ where: { id: orderId } });
  if (!order) throw new Error('Etsy order not found.');
  const accessToken = await getEtsyOrderAccessToken(false);
  const receipt = await getEtsyReceipt({
    accessToken,
    shopId: order.etsyShopId.toString(),
    receiptId: order.etsyReceiptId.toString(),
  });
  const loaded = await receiptWithTransactions(accessToken, order.etsyShopId, receipt);
  if (!loaded) throw new Error('Etsy returned an invalid order receipt.');
  await persistEtsyOrderReceipt(order.etsyShopId, loaded.receipt, loaded.transactions);
  return { order: await loadOrder(orderId), accessToken };
}

async function acquireAttempt(orderId: number, payload: PreparedPrintShrimpOrderPayload, explicitResend: boolean) {
  return prisma.$transaction(async (tx) => {
    const order = await tx.etsyOrder.findUniqueOrThrow({
      where: { id: orderId },
      include: { attempts: { orderBy: { attemptNumber: 'desc' }, take: 1 } },
    });
    const lastAttempt = order.attempts[0];
    if (!explicitResend && lastAttempt) {
      throw new Error('This order has already been sent or attempted. Use PrintShrimp > Resend Item for an explicit resend.');
    }
    const attemptNumber = (lastAttempt?.attemptNumber ?? 0) + 1;
    const attemptPayload = explicitResend
      ? { ...payload, external_order_number: `ETSY-${order.etsyReceiptId.toString()}-R${attemptNumber}` }
      : payload;
    const attempt = await tx.printShrimpOrderAttempt.create({
      data: {
        orderId,
        attemptNumber,
        explicitResend,
        status: 'SUBMITTING',
        payload: attemptPayload as Prisma.InputJsonValue,
      },
    });
    await tx.etsyOrder.update({
      where: { id: orderId },
      data: {
        processingStatus: 'PROCESSING',
        printShrimpAttemptedAt: new Date(),
        printShrimpPayload: attemptPayload as Prisma.InputJsonValue,
        processError: null,
      },
    });
    return { attempt, payload: attemptPayload };
  }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
}

async function completeAttempt(
  orderId: number,
  attemptId: number,
  payload: PreparedPrintShrimpOrderPayload,
  explicitResend: boolean,
) {
  try {
    const response = await submitPreparedPrintShrimpOrder(payload);
    const remoteOrder = record(response.order);
    const printShrimpOrderId = text(remoteOrder?.order_id, 191);
    await prisma.$transaction([
      prisma.printShrimpOrderAttempt.update({
        where: { id: attemptId },
        data: { status: 'SUBMITTED', response: jsonValue(response), completedAt: new Date() },
      }),
      prisma.etsyOrder.update({
        where: { id: orderId },
        data: {
          processingStatus: 'SUBMITTED',
          printShrimpSubmittedAt: new Date(),
          printShrimpOrderId,
          printShrimpPayload: payload as Prisma.InputJsonValue,
          printShrimpResponse: jsonValue(response),
          processError: null,
        },
      }),
    ]);
    return { submitted: true, explicitResend, response, details: await getEtsyOrderDetails(String(orderId)) };
  } catch (error) {
    const message = error instanceof Error ? error.message : 'PrintShrimp order submission failed.';
    const unknown = error instanceof PrintShrimpAdapterError && error.transient;
    await prisma.$transaction([
      prisma.printShrimpOrderAttempt.update({
        where: { id: attemptId },
        data: { status: unknown ? 'UNKNOWN' : 'FAILED', error: message, completedAt: new Date() },
      }),
      prisma.etsyOrder.update({
        where: { id: orderId },
        data: { processingStatus: unknown ? 'UNKNOWN' : 'FAILED', processError: message },
      }),
    ]);
    throw new Error(`${message} The automatic workflow will not retry this order; use Resend Item only after checking PrintShrimp.`);
  }
}

export async function processEtsyOrder(orderIdValue: string) {
  const orderId = parseOrderId(orderIdValue);
  const refreshed = await refreshOneOrder(orderId);
  const order = refreshed.order;
  if (!order) throw new Error('Etsy order not found after refreshing it.');
  if (order.processingStatus === 'CANCELED' || order.processingStatus === 'COMPLETED') {
    return {
      submitted: false,
      closed: true,
      message: `The Etsy order is ${order.etsyStatus || order.processingStatus.toLocaleLowerCase()} and was not sent to PrintShrimp.`,
      details: await getEtsyOrderDetails(String(orderId)),
    };
  }
  if (!order.isPaid || normalizedStatus(order.etsyStatus) !== 'paid') {
    return {
      submitted: false,
      closed: true,
      message: `The Etsy order is ${order.etsyStatus || 'not paid'} and is not ready for PrintShrimp.`,
      details: await getEtsyOrderDetails(String(orderId)),
    };
  }
  const { payload, missing } = buildOrderPayload(order);
  if (missing.length > 0) throw new Error(`Complete or correct: ${missing.join(', ')}.`);
  try {
    const writeToken = await getEtsyOrderAccessToken(true);
    await acknowledgeEtsyReceiptForProcessing({
      accessToken: writeToken,
      shopId: order.etsyShopId.toString(),
      receiptId: order.etsyReceiptId.toString(),
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Etsy did not accept the fulfilment update.';
    throw new Error(`${message} Nothing was sent to PrintShrimp.`);
  }
  const { attempt, payload: attemptPayload } = await acquireAttempt(orderId, payload, false);
  return completeAttempt(orderId, attempt.id, attemptPayload, false);
}

export async function searchEtsyOrdersForResend(query: string) {
  const search = query.trim();
  const orders = await prisma.etsyOrder.findMany({
    where: search ? {
      OR: [
        { name: { contains: search } },
        { postcode: { contains: search } },
        { city: { contains: search } },
        { buyerEmail: { contains: search } },
      ],
    } : undefined,
    orderBy: [{ orderedAt: 'desc' }, { id: 'desc' }],
    take: 100,
    include: ORDER_INCLUDE,
  });
  return orders.map((order) => serializeOrder(order)!);
}

export async function resendEtsyOrder(orderIdValue: string, confirmation: string) {
  if (confirmation !== 'RESEND') throw new Error('Confirm the resend before continuing.');
  const orderId = parseOrderId(orderIdValue);
  const refreshed = await refreshOneOrder(orderId);
  const order = refreshed.order;
  if (!order) throw new Error('Etsy order not found.');
  if (order.processingStatus === 'CANCELED') throw new Error('A canceled Etsy order cannot be resent to PrintShrimp.');
  const nextAttempt = (order.attempts.at(-1)?.attemptNumber ?? 0) + 1;
  const { payload, missing } = buildOrderPayload(order, nextAttempt);
  if (missing.length > 0) throw new Error(`Complete or correct: ${missing.join(', ')}.`);
  const acquired = await acquireAttempt(orderId, payload, true);
  return completeAttempt(orderId, acquired.attempt.id, acquired.payload, true);
}

export type EtsyOrdersPageData = Awaited<ReturnType<typeof getEtsyOrdersPageData>>;
export type EtsyOrderDetailsData = Awaited<ReturnType<typeof getEtsyOrderDetails>>;
export type EtsyOrderRow = EtsyOrdersPageData['orders'][number];
