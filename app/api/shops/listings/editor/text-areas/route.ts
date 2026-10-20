import { NextResponse } from 'next/server';
import { saveListingPersonalisationTextAreas } from '@/lib/listing-editor';

type SaveRequest = {
  shopId?: string;
  sectionId?: string;
  subSectionId?: string;
  listingId?: string;
  textAreas?: unknown;
};

export async function PUT(request: Request) {
  try {
    const body = await request.json() as SaveRequest;
    if (!body.shopId || !body.sectionId || !body.subSectionId || !body.listingId) {
      return NextResponse.json({ error: 'Missing listing context.' }, { status: 400 });
    }
    const data = await saveListingPersonalisationTextAreas({
      shopId: body.shopId,
      sectionId: body.sectionId,
      subSectionId: body.subSectionId,
      listingId: body.listingId,
    }, body.textAreas);
    return NextResponse.json({ data });
  } catch (error) {
    console.error('Failed to save listing personalisation text areas:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Unable to save the text areas.' },
      { status: 400 },
    );
  }
}
