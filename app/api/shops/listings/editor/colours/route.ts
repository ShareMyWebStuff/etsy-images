import { NextResponse } from 'next/server';

import { setListingColoursFromThumbnail, type ListingEditorContext } from '@/lib/listing-editor';

type SetListingColoursRequest = Partial<ListingEditorContext>;

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as SetListingColoursRequest;
    if (!body.shopId || !body.sectionId || !body.subSectionId || !body.listingId) {
      return NextResponse.json({ error: 'Missing listing context.' }, { status: 400 });
    }
    const result = await setListingColoursFromThumbnail({
      shopId: body.shopId,
      sectionId: body.sectionId,
      subSectionId: body.subSectionId,
      listingId: body.listingId,
    });
    return NextResponse.json(result);
  } catch (error) {
    console.error('Failed to set Etsy colours from the thumbnail:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Unable to set Etsy colours from the thumbnail.' },
      { status: 500 },
    );
  }
}
