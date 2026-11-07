import { NextResponse } from 'next/server';
import { getListingEditorData } from '@/lib/listing-editor';
import { saveListingCustomisationSettings } from '@/lib/listing-products';

type Body = {
  shopId?: string;
  sectionId?: string;
  subSectionId?: string;
  listingId?: string;
  customisePrints?: boolean;
  customTop?: boolean;
  customBottom?: boolean;
  printsFrames?: boolean;
  digitalDownload?: boolean;
};

export async function PUT(request: Request) {
  try {
    const body = await request.json() as Body;
    if (!body.shopId || !body.sectionId || !body.subSectionId || !body.listingId) {
      return NextResponse.json({ error: 'Missing listing context.' }, { status: 400 });
    }
    if (typeof body.customisePrints !== 'boolean'
      || typeof body.customTop !== 'boolean'
      || typeof body.customBottom !== 'boolean'
      || (body.printsFrames !== undefined && typeof body.printsFrames !== 'boolean')
      || (body.digitalDownload !== undefined && typeof body.digitalDownload !== 'boolean')) {
      return NextResponse.json({ error: 'Choose the listing customisation options.' }, { status: 400 });
    }
    const context = {
      shopId: body.shopId,
      sectionId: body.sectionId,
      subSectionId: body.subSectionId,
      listingId: body.listingId,
    };
    await saveListingCustomisationSettings(context, {
      customisePrints: body.customisePrints,
      customTop: body.customTop,
      customBottom: body.customBottom,
      printsFrames: body.printsFrames,
      digitalDownload: body.digitalDownload,
    });
    return NextResponse.json({ data: await getListingEditorData(context) });
  } catch (error) {
    console.error('Failed to save listing customisation:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Unable to save listing customisation.' },
      { status: 500 },
    );
  }
}

