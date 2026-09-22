import { Prisma } from '@prisma/client';

import {
  classifyEtsyLedgerEntry,
  getReceiptCheckpointEpoch,
  mapReceiptToFinancialEntry,
} from '@/lib/accounting-core';
import {
  ACCOUNTING_SYNC_OVERLAP_SECONDS,
  getEtsyAccountingHistoryStartEpochSeconds,
} from '@/lib/accounting-config';
import {
  getEtsyLedgerEntryWindows,
  getEtsyReceiptTransactions,
  getEtsyReceipts,
  type EtsyLedgerEntryResponse,
  type EtsyReceiptResponse,
  type EtsyTransactionResponse,
} from '@/lib/etsy-accounting-api';
import { getEtsyAccountingAccessToken } from '@/lib/etsy-oauth';
import { prisma } from '@/lib/prisma';

export type EtsyAccountingSyncSummary = {
  shopsSynced: number;
  receiptsImported: number;
  transactionsImported: number;
  ledgerEntriesImported: number;
  financialEntriesCreated: number;
  financialEntriesUpdated: number;
  skippedRecords: number;
  fullHistoryImported: boolean;
};

export class AccountingSyncInProgressError extends Error {}

function emptySummary(): EtsyAccountingSyncSummary {
  return {
    shopsSynced: 0,
    receiptsImported: 0,
    transactionsImported: 0,
    ledgerEntriesImported: 0,
    financialEntriesCreated: 0,
    financialEntriesUpdated: 0,
    skippedRecords: 0,
    fullHistoryImported: false,
  };
}

function toRawJson(value: unknown) {
  return JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue;
}

function toBigInt(value: number | string | bigint | null | undefined) {
  if (value === null || value === undefined || value === '') return null;
  try {
    return BigInt(value);
  } catch {
    return null;
  }
}

function epochDate(...values: Array<number | null | undefined>) {
  const seconds = values.find((value) => typeof value === 'number' && Number.isFinite(value) && value > 0);
  return seconds ? new Date(seconds * 1000) : null;
}

function truncate(value: string | null | undefined, max: number) {
  const normalized = value?.trim();
  return normalized ? normalized.slice(0, max) : null;
}

