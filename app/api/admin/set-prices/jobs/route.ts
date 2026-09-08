import { NextResponse } from 'next/server';

import {
  getPriceUpdateJob,
  processNextPriceUpdateItem,
  retryFailedPriceUpdateItems,
  startPriceUpdateJob,
} from '@/lib/set-prices';

export async function GET(request: Request) {
  try {
    const jobId = new URL(request.url).searchParams.get('jobId');
    if (!jobId) return NextResponse.json({ error: 'Choose a price update job.' }, { status: 400 });
    const job = await getPriceUpdateJob(jobId);
    return job ? NextResponse.json({ job }) : NextResponse.json({ error: 'Price update job not found.' }, { status: 404 });
  } catch (error) {
    console.error('Failed to load Etsy price update job:', error);
    return NextResponse.json({ error: error instanceof Error ? error.message : 'Unable to load the update job.' }, { status: 500 });
  }
}

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as { action?: string; changedKeys?: unknown; jobId?: string };
    if (body.action === 'start') return NextResponse.json({ job: await startPriceUpdateJob(body.changedKeys) });
    if (!body.jobId) return NextResponse.json({ error: 'Choose a price update job.' }, { status: 400 });
    if (body.action === 'process') return NextResponse.json({ job: await processNextPriceUpdateItem(body.jobId) });
    if (body.action === 'retry') return NextResponse.json({ job: await retryFailedPriceUpdateItems(body.jobId) });
    return NextResponse.json({ error: 'Choose a valid job action.' }, { status: 400 });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unable to update Etsy prices.';
    console.error('Failed to run Etsy price update job:', message);
    return NextResponse.json({ error: message }, { status: /choose|not found|no failed|no changed/i.test(message) ? 400 : 500 });
  }
}
