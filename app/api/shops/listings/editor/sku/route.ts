import { NextResponse } from 'next/server';

import { setListingEtsySku, type ListingEditorContext } from '@/lib/listing-editor';

type SetListingSkuRequest = Partial<ListingEditorContext>;

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as SetListingSkuRequest;
    if (!body.shopId || !body.sectionId || !body.subSectionId || !body.listingId) {
      return NextResponse.json({ error: 'Missing listing context.' }, { status: 400 });
    }
    const result = await setListingEtsySku({
      shopId: body.shopId,
      sectionId: body.sectionId,
      subSectionId: body.subSectionId,
      listingId: body.listingId,
    });
    return NextResponse.json(result);
  } catch (error) {
    console.error('Failed to set Etsy SKU:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Unable to set the Etsy SKU.' },
      { status: 500 },
    );
  }
}
