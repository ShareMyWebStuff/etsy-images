import type { Prisma } from '@prisma/client';

import { ACCOUNTING_YEAR_START_MONTH, SUPPORTED_ACCOUNTING_CURRENCIES } from '@/lib/accounting-config';
import {
  getAccountingYearDateRange,
  getMonthDateRange,
  validateManualEntry,
  type ManualEntryInput,
} from '@/lib/accounting-core';
import { getEtsyOAuthConnectionStatus } from '@/lib/etsy-oauth';
import { prisma } from '@/lib/prisma';

export type AccountsFilters = {
  view: 'month' | 'accounting-year';
  month: string;
  type: 'ALL' | 'INCOME' | 'EXPENSE';
  source: 'ALL' | 'ETSY' | 'MANUAL';
  category: string;
  page: number;
};

export type AccountsPageData = {
  filters: AccountsFilters;
  period: { start: string; endExclusive: string; label: string };
  currentAccountingYear: { start: string; endExclusive: string; label: string };
  accountingYearStartMonth: number;
  supportedCurrencies: readonly string[];
  summary: Array<{
    currencyCode: string;
    incomeMinorUnits: number;
    expenseMinorUnits: number;
    netMinorUnits: number;
    entryCount: number;
  }>;
  entryCount: number;
  categories: string[];
  categoryTotals: Array<{
    category: string;
    currencyCode: string;
    incomeMinorUnits: number;
    expenseMinorUnits: number;
    netMinorUnits: number;
    entryCount: number;
  }>;
  entries: Array<{
    id: string;
    entryDate: string;
    type: 'INCOME' | 'EXPENSE';
    amountMinorUnits: number;
    currencyCode: string;
    description: string;
    category: string;
    source: 'ETSY' | 'MANUAL';
    externalReference: string | null;
  }>;
  pagination: { page: number; pageSize: number; pageCount: number };
  shops: Array<{
    etsyShopId: string;
    shopName: string;
    fullSyncCompleted: boolean;
    status: 'IDLE' | 'RUNNING' | 'FAILED';
    lastSuccessfulSyncAt: string | null;
    lastError: string | null;
  }>;
  etsyAuthorization: {
    connected: boolean;
    hasTransactionsScope: boolean;
    reconnectUrl: string;
  };
  dateInterpretation: string;
};

const PAGE_SIZE = 100;

function currentMonth(now: Date) {
  return `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, '0')}`;
}

export function parseAccountsFilters(input: Record<string, string | null | undefined>, now = new Date()): AccountsFilters {
  const view = input.view === 'accounting-year' ? 'accounting-year' : 'month';
  const month = input.month?.trim() || currentMonth(now);
  getMonthDateRange(month);
  const type = input.type?.toUpperCase() || 'ALL';
  if (!['ALL', 'INCOME', 'EXPENSE'].includes(type)) throw new Error('Invalid entry type filter.');
  const source = input.source?.toUpperCase() || 'ALL';
  if (!['ALL', 'ETSY', 'MANUAL'].includes(source)) throw new Error('Invalid entry source filter.');
  const category = input.category?.trim() ?? '';
  if (category.length > 100) throw new Error('Category filter is too long.');
  const page = input.page ? Number(input.page) : 1;
  if (!Number.isInteger(page) || page < 1) throw new Error('Page must be a positive integer.');
  return {
    view,
    month,
    type: type as AccountsFilters['type'],
    source: source as AccountsFilters['source'],
    category,
    page,
  };
}

function periodJson(period: { start: Date; endExclusive: Date; label: string }) {
  return { start: period.start.toISOString(), endExclusive: period.endExclusive.toISOString(), label: period.label };
}

