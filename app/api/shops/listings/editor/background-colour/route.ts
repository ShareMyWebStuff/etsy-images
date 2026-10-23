import { NextResponse } from 'next/server';

import { saveListingBackgroundColour } from '@/lib/listing-editor';

type SaveListingBackgroundColourRequest = {
  shopId?: string;
  sectionId?: string;
  subSectionId?: string;
  listingId?: string;
  backgroundColour?: unknown;
};

export async function PUT(request: Request) {
  try {
    const body = await request.json() as SaveListingBackgroundColourRequest;
    if (!body.shopId || !body.sectionId || !body.subSectionId || !body.listingId) {
      return NextResponse.json({ error: 'Missing listing context.' }, { status: 400 });
    }
    const data = await saveListingBackgroundColour({
      shopId: body.shopId,
      sectionId: body.sectionId,
      subSectionId: body.subSectionId,
      listingId: body.listingId,
    }, body.backgroundColour);
    return NextResponse.json({ data });
  } catch (error) {
    console.error('Failed to save listing background colour:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Unable to save the background colour.' },
      { status: 400 },
    );
  }
}
