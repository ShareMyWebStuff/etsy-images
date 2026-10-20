import { NextResponse } from 'next/server';
import { saveListingArtworkOrientation } from '@/lib/listing-editor';

type SaveListingOrientationRequest = {
  shopId?: string;
  sectionId?: string;
  subSectionId?: string;
  listingId?: string;
  orientation?: unknown;
};

export async function PUT(request: Request) {
  try {
    const body = await request.json() as SaveListingOrientationRequest;
    if (!body.shopId || !body.sectionId || !body.subSectionId || !body.listingId) {
      return NextResponse.json({ error: 'Missing listing context.' }, { status: 400 });
    }
    const data = await saveListingArtworkOrientation({
      shopId: body.shopId,
      sectionId: body.sectionId,
      subSectionId: body.subSectionId,
      listingId: body.listingId,
    }, body.orientation);
    return NextResponse.json({ data });
  } catch (error) {
    console.error('Failed to save listing artwork orientation:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Unable to save the listing orientation.' },
      { status: 400 },
    );
  }
}
