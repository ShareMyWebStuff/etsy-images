import { NextResponse } from 'next/server';

import { AccountingSyncInProgressError, syncAllEtsyAccounting } from '@/lib/etsy-accounting-sync';

export const maxDuration = 300;

export async function POST() {
  try {
    return NextResponse.json({ summary: await syncAllEtsyAccounting() });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unable to sync Etsy accounts data.';
    const status = error instanceof AccountingSyncInProgressError
      ? 409
      : /connect etsy|transactions_r|authorization|approve transaction/i.test(message) ? 403 : 500;
    console.error('Failed to sync Etsy accounts data:', error);
    return NextResponse.json({ error: message }, { status });
  }
}
