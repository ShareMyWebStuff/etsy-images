import { NextResponse } from 'next/server';
import { getSyncToEtsyData, makeOneListingInactive, publishOneListing } from '@/lib/sync-to-etsy';
import type { EtsySyncVariant } from '@/lib/etsy-sync-images';

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as { listingId?: string; action?: 'publish' | 'inactive'; variants?: EtsySyncVariant[] };
    if (!body.listingId) return NextResponse.json({ error: 'Choose a listing to publish.' }, { status: 400 });
    if (!Array.isArray(body.variants) || body.variants.length === 0
      || body.variants.some((variant) => !['print', 'customised', 'download'].includes(variant))) {
      return NextResponse.json({ error: 'Choose the Etsy product type to update. Refresh the page and try again.' }, { status: 400 });
    }
    if (body.action === 'inactive') await makeOneListingInactive(body.listingId, body.variants);
    else await publishOneListing(body.listingId, body.variants);
    return NextResponse.json({ data: await getSyncToEtsyData() });
  } catch (error) {
    console.error('Failed to publish listing to Etsy:', error);
    return NextResponse.json({ error: error instanceof Error ? error.message : 'Unable to publish listing.' }, { status: 500 });
  }
}
