import { randomUUID } from 'node:crypto';

import {
  ACCOUNTING_SYNC_OVERLAP_SECONDS,
  ACCOUNTING_YEAR_START_MONTH,
  ETSY_LEDGER_HISTORY_START_EPOCH_SECONDS,
  SUPPORTED_ACCOUNTING_CURRENCIES,
  type SupportedAccountingCurrency,
} from '@/lib/accounting-config';

export type AccountingEntryType = 'INCOME' | 'EXPENSE';
export type AccountingEntrySource = 'ETSY' | 'MANUAL';

export type DateRange = {
  start: Date;
  endExclusive: Date;
  label: string;
};

export type EtsyMoney = {
  amount?: number | null;
  divisor?: number | null;
  currency_code?: string | null;
} | null | undefined;

export type EtsyReceiptInput = {
  receipt_id?: number | string | null;
  status?: string | null;
  is_paid?: boolean | null;
  is_canceled?: boolean | null;
  was_canceled?: boolean | null;
  create_timestamp?: number | null;
  created_timestamp?: number | null;
  update_timestamp?: number | null;
  updated_timestamp?: number | null;
  grandtotal?: EtsyMoney;
};

export type EtsyLedgerEntryInput = {
  entry_id?: number | string | null;
  amount?: number | null;
  currency?: string | null;
  description?: string | null;
  ledger_type?: string | null;
  reference_type?: string | null;
  reference_id?: string | number | null;
  create_date?: number | null;
  created_timestamp?: number | null;
};

export type MappedFinancialEntry = {
  entryDate: Date;
  type: AccountingEntryType;
  amountMinorUnits: number;
  currencyCode: string;
  description: string;
  category: string;
  source: 'ETSY';
  externalReference: string;
  dedupeKey: string;
};

export type ManualEntryInput = {
  entryDate?: unknown;
  type?: unknown;
  amount?: unknown;
  currencyCode?: unknown;
  category?: unknown;
  description?: unknown;
};

export type ValidatedManualEntry = {
  entryDate: Date;
  type: AccountingEntryType;
  amountMinorUnits: number;
  currencyCode: SupportedAccountingCurrency;
  category: string;
  description: string;
  dedupeKey: string;
};

function roundRatio(numerator: bigint, denominator: bigint) {
  const negative = numerator < 0n;
  const absolute = negative ? -numerator : numerator;
  const rounded = (absolute + denominator / 2n) / denominator;
  return negative ? -rounded : rounded;
}

export function etsyMoneyToMinorUnits(money: EtsyMoney): number | null {
  if (!money || typeof money.amount !== 'number' || typeof money.divisor !== 'number'
    || !Number.isSafeInteger(money.amount) || !Number.isSafeInteger(money.divisor) || money.divisor <= 0) {
    return null;
  }

  const result = roundRatio(BigInt(money.amount) * 100n, BigInt(money.divisor));
  const numeric = Number(result);
  if (!Number.isSafeInteger(numeric)) throw new Error('Etsy monetary amount is outside the supported range.');
  return numeric;
}

export function getMonthDateRange(month: string): DateRange {
  const match = /^(\d{4})-(\d{2})$/.exec(month);
  if (!match) throw new Error('Month must use YYYY-MM format.');
  const year = Number(match[1]);
  const monthNumber = Number(match[2]);
  if (year < 2000 || year > 9999 || monthNumber < 1 || monthNumber > 12) throw new Error('Month is invalid.');
  const start = new Date(Date.UTC(year, monthNumber - 1, 1));
  const endExclusive = new Date(Date.UTC(year, monthNumber, 1));
  const label = new Intl.DateTimeFormat('en-GB', { month: 'long', year: 'numeric', timeZone: 'UTC' }).format(start);
  return { start, endExclusive, label };
}

export function getAccountingYearDateRange(now = new Date(), startMonth = ACCOUNTING_YEAR_START_MONTH): DateRange {
  if (!Number.isInteger(startMonth) || startMonth < 1 || startMonth > 12) throw new Error('Accounting year start month must be between 1 and 12.');
  const currentYear = now.getUTCFullYear();
  const currentMonth = now.getUTCMonth() + 1;
  const startYear = currentMonth < startMonth ? currentYear - 1 : currentYear;
  const start = new Date(Date.UTC(startYear, startMonth - 1, 1));
  const endExclusive = new Date(Date.UTC(startYear + 1, startMonth - 1, 1));
  return { start, endExclusive, label: `${startYear}/${String(startYear + 1).slice(-2)} accounting year` };
}

