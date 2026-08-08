import { NextResponse } from 'next/server';
import { checkEtsySectionListingStatuses } from '@/lib/local-listings';
import { getSyncToEtsyData } from '@/lib/sync-to-etsy';

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as { sectionId?: string };
    if (!body.sectionId) {
      return NextResponse.json({ error: 'Choose a section to check.' }, { status: 400 });
    }

    await checkEtsySectionListingStatuses(body.sectionId);
    return NextResponse.json({ data: await getSyncToEtsyData() });
  } catch (error) {
    console.error('Failed to check Etsy listing statuses:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Unable to check Etsy listing statuses.' },
      { status: 500 }
    );
  }
}
