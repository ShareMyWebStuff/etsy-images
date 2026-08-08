import { NextResponse } from 'next/server';
import { deleteOneListingFromEtsy, getSyncToEtsyData } from '@/lib/sync-to-etsy';

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as { listingId?: string };
    if (!body.listingId) return NextResponse.json({ error: 'Choose a listing to delete.' }, { status: 400 });
    await deleteOneListingFromEtsy(body.listingId);
    return NextResponse.json({ data: await getSyncToEtsyData() });
  } catch (error) {
    console.error('Failed to delete listing from Etsy:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Unable to delete listing from Etsy.' },
      { status: 500 }
    );
  }
}
