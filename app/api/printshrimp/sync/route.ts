import { NextResponse } from 'next/server';

import { PrintShrimpConfigurationError } from '@/lib/printshrimp/client';
import { getSyncToPrintShrimpData, syncListingToPrintShrimp } from '@/lib/printshrimp/sync';
import { PrintShrimpSyncInProgressError } from '@/lib/printshrimp/sync-core';

export const maxDuration = 300;

export async function POST(request: Request) {
  try {
    const body = await request.json() as { listingId?: string };
    if (!body.listingId) return NextResponse.json({ error: 'Choose a listing to sync.' }, { status: 400 });
    await syncListingToPrintShrimp(body.listingId);
    return NextResponse.json({ data: await getSyncToPrintShrimpData() });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unable to sync the listing to PrintShrimp.';
    const upstreamStatus = Number(message.match(/PrintShrimp API returned (\d{3})/)?.[1] ?? 0);
    const status = error instanceof PrintShrimpConfigurationError
      ? 503
      : error instanceof PrintShrimpSyncInProgressError ? 409
        : upstreamStatus >= 400 && upstreamStatus < 500 && upstreamStatus !== 401 && upstreamStatus !== 403 && upstreamStatus !== 429 ? 400
          : upstreamStatus === 401 || upstreamStatus === 403 || upstreamStatus === 429 ? 503
        : /choose|complete|missing|multiple|sku|filename|source|artwork|listing not found/i.test(message) ? 400 : 502;
    return NextResponse.json({ error: message }, { status });
  }
}
