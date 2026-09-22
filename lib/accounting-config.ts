export const ACCOUNTING_YEAR_START_MONTH = 1;
export const ACCOUNTING_SYNC_OVERLAP_SECONDS = 2 * 24 * 60 * 60;
export const ETSY_LEDGER_HISTORY_START_EPOCH_SECONDS = 946_684_800;
export const SUPPORTED_ACCOUNTING_CURRENCIES = ['GBP', 'USD', 'EUR', 'CAD', 'AUD'] as const;

export function getEtsyAccountingHistoryStartEpochSeconds(now: Date) {
  return Math.floor(Date.UTC(now.getUTCFullYear(), 0, 1) / 1000);
}

export type SupportedAccountingCurrency = typeof SUPPORTED_ACCOUNTING_CURRENCIES[number];