export function getReceiptCheckpointEpoch(checkpoint: Date | null, overlapSeconds = ACCOUNTING_SYNC_OVERLAP_SECONDS) {
  if (!checkpoint) return null;
  return Math.max(ETSY_LEDGER_HISTORY_START_EPOCH_SECONDS, Math.floor(checkpoint.getTime() / 1000) - overlapSeconds);
}

function epochDate(...values: Array<number | null | undefined>) {
  const seconds = values.find((value) => typeof value === 'number' && Number.isFinite(value) && value > 0);
  return seconds ? new Date(seconds * 1000) : null;
}

export function receiptDedupeKey(shopId: string, receiptId: string) {
  return `etsy:receipt:${shopId}:${receiptId}`;
}

export function ledgerDedupeKey(shopId: string, ledgerEntryId: string) {
  return `etsy:ledger:${shopId}:${ledgerEntryId}`;
}

export function mapReceiptToFinancialEntry(shopId: string, receipt: EtsyReceiptInput): MappedFinancialEntry | null {
  const receiptId = receipt.receipt_id === null || receipt.receipt_id === undefined ? '' : String(receipt.receipt_id);
  const status = receipt.status?.trim().toLowerCase() ?? '';
  const canceled = receipt.is_canceled === true || receipt.was_canceled === true || status.includes('cancel');
  const paid = receipt.is_paid === true || status === 'paid' || status === 'completed';
  const amountMinorUnits = etsyMoneyToMinorUnits(receipt.grandtotal);
  const entryDate = epochDate(receipt.created_timestamp, receipt.create_timestamp);
  const currencyCode = receipt.grandtotal?.currency_code?.trim().toUpperCase();
  if (!receiptId || canceled || !paid || !entryDate || !currencyCode || !amountMinorUnits || amountMinorUnits <= 0) return null;

  return {
    entryDate,
    type: 'INCOME',
    amountMinorUnits,
    currencyCode,
    description: `Etsy sale receipt #${receiptId}`,
    category: 'Etsy sales',
    source: 'ETSY',
    externalReference: receiptId,
    dedupeKey: receiptDedupeKey(shopId, receiptId),
  };
}

