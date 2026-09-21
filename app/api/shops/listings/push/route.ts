import { NextResponse } from 'next/server';
import { getSubSectionListingsPageData } from '@/lib/listing-table';
import { syncListingToEtsy } from '@/lib/local-listings';

type PushListingRequest = {
  shopId?: string;
  sectionId?: string;
  subSectionId?: string;
  listingId?: string;
};

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as PushListingRequest;

    if (!body.shopId) {
      return NextResponse.json({ error: 'Missing shopId.' }, { status: 400 });
    }

    if (!body.sectionId) {
      return NextResponse.json({ error: 'Missing sectionId.' }, { status: 400 });
    }

    if (!body.subSectionId) {
      return NextResponse.json({ error: 'Missing subSectionId.' }, { status: 400 });
    }

    if (!body.listingId) {
      return NextResponse.json({ error: 'Missing listingId.' }, { status: 400 });
    }

    await syncListingToEtsy(body.shopId, body.sectionId, body.subSectionId, body.listingId);
    const data = await getSubSectionListingsPageData(body.shopId, body.sectionId, body.subSectionId);

    return NextResponse.json({ data });
  } catch (error) {
    console.error('Failed to push listing:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Unable to push listing.' },
      { status: 500 }
    );
  }
}
