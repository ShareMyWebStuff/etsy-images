import { NextResponse } from 'next/server';
import { getListingPrintCropSourceDimensions, saveListingPrintCropSettings } from '@/lib/listing-editor';

type SaveRequest = {
  shopId?: string;
  sectionId?: string;
  subSectionId?: string;
  listingId?: string;
  cropSettings?: unknown;
};

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const shopId = searchParams.get('shopId');
    const sectionId = searchParams.get('sectionId');
    const subSectionId = searchParams.get('subSectionId');
    const listingId = searchParams.get('listingId');
    if (!shopId || !sectionId || !subSectionId || !listingId) {
      return NextResponse.json({ error: 'Missing listing context.' }, { status: 400 });
    }
    const dimensions = await getListingPrintCropSourceDimensions({ shopId, sectionId, subSectionId, listingId });
    return NextResponse.json({ dimensions });
  } catch (error) {
    console.error('Failed to load listing print crop source:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Unable to load the thumbnail dimensions.' },
      { status: 400 },
    );
  }
}

export async function PUT(request: Request) {
  try {
    const body = await request.json() as SaveRequest;
    if (!body.shopId || !body.sectionId || !body.subSectionId || !body.listingId) {
      return NextResponse.json({ error: 'Missing listing context.' }, { status: 400 });
    }
    const data = await saveListingPrintCropSettings({
      shopId: body.shopId,
      sectionId: body.sectionId,
      subSectionId: body.subSectionId,
      listingId: body.listingId,
    }, body.cropSettings);
    return NextResponse.json({ data });
  } catch (error) {
    console.error('Failed to save listing print crop settings:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Unable to save the print crop settings.' },
      { status: 400 },
    );
  }
}
