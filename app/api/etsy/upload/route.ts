import { NextResponse } from 'next/server';
import { getSyncToEtsyData, syncOneListing, syncSectionListings } from '@/lib/sync-to-etsy';

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as { listingId?: string; sectionId?: string };
    if (body.listingId) await syncOneListing(body.listingId);
    else if (body.sectionId) await syncSectionListings(body.sectionId);
    else return NextResponse.json({ error: 'Choose a listing or section to sync.' }, { status: 400 });
    return NextResponse.json({ data: await getSyncToEtsyData() });
  } catch (error) {
    console.error('Failed to sync listing to Etsy:', error);
    return NextResponse.json({ error: error instanceof Error ? error.message : 'Unable to sync to Etsy.' }, { status: 500 });
  }
}
