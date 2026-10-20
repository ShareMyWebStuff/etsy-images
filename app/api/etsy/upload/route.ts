import { NextResponse } from 'next/server';
import { getSyncToEtsyData, syncOneListing } from '@/lib/sync-to-etsy';
import type { EtsySyncVariant } from '@/lib/etsy-sync-images';

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as { listingId?: string; variants?: EtsySyncVariant[] };
    if (body.listingId) await syncOneListing(body.listingId, body.variants);
    else return NextResponse.json({ error: 'Choose a listing to sync.' }, { status: 400 });
    return NextResponse.json({ data: await getSyncToEtsyData() });
  } catch (error) {
    console.error('Failed to sync listing to Etsy:', error);
    return NextResponse.json({ error: error instanceof Error ? error.message : 'Unable to sync to Etsy.' }, { status: 500 });
  }
}