export async function getAccountsData(
  query: Record<string, string | null | undefined> = {},
  now = new Date(),
): Promise<AccountsPageData> {
  const filters = parseAccountsFilters(query, now);
  const currentAccountingYear = getAccountingYearDateRange(now);
  const period = filters.view === 'accounting-year' ? currentAccountingYear : getMonthDateRange(filters.month);
  const where: Prisma.FinancialEntryWhereInput = {
    entryDate: { gte: period.start, lt: period.endExclusive },
    ...(filters.type === 'ALL' ? {} : { type: filters.type }),
    ...(filters.source === 'ALL' ? {} : { source: filters.source }),
    ...(filters.category ? { category: filters.category } : {}),
  };

  const [summaryRows, categoryRows, entryCount, entries, categoryOptions, shops, etsyAuthorization] = await Promise.all([
    prisma.financialEntry.groupBy({
      by: ['type', 'currencyCode'],
      where,
      _sum: { amountMinorUnits: true },
      _count: { _all: true },
    }),
    prisma.financialEntry.groupBy({
      by: ['category', 'currencyCode', 'type'],
      where,
      _sum: { amountMinorUnits: true },
      _count: { _all: true },
      orderBy: [{ category: 'asc' }, { currencyCode: 'asc' }],
    }),
    prisma.financialEntry.count({ where }),
    prisma.financialEntry.findMany({
      where,
      orderBy: [{ entryDate: 'desc' }, { id: 'desc' }],
      skip: (filters.page - 1) * PAGE_SIZE,
      take: PAGE_SIZE,
    }),
    prisma.financialEntry.findMany({ distinct: ['category'], select: { category: true }, orderBy: { category: 'asc' } }),
    prisma.etsyShop.findMany({
      orderBy: { etsyShopId: 'asc' },
      select: { etsyShopId: true, shopName: true, title: true, accountingSyncState: true },
    }),
    getEtsyOAuthConnectionStatus(),
  ]);

  const summaryMap = new Map<string, AccountsPageData['summary'][number]>();
  for (const row of summaryRows) {
    const summary = summaryMap.get(row.currencyCode) ?? {
      currencyCode: row.currencyCode,
      incomeMinorUnits: 0,
      expenseMinorUnits: 0,
      netMinorUnits: 0,
      entryCount: 0,
    };
    if (row.type === 'INCOME') summary.incomeMinorUnits += row._sum.amountMinorUnits ?? 0;
    else summary.expenseMinorUnits += row._sum.amountMinorUnits ?? 0;
    summary.netMinorUnits = summary.incomeMinorUnits - summary.expenseMinorUnits;
    summary.entryCount += row._count._all;
    summaryMap.set(row.currencyCode, summary);
  }

  const categoryMap = new Map<string, AccountsPageData['categoryTotals'][number]>();
  for (const row of categoryRows) {
    const key = `${row.category}\u0000${row.currencyCode}`;
    const total = categoryMap.get(key) ?? {
      category: row.category,
      currencyCode: row.currencyCode,
      incomeMinorUnits: 0,
      expenseMinorUnits: 0,
      netMinorUnits: 0,
      entryCount: 0,
    };
    if (row.type === 'INCOME') total.incomeMinorUnits += row._sum.amountMinorUnits ?? 0;
    else total.expenseMinorUnits += row._sum.amountMinorUnits ?? 0;
    total.netMinorUnits = total.incomeMinorUnits - total.expenseMinorUnits;
    total.entryCount += row._count._all;
    categoryMap.set(key, total);
  }

  return {
    filters,
    period: periodJson(period),
    currentAccountingYear: periodJson(currentAccountingYear),
    accountingYearStartMonth: ACCOUNTING_YEAR_START_MONTH,
    supportedCurrencies: SUPPORTED_ACCOUNTING_CURRENCIES,
    summary: [...summaryMap.values()].sort((a, b) => a.currencyCode.localeCompare(b.currencyCode)),
    entryCount,
    categories: categoryOptions.map((item) => item.category),
    categoryTotals: [...categoryMap.values()],
    entries: entries.map((entry) => ({
      id: String(entry.id),
      entryDate: entry.entryDate.toISOString(),
      type: entry.type,
      amountMinorUnits: entry.amountMinorUnits,
      currencyCode: entry.currencyCode,
      description: entry.description,
      category: entry.category,
      source: entry.source,
      externalReference: entry.externalReference,
    })),
    pagination: {
      page: filters.page,
      pageSize: PAGE_SIZE,
      pageCount: Math.max(1, Math.ceil(entryCount / PAGE_SIZE)),
    },
    shops: shops.map((shop) => ({
      etsyShopId: shop.etsyShopId.toString(),
      shopName: shop.shopName ?? shop.title ?? `Shop ${shop.etsyShopId}`,
      fullSyncCompleted: shop.accountingSyncState?.fullSyncCompleted ?? false,
      status: shop.accountingSyncState?.status ?? 'IDLE',
      lastSuccessfulSyncAt: shop.accountingSyncState?.lastSuccessfulSyncAt?.toISOString() ?? null,
      lastError: shop.accountingSyncState?.lastError ?? null,
    })),
    etsyAuthorization: {
      connected: etsyAuthorization.connected,
      hasTransactionsScope: etsyAuthorization.hasTransactionsScope,
      reconnectUrl: '/api/etsy/connect?returnTo=/admin/accounts',
    },
    dateInterpretation: 'Entry dates and report boundaries use UTC. The end date is exclusive.',
  };
}

export async function createManualFinancialEntry(input: ManualEntryInput) {
  const entry = validateManualEntry(input);
  const saved = await prisma.financialEntry.create({
    data: {
      ...entry,
      source: 'MANUAL',
    },
  });
  return {
    id: String(saved.id),
    entryDate: saved.entryDate.toISOString(),
    type: saved.type,
    amountMinorUnits: saved.amountMinorUnits,
    currencyCode: saved.currencyCode,
    description: saved.description,
    category: saved.category,
    source: saved.source,
    externalReference: saved.externalReference,
  };
}
