import { describe, expect, it } from 'vitest';

import {
  classifyEtsyLedgerEntry,
  etsyMoneyToMinorUnits,
  getAccountingYearDateRange,
  getMonthDateRange,
  getReceiptCheckpointEpoch,
  ledgerDedupeKey,
  mapReceiptToFinancialEntry,
  receiptDedupeKey,
  summarizeEntries,
  validateManualEntry,
} from '@/lib/accounting-core';
import { getEtsyAccountingHistoryStartEpochSeconds } from '@/lib/accounting-config';

describe('Etsy money conversion', () => {
  it('converts Etsy amount/divisor values to integer minor units without floating point persistence', () => {
    expect(etsyMoneyToMinorUnits({ amount: 1234, divisor: 100, currency_code: 'GBP' })).toBe(1234);
    expect(etsyMoneyToMinorUnits({ amount: 12345, divisor: 1000, currency_code: 'GBP' })).toBe(1235);
    expect(etsyMoneyToMinorUnits({ amount: -12345, divisor: 1000, currency_code: 'GBP' })).toBe(-1235);
    expect(etsyMoneyToMinorUnits({ amount: 1, divisor: 0, currency_code: 'GBP' })).toBeNull();
  });
});

describe('accounting date ranges', () => {
  it('calculates calendar month boundaries in UTC', () => {
    const range = getMonthDateRange('2024-02');
    expect(range.start.toISOString()).toBe('2024-02-01T00:00:00.000Z');
    expect(range.endExclusive.toISOString()).toBe('2024-03-01T00:00:00.000Z');
  });

  it('calculates a January accounting year', () => {
    const range = getAccountingYearDateRange(new Date('2026-09-22T12:00:00Z'), 1);
    expect(range.start.toISOString()).toBe('2026-01-01T00:00:00.000Z');
    expect(range.endExclusive.toISOString()).toBe('2027-01-01T00:00:00.000Z');
  });

  it('starts an initial Etsy accounting import on 1 January of the current UTC year', () => {
    const start = getEtsyAccountingHistoryStartEpochSeconds(new Date('2026-09-22T12:00:00Z'));
    expect(new Date(start * 1000).toISOString()).toBe('2026-01-01T00:00:00.000Z');
  });

  it('rolls a non-January accounting year back when today precedes its start month', () => {
    const range = getAccountingYearDateRange(new Date('2026-02-10T12:00:00Z'), 4);
    expect(range.start.toISOString()).toBe('2025-04-01T00:00:00.000Z');
    expect(range.endExclusive.toISOString()).toBe('2026-04-01T00:00:00.000Z');
  });

  it('subtracts the overlap from an incremental checkpoint', () => {
    expect(getReceiptCheckpointEpoch(new Date('2026-09-22T00:00:00Z'), 172800)).toBe(1789862400);
    expect(getReceiptCheckpointEpoch(null)).toBeNull();
  });
});

describe('Etsy financial classification', () => {
  const created = 1_750_000_000;

  it('maps one paid receipt to one gross sale income entry', () => {
    const mapped = mapReceiptToFinancialEntry('123', {
      receipt_id: 456,
      status: 'paid',
      is_paid: true,
      created_timestamp: created,
      grandtotal: { amount: 2599, divisor: 100, currency_code: 'GBP' },
    });
    expect(mapped).toMatchObject({ type: 'INCOME', amountMinorUnits: 2599, category: 'Etsy sales', dedupeKey: 'etsy:receipt:123:456' });
  });

  it('does not report canceled receipts as income', () => {
    expect(mapReceiptToFinancialEntry('123', {
      receipt_id: 456,
      status: 'canceled',
      is_paid: true,
      created_timestamp: created,
      grandtotal: { amount: 2599, divisor: 100, currency_code: 'GBP' },
    })).toBeNull();
  });

  it('classifies fees, taxes, refunds and reversals deterministically', () => {
    const base = { entry_id: 1, amount: -100, currency: 'GBP', created_timestamp: created };
    expect(classifyEtsyLedgerEntry('123', { ...base, ledger_type: 'transaction_fee', description: 'Transaction fee' })).toMatchObject({ type: 'EXPENSE', category: 'Etsy fees', amountMinorUnits: 100 });
    expect(classifyEtsyLedgerEntry('123', { ...base, entry_id: 2, ledger_type: 'vat_seller_services' })).toMatchObject({ type: 'EXPENSE', category: 'Etsy taxes' });
    expect(classifyEtsyLedgerEntry('123', { ...base, entry_id: 3, ledger_type: 'refund' })).toMatchObject({ type: 'EXPENSE', category: 'Etsy refunds' });
    expect(classifyEtsyLedgerEntry('123', { ...base, entry_id: 4, amount: 75, ledger_type: 'refund_reversal' })).toMatchObject({ type: 'INCOME', category: 'Etsy refunds', amountMinorUnits: 75 });
    expect(classifyEtsyLedgerEntry('123', { ...base, entry_id: 5, ledger_type: 'etsy_ads', description: 'Etsy Ads' })).toMatchObject({ type: 'EXPENSE', category: 'Etsy fees', amountMinorUnits: 100 });
    expect(classifyEtsyLedgerEntry('123', { ...base, entry_id: 6, ledger_type: 'listing_fee', description: 'Listing fee' })).toMatchObject({ type: 'EXPENSE', category: 'Etsy fees', amountMinorUnits: 100 });
  });

  it('preserves payment and deposit rows outside reporting to avoid double-counting receipt income', () => {
    expect(classifyEtsyLedgerEntry('123', { entry_id: 9, amount: 2500, currency: 'GBP', created_timestamp: created, ledger_type: 'payment' })).toBeNull();
    expect(classifyEtsyLedgerEntry('123', { entry_id: 10, amount: -2500, currency: 'GBP', created_timestamp: created, ledger_type: 'disbursement' })).toBeNull();
  });

  it('generates stable source keys for retry-safe upserts', () => {
    expect(receiptDedupeKey('123', '456')).toBe(receiptDedupeKey('123', '456'));
    expect(ledgerDedupeKey('123', '789')).toBe(ledgerDedupeKey('123', '789'));
  });
});

describe('manual entry validation and summaries', () => {
  it('validates and converts a manual entry to minor units', () => {
    const entry = validateManualEntry({ entryDate: '2026-09-22', type: 'EXPENSE', amount: '12.34', currencyCode: 'gbp', category: 'Paper', description: 'Fine art paper' });
    expect(entry).toMatchObject({ amountMinorUnits: 1234, currencyCode: 'GBP', type: 'EXPENSE' });
  });

  it.each(['0', '-1.00', '1.234', 'abc'])('rejects invalid manual amount %s', (amount) => {
    expect(() => validateManualEntry({ entryDate: '2026-09-22', type: 'INCOME', amount, currencyCode: 'GBP', category: 'Sale', description: 'Sale' })).toThrow(/Amount/);
  });

  it('calculates totals with expenses and refund adjustments', () => {
    expect(summarizeEntries([
      { type: 'INCOME', amountMinorUnits: 2000, currencyCode: 'GBP' },
      { type: 'EXPENSE', amountMinorUnits: 300, currencyCode: 'GBP' },
      { type: 'EXPENSE', amountMinorUnits: 500, currencyCode: 'GBP' },
      { type: 'INCOME', amountMinorUnits: 100, currencyCode: 'GBP' },
    ])).toEqual([{ currencyCode: 'GBP', incomeMinorUnits: 2100, expenseMinorUnits: 800, netMinorUnits: 1300, entryCount: 4 }]);
  });
});