async function persistReceipt(
  shopId: bigint,
  receipt: EtsyReceiptResponse,
  transactions: EtsyTransactionResponse[],
  summary: EtsyAccountingSyncSummary,
) {
  const etsyReceiptId = toBigInt(receipt.receipt_id);
  if (etsyReceiptId === null) {
    summary.skippedRecords += 1;
    return;
  }
  const shopIdText = shopId.toString();
  const receiptIdText = etsyReceiptId.toString();
  const status = truncate(receipt.status, 50);
  const isCanceled = receipt.is_canceled === true || receipt.was_canceled === true || Boolean(status?.toLowerCase().includes('cancel'));
  const amount = receipt.grandtotal?.amount;
  const divisor = receipt.grandtotal?.divisor;
  const currencyCode = truncate(receipt.grandtotal?.currency_code?.toUpperCase(), 3);
  const mapped = mapReceiptToFinancialEntry(shopIdText, receipt);

  await prisma.$transaction(async (tx) => {
    const savedReceipt = await tx.etsyReceipt.upsert({
      where: { etsyShopId_etsyReceiptId: { etsyShopId: shopId, etsyReceiptId } },
      create: {
        etsyShopId: shopId,
        etsyReceiptId,
        status,
        isPaid: receipt.is_paid ?? null,
        isCanceled,
        grandTotalAmount: typeof amount === 'number' && Number.isSafeInteger(amount) ? amount : null,
        grandTotalDivisor: typeof divisor === 'number' && Number.isSafeInteger(divisor) ? divisor : null,
        currencyCode,
        createdAtEtsy: epochDate(receipt.created_timestamp, receipt.create_timestamp),
        updatedAtEtsy: epochDate(receipt.updated_timestamp, receipt.update_timestamp),
        rawJson: toRawJson(receipt),
      },
      update: {
        status,
        isPaid: receipt.is_paid ?? null,
        isCanceled,
        grandTotalAmount: typeof amount === 'number' && Number.isSafeInteger(amount) ? amount : null,
        grandTotalDivisor: typeof divisor === 'number' && Number.isSafeInteger(divisor) ? divisor : null,
        currencyCode,
        createdAtEtsy: epochDate(receipt.created_timestamp, receipt.create_timestamp),
        updatedAtEtsy: epochDate(receipt.updated_timestamp, receipt.update_timestamp),
        rawJson: toRawJson(receipt),
      },
      select: { id: true, financialEntryId: true },
    });

    if (mapped) {
      const existing = await tx.financialEntry.findUnique({ where: { dedupeKey: mapped.dedupeKey }, select: { id: true } });
      const financialEntry = await tx.financialEntry.upsert({
        where: { dedupeKey: mapped.dedupeKey },
        create: {
          ...mapped,
          etsyShopId: shopId,
          etsyReceiptId,
          rawJson: toRawJson(receipt),
        },
        update: {
          entryDate: mapped.entryDate,
          type: mapped.type,
          amountMinorUnits: mapped.amountMinorUnits,
          currencyCode: mapped.currencyCode,
          description: mapped.description,
          category: mapped.category,
          source: mapped.source,
          etsyShopId: shopId,
          etsyReceiptId,
          externalReference: mapped.externalReference,
          rawJson: toRawJson(receipt),
        },
        select: { id: true },
      });
      await tx.etsyReceipt.update({ where: { id: savedReceipt.id }, data: { financialEntryId: financialEntry.id } });
      if (existing) summary.financialEntriesUpdated += 1;
      else summary.financialEntriesCreated += 1;
    } else if (savedReceipt.financialEntryId !== null) {
      await tx.financialEntry.delete({ where: { id: savedReceipt.financialEntryId } });
      summary.financialEntriesUpdated += 1;
    } else {
      summary.skippedRecords += 1;
    }

    for (const transaction of transactions) {
      const etsyTransactionId = toBigInt(transaction.transaction_id);
      if (etsyTransactionId === null) {
        summary.skippedRecords += 1;
        continue;
      }
      const price = transaction.price;
      const transactionData = {
        receiptId: savedReceipt.id,
        etsyReceiptId,
        etsyListingId: toBigInt(transaction.listing_id),
        title: truncate(transaction.title, 500),
        quantity: typeof transaction.quantity === 'number' && Number.isSafeInteger(transaction.quantity) ? transaction.quantity : null,
        priceAmount: price && typeof price.amount === 'number' && Number.isSafeInteger(price.amount) ? price.amount : null,
        priceDivisor: price && typeof price.divisor === 'number' && Number.isSafeInteger(price.divisor) ? price.divisor : null,
        currencyCode: truncate(price?.currency_code?.toUpperCase(), 3),
        createdAtEtsy: epochDate(transaction.created_timestamp, transaction.create_timestamp),
        paidAtEtsy: epochDate(transaction.paid_timestamp),
        rawJson: toRawJson(transaction),
      };
      await tx.etsyTransaction.upsert({
        where: { etsyShopId_etsyTransactionId: { etsyShopId: shopId, etsyTransactionId } },
        create: { etsyShopId: shopId, etsyTransactionId, ...transactionData },
        update: transactionData,
      });
      summary.transactionsImported += 1;
    }
  });
  summary.receiptsImported += 1;
}

