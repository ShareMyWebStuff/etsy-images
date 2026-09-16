import { NextResponse } from 'next/server';
import { saveListingItem } from '@/lib/listing-editor';

type SaveListingItemRequest = {
  shopId?: string;
  sectionId?: string;
  subSectionId?: string;
  listingId?: string;
  listingItem?: string;
};

export async function PUT(request: Request) {
  try {
    const body = await request.json() as SaveListingItemRequest;
    if (!body.shopId || !body.sectionId || !body.subSectionId || !body.listingId) {
      return NextResponse.json({ error: 'Missing listing context.' }, { status: 400 });
    }
    if (typeof body.listingItem !== 'string') {
      return NextResponse.json({ error: 'Enter a listing item.' }, { status: 400 });
    }
    const data = await saveListingItem({
      shopId: body.shopId,
      sectionId: body.sectionId,
      subSectionId: body.subSectionId,
      listingId: body.listingId,
    }, body.listingItem);
    return NextResponse.json({ data });
  } catch (error) {
    console.error('Failed to save listing item:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Unable to save the listing item.' },
      { status: 500 }
    );
  }
}
