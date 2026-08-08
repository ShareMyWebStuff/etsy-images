import { NextResponse } from 'next/server';
import { getSyncToEtsyData, makeOneListingInactive, publishOneListing } from '@/lib/sync-to-etsy';

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as { listingId?: string; action?: 'publish' | 'inactive' };
    if (!body.listingId) return NextResponse.json({ error: 'Choose a listing to publish.' }, { status: 400 });
    if (body.action === 'inactive') await makeOneListingInactive(body.listingId);
    else await publishOneListing(body.listingId);
    return NextResponse.json({ data: await getSyncToEtsyData() });
  } catch (error) {
    console.error('Failed to publish listing to Etsy:', error);
    return NextResponse.json({ error: error instanceof Error ? error.message : 'Unable to publish listing.' }, { status: 500 });
  }
}
