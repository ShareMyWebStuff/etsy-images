import { NextResponse } from 'next/server';
import { saveListingDescription } from '@/lib/listing-editor';

type SaveListingDescriptionRequest = {
  shopId?: string;
  sectionId?: string;
  subSectionId?: string;
  listingId?: string;
  listingDescription?: string;
};

export async function PUT(request: Request) {
  try {
    const body = await request.json() as SaveListingDescriptionRequest;
    if (!body.shopId || !body.sectionId || !body.subSectionId || !body.listingId) {
      return NextResponse.json({ error: 'Missing listing context.' }, { status: 400 });
    }
    if (typeof body.listingDescription !== 'string') {
      return NextResponse.json({ error: 'Enter a listing description.' }, { status: 400 });
    }
    const data = await saveListingDescription({
      shopId: body.shopId,
      sectionId: body.sectionId,
      subSectionId: body.subSectionId,
      listingId: body.listingId,
    }, body.listingDescription);
    return NextResponse.json({ data });
  } catch (error) {
    console.error('Failed to save listing description:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Unable to save the listing description.' },
      { status: 500 }
    );
  }
}
