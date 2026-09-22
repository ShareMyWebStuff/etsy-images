import { getEtsyKeystring } from '@/lib/etsy-oauth';
import type { EtsyLedgerEntryInput, EtsyMoney, EtsyReceiptInput } from '@/lib/accounting-core';

export type EtsyTransactionResponse = {
  transaction_id?: number | string | null;
  receipt_id?: number | string | null;
  listing_id?: number | string | null;
  title?: string | null;
  quantity?: number | null;
  price?: EtsyMoney;
  create_timestamp?: number | null;
  created_timestamp?: number | null;
  paid_timestamp?: number | null;
  [key: string]: unknown;
};

export type EtsyReceiptResponse = EtsyReceiptInput & {
  transactions?: EtsyTransactionResponse[] | null;
  [key: string]: unknown;
};

export type EtsyLedgerEntryResponse = EtsyLedgerEntryInput & {
  ledger_id?: number | string | null;
  sequence_number?: number | null;
  balance?: number | null;
  parent_entry_id?: number | string | null;
  [key: string]: unknown;
};

type EtsyPage<T> = { count?: number; results?: T[] };
type PageLoader<T> = (offset: number, limit: number) => Promise<EtsyPage<T>>;

const PAGE_SIZE = 100;
export const ETSY_LEDGER_MAX_WINDOW_SECONDS = 2_678_400;

export function getEtsyLedgerDateWindows(minCreated: number, maxCreated: number) {
  if (!Number.isSafeInteger(minCreated) || !Number.isSafeInteger(maxCreated) || minCreated > maxCreated) {
    throw new Error('Invalid Etsy ledger date range.');
  }

  const windows: Array<{ minCreated: number; maxCreated: number }> = [];
  let windowStart = minCreated;

  while (windowStart <= maxCreated) {
    const windowEnd = Math.min(windowStart + ETSY_LEDGER_MAX_WINDOW_SECONDS, maxCreated);
    windows.push({ minCreated: windowStart, maxCreated: windowEnd });
    if (windowEnd === maxCreated) break;
    windowStart = windowEnd + 1;
  }

  return windows;
}

function getEtsyApiKeyHeader() {
  const sharedSecret = process.env.ETSY_SHARED_SECRET;
  if (!sharedSecret) throw new Error('Missing ETSY_SHARED_SECRET environment variable.');
  return `${getEtsyKeystring()}:${sharedSecret}`;
}

async function fetchEtsyAccountingJson<T>(path: string, accessToken: string): Promise<T> {
  const response = await fetch(`https://openapi.etsy.com/v3/application${path}`, {
    signal: AbortSignal.timeout(30_000),
    headers: {
      Accept: 'application/json',
      Authorization: `Bearer ${accessToken}`,
      'x-api-key': getEtsyApiKeyHeader(),
    },
  });
  const responseText = await response.text();
  if (!response.ok) {
    const scopeHint = response.status === 403
      ? ' Reconnect Etsy from Admin > Accounts and approve transaction access.'
      : '';
    throw new Error(`Etsy accounting API returned ${response.status} ${response.statusText}${responseText ? `: ${responseText}` : ''}${scopeHint}`);
  }
  return JSON.parse(responseText) as T;
}

export async function fetchAllEtsyPages<T>(loadPage: PageLoader<T>, limit = PAGE_SIZE) {
  const all: T[] = [];
  for (let offset = 0; ; offset += limit) {
    const page = await loadPage(offset, limit);
    const results = Array.isArray(page.results) ? page.results : [];
    all.push(...results);
    if (results.length === 0 || results.length < limit || (typeof page.count === 'number' && all.length >= page.count)) break;
  }
  return all;
}

export async function getEtsyReceipts(params: {
  accessToken: string;
  shopId: string;
  minCreated?: number | null;
  maxCreated?: number | null;
  minLastModified?: number | null;
  maxLastModified?: number | null;
}) {
  return fetchAllEtsyPages<EtsyReceiptResponse>(async (offset, limit) => {
    const query = new URLSearchParams({ limit: String(limit), offset: String(offset) });
    if (params.minCreated !== null && params.minCreated !== undefined) query.set('min_created', String(params.minCreated));
    if (params.maxCreated !== null && params.maxCreated !== undefined) query.set('max_created', String(params.maxCreated));
    if (params.minLastModified !== null && params.minLastModified !== undefined) query.set('min_last_modified', String(params.minLastModified));
    if (params.maxLastModified !== null && params.maxLastModified !== undefined) query.set('max_last_modified', String(params.maxLastModified));
    return fetchEtsyAccountingJson<EtsyPage<EtsyReceiptResponse>>(
      `/shops/${encodeURIComponent(params.shopId)}/receipts?${query}`,
      params.accessToken,
    );
  });
}

export async function getEtsyReceiptTransactions(params: { accessToken: string; shopId: string; receiptId: string }) {
  const payload = await fetchEtsyAccountingJson<EtsyPage<EtsyTransactionResponse>>(
    `/shops/${encodeURIComponent(params.shopId)}/receipts/${encodeURIComponent(params.receiptId)}/transactions`,
    params.accessToken,
  );
  return Array.isArray(payload.results) ? payload.results : [];
}

export async function* getEtsyLedgerEntryWindows(params: {
  accessToken: string;
  shopId: string;
  minCreated: number;
  maxCreated: number;
}) {
  for (const window of getEtsyLedgerDateWindows(params.minCreated, params.maxCreated)) {
    yield await fetchAllEtsyPages<EtsyLedgerEntryResponse>(async (offset, limit) => {
      const query = new URLSearchParams({
        min_created: String(window.minCreated),
        max_created: String(window.maxCreated),
        limit: String(limit),
        offset: String(offset),
      });
      return fetchEtsyAccountingJson<EtsyPage<EtsyLedgerEntryResponse>>(
        `/shops/${encodeURIComponent(params.shopId)}/payment-account/ledger-entries?${query}`,
        params.accessToken,
      );
    });
  }
}

export async function getEtsyLedgerEntries(params: {
  accessToken: string;
  shopId: string;
  minCreated: number;
  maxCreated: number;
}) {
  const entries: EtsyLedgerEntryResponse[] = [];
  for await (const windowEntries of getEtsyLedgerEntryWindows(params)) entries.push(...windowEntries);
  return entries;
}
