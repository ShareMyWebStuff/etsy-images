import { NextResponse } from 'next/server';
import { checkEtsyListingStatusesByIds, checkEtsySectionListingStatuses } from '@/lib/local-listings';
import { getSyncToEtsyData } from '@/lib/sync-to-etsy';

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as { sectionId?: string; listingIds?: string[] };
    if (!body.sectionId && (!Array.isArray(body.listingIds) || body.listingIds.length === 0)) {
      return NextResponse.json({ error: 'Choose a section to check.' }, { status: 400 });
    }

    if (Array.isArray(body.listingIds) && body.listingIds.length > 0) {
      await checkEtsyListingStatusesByIds(body.listingIds);
    } else {
      await checkEtsySectionListingStatuses(body.sectionId!);
    }
    return NextResponse.json({ data: await getSyncToEtsyData() });
  } catch (error) {
    console.error('Failed to check Etsy listing statuses:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Unable to check Etsy listing statuses.' },
      { status: 500 }
    );
  }
}