async function persistLedgerEntry(shopId: bigint, entry: EtsyLedgerEntryResponse, summary: EtsyAccountingSyncSummary) {
  const etsyLedgerEntryId = toBigInt(entry.entry_id);
  if (etsyLedgerEntryId === null) {
    summary.skippedRecords += 1;
    return;
  }
  const mapped = classifyEtsyLedgerEntry(shopId.toString(), entry);
  const amount = typeof entry.amount === 'number' && Number.isSafeInteger(entry.amount) ? entry.amount : null;
  const saved = await prisma.$transaction(async (tx) => {
    const ledgerEntry = await tx.etsyPaymentLedgerEntry.upsert({
      where: { etsyShopId_etsyLedgerEntryId: { etsyShopId: shopId, etsyLedgerEntryId } },
      create: {
        etsyShopId: shopId,
        etsyLedgerEntryId,
        etsyLedgerId: toBigInt(entry.ledger_id),
        sequenceNumber: typeof entry.sequence_number === 'number' && Number.isSafeInteger(entry.sequence_number) ? entry.sequence_number : null,
        amountMinorUnits: amount,
        currencyCode: truncate(entry.currency?.toUpperCase(), 3),
        balanceMinorUnits: typeof entry.balance === 'number' && Number.isSafeInteger(entry.balance) ? entry.balance : null,
        description: truncate(entry.description, 500),
        ledgerType: truncate(entry.ledger_type, 100),
        referenceType: truncate(entry.reference_type, 100),
        referenceId: truncate(entry.reference_id === null || entry.reference_id === undefined ? null : String(entry.reference_id), 191),
        parentEntryId: toBigInt(entry.parent_entry_id),
        createdAtEtsy: epochDate(entry.created_timestamp, entry.create_date),
        rawJson: toRawJson(entry),
      },
      update: {
        etsyLedgerId: toBigInt(entry.ledger_id),
        sequenceNumber: typeof entry.sequence_number === 'number' && Number.isSafeInteger(entry.sequence_number) ? entry.sequence_number : null,
        amountMinorUnits: amount,
        currencyCode: truncate(entry.currency?.toUpperCase(), 3),
        balanceMinorUnits: typeof entry.balance === 'number' && Number.isSafeInteger(entry.balance) ? entry.balance : null,
        description: truncate(entry.description, 500),
        ledgerType: truncate(entry.ledger_type, 100),
        referenceType: truncate(entry.reference_type, 100),
        referenceId: truncate(entry.reference_id === null || entry.reference_id === undefined ? null : String(entry.reference_id), 191),
        parentEntryId: toBigInt(entry.parent_entry_id),
        createdAtEtsy: epochDate(entry.created_timestamp, entry.create_date),
        rawJson: toRawJson(entry),
      },
      select: { id: true, financialEntryId: true },
    });
    if (mapped) {
      const existing = await tx.financialEntry.findUnique({ where: { dedupeKey: mapped.dedupeKey }, select: { id: true } });
      const financialEntry = await tx.financialEntry.upsert({
        where: { dedupeKey: mapped.dedupeKey },
        create: {
          ...mapped,
          etsyShopId: shopId,
          etsyLedgerEntryId,
          rawJson: toRawJson(entry),
        },
        update: {
          entryDate: mapped.entryDate,
          type: mapped.type,
          amountMinorUnits: mapped.amountMinorUnits,
          currencyCode: mapped.currencyCode,
          description: mapped.description,
          category: mapped.category,
          source: mapped.source,
          etsyShopId: shopId,
          etsyLedgerEntryId,
          externalReference: mapped.externalReference,
          rawJson: toRawJson(entry),
        },
        select: { id: true },
      });
      await tx.etsyPaymentLedgerEntry.update({ where: { id: ledgerEntry.id }, data: { financialEntryId: financialEntry.id } });
      return existing ? 'updated' as const : 'created' as const;
    }
    if (ledgerEntry.financialEntryId !== null) {
      await tx.financialEntry.delete({ where: { id: ledgerEntry.financialEntryId } });
      return 'updated' as const;
    }
    return 'skipped' as const;
  });
  if (saved === 'created') summary.financialEntriesCreated += 1;
  else if (saved === 'updated') summary.financialEntriesUpdated += 1;
  else summary.skippedRecords += 1;
  summary.ledgerEntriesImported += 1;
}

async function acquireSyncLock(etsyShopId: bigint) {
  await prisma.etsyAccountingSyncState.upsert({
    where: { etsyShopId },
    create: { etsyShopId, overlapSeconds: ACCOUNTING_SYNC_OVERLAP_SECONDS },
    update: {},
  });
  const staleBefore = new Date(Date.now() - 10 * 60 * 1000);
  const result = await prisma.etsyAccountingSyncState.updateMany({
    where: {
      etsyShopId,
      OR: [{ status: { not: 'RUNNING' } }, { syncStartedAt: { lt: staleBefore } }],
    },
    data: { status: 'RUNNING', syncStartedAt: new Date(), lastError: null },
  });
  if (result.count !== 1) throw new AccountingSyncInProgressError('An Etsy accounts sync is already running for this shop.');
}