// Reporting policy: receipts are the only source of sale revenue. Ledger rows
// representing payments, deposits and disbursements are retained in the raw
// ledger table but skipped here, so moving the same money cannot count as a
// second sale. Fees, taxes, refunds and explicit account adjustments are
// reported according to the sign of Etsy's ledger amount.
function normalizedLedgerText(entry: EtsyLedgerEntryInput) {
  return [entry.ledger_type, entry.reference_type, entry.description]
    .filter((value): value is string => typeof value === 'string')
    .join(' ')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

function signedAdjustment(entry: EtsyLedgerEntryInput, category: string): Omit<MappedFinancialEntry, 'entryDate' | 'currencyCode' | 'description' | 'externalReference' | 'dedupeKey'> | null {
  const amount = entry.amount;
  if (typeof amount !== 'number' || !Number.isSafeInteger(amount) || amount === 0) return null;
  return {
    type: amount > 0 ? 'INCOME' : 'EXPENSE',
    amountMinorUnits: Math.abs(amount),
    category,
    source: 'ETSY',
  };
}

export function classifyEtsyLedgerEntry(shopId: string, entry: EtsyLedgerEntryInput): MappedFinancialEntry | null {
  const entryId = entry.entry_id === null || entry.entry_id === undefined ? '' : String(entry.entry_id);
  const entryDate = epochDate(entry.created_timestamp, entry.create_date);
  const currencyCode = entry.currency?.trim().toUpperCase();
  if (!entryId || !entryDate || !currencyCode) return null;
  const text = normalizedLedgerText(entry);
  let mapped: ReturnType<typeof signedAdjustment> = null;

  if (/refund/.test(text)) mapped = signedAdjustment(entry, 'Etsy refunds');
  else if (/tax|vat/.test(text)) mapped = signedAdjustment(entry, 'Etsy taxes');
  else if (/fee|listing charge|offsite ads|etsy ads|advertis|marketing|promoted listing|shipping label|seller service|processing/.test(text)) mapped = signedAdjustment(entry, 'Etsy fees');
  else if (/miscellaneous debit|miscellaneous credit|recoupment|adjustment|reversal/.test(text)) mapped = signedAdjustment(entry, 'Etsy adjustments');
  else if (/payment|sale|deposit|disbursement|payout|bill payment/.test(text)) return null;
  else return null;

  if (!mapped) return null;
  return {
    ...mapped,
    entryDate,
    currencyCode,
    description: entry.description?.trim() || entry.ledger_type?.trim() || `Etsy ledger entry #${entryId}`,
    externalReference: entry.reference_id === null || entry.reference_id === undefined ? entryId : String(entry.reference_id),
    dedupeKey: ledgerDedupeKey(shopId, entryId),
  };
}

export function parseMajorAmountToMinorUnits(value: string) {
  const match = /^(\d+)(?:\.(\d{1,2}))?$/.exec(value.trim());
  if (!match) return null;
  const units = BigInt(match[1]);
  const decimals = BigInt((match[2] ?? '').padEnd(2, '0') || '0');
  const amount = units * 100n + decimals;
  if (amount <= 0n || amount > BigInt(Number.MAX_SAFE_INTEGER)) return null;
  return Number(amount);
}

export function validateManualEntry(input: ManualEntryInput): ValidatedManualEntry {
  const dateText = typeof input.entryDate === 'string' ? input.entryDate.trim() : '';
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dateText)) throw new Error('Enter a valid date in YYYY-MM-DD format.');
  const entryDate = new Date(`${dateText}T00:00:00.000Z`);
  if (Number.isNaN(entryDate.getTime()) || entryDate.toISOString().slice(0, 10) !== dateText) throw new Error('Enter a valid calendar date.');
  if (input.type !== 'INCOME' && input.type !== 'EXPENSE') throw new Error('Entry type must be income or expense.');
  const amountMinorUnits = parseMajorAmountToMinorUnits(typeof input.amount === 'string' ? input.amount : '');
  if (!amountMinorUnits) throw new Error('Amount must be positive and have no more than two decimal places.');
  const currencyCode = typeof input.currencyCode === 'string' ? input.currencyCode.trim().toUpperCase() : '';
  if (!SUPPORTED_ACCOUNTING_CURRENCIES.includes(currencyCode as SupportedAccountingCurrency)) throw new Error('Choose a supported currency.');
  const category = typeof input.category === 'string' ? input.category.trim() : '';
  const description = typeof input.description === 'string' ? input.description.trim() : '';
  if (!category || category.length > 100) throw new Error('Category is required and must be 100 characters or fewer.');
  if (!description || description.length > 500) throw new Error('Description is required and must be 500 characters or fewer.');
  return {
    entryDate,
    type: input.type,
    amountMinorUnits,
    currencyCode: currencyCode as SupportedAccountingCurrency,
    category,
    description,
    dedupeKey: `manual:${randomUUID()}`,
  };
}

export function summarizeEntries(entries: Array<{ type: AccountingEntryType; amountMinorUnits: number; currencyCode: string }>) {
  const byCurrency = new Map<string, { currencyCode: string; incomeMinorUnits: number; expenseMinorUnits: number; netMinorUnits: number; entryCount: number }>();
  for (const entry of entries) {
    const summary = byCurrency.get(entry.currencyCode) ?? {
      currencyCode: entry.currencyCode,
      incomeMinorUnits: 0,
      expenseMinorUnits: 0,
      netMinorUnits: 0,
      entryCount: 0,
    };
    if (entry.type === 'INCOME') summary.incomeMinorUnits += entry.amountMinorUnits;
    else summary.expenseMinorUnits += entry.amountMinorUnits;
    summary.netMinorUnits = summary.incomeMinorUnits - summary.expenseMinorUnits;
    summary.entryCount += 1;
    byCurrency.set(entry.currencyCode, summary);
  }
  return [...byCurrency.values()].sort((a, b) => a.currencyCode.localeCompare(b.currencyCode));
}