async function syncShopAccounting(accessToken: string, etsyShopId: bigint) {
  await acquireSyncLock(etsyShopId);
  const summary = emptySummary();
  const syncThrough = new Date();
  try {
    const state = await prisma.etsyAccountingSyncState.findUniqueOrThrow({ where: { etsyShopId } });
    const fullHistory = !state.fullSyncCompleted;
    const maxEpoch = Math.floor(syncThrough.getTime() / 1000);
    const historyStart = getEtsyAccountingHistoryStartEpochSeconds(syncThrough);
    const receiptMinimum = fullHistory ? null : getReceiptCheckpointEpoch(state.lastSuccessfulReceiptSyncAt, state.overlapSeconds);
    const ledgerMinimum = fullHistory
      ? historyStart
      : getReceiptCheckpointEpoch(state.lastSuccessfulLedgerSyncAt, state.overlapSeconds) ?? historyStart;
    const shopId = etsyShopId.toString();
    const receipts = await getEtsyReceipts({
      accessToken,
      shopId,
      minCreated: fullHistory ? historyStart : null,
      maxCreated: fullHistory ? maxEpoch : null,
      minLastModified: receiptMinimum,
      maxLastModified: fullHistory ? null : maxEpoch,
    });
    for (const receipt of receipts) {
      const receiptId = toBigInt(receipt.receipt_id);
      if (receiptId === null) {
        summary.skippedRecords += 1;
        continue;
      }
      const transactions = Array.isArray(receipt.transactions)
        ? receipt.transactions
        : await getEtsyReceiptTransactions({ accessToken, shopId, receiptId: receiptId.toString() });
      await persistReceipt(etsyShopId, receipt, transactions, summary);
    }

    const ledgerWindows = getEtsyLedgerEntryWindows({
      accessToken,
      shopId,
      minCreated: ledgerMinimum,
      maxCreated: maxEpoch,
    });
    for await (const ledgerEntries of ledgerWindows) {
      for (const entry of ledgerEntries) await persistLedgerEntry(etsyShopId, entry, summary);
    }

    await prisma.etsyAccountingSyncState.update({
      where: { etsyShopId },
      data: {
        fullSyncCompleted: true,
        lastSuccessfulReceiptSyncAt: syncThrough,
        lastSuccessfulLedgerSyncAt: syncThrough,
        lastSuccessfulSyncAt: syncThrough,
        status: 'IDLE',
        syncStartedAt: null,
        lastError: null,
      },
    });
    summary.shopsSynced = 1;
    summary.fullHistoryImported = fullHistory;
    return summary;
  } catch (error) {
    await prisma.etsyAccountingSyncState.update({
      where: { etsyShopId },
      data: {
        status: 'FAILED',
        syncStartedAt: null,
        lastError: error instanceof Error ? error.message : 'Unknown Etsy accounting sync error.',
      },
    });
    throw error;
  }
}

export async function syncAllEtsyAccounting(): Promise<EtsyAccountingSyncSummary> {
  const accessToken = await getEtsyAccountingAccessToken();
  const shops = await prisma.etsyShop.findMany({ orderBy: { etsyShopId: 'asc' }, select: { etsyShopId: true } });
  if (shops.length === 0) throw new Error('Sync Etsy shops before importing accounts data.');
  const total = emptySummary();
  let anyFullHistory = false;
  for (const shop of shops) {
    const result = await syncShopAccounting(accessToken, shop.etsyShopId);
    total.shopsSynced += result.shopsSynced;
    total.receiptsImported += result.receiptsImported;
    total.transactionsImported += result.transactionsImported;
    total.ledgerEntriesImported += result.ledgerEntriesImported;
    total.financialEntriesCreated += result.financialEntriesCreated;
    total.financialEntriesUpdated += result.financialEntriesUpdated;
    total.skippedRecords += result.skippedRecords;
    anyFullHistory ||= result.fullHistoryImported;
  }
  total.fullHistoryImported = anyFullHistory;
  return total;
}
