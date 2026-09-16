import { NextResponse } from 'next/server';
import { savePersonalisationPromptSettings } from '@/lib/listing-editor';

type SaveRequest = {
  shopId?: string;
  sectionId?: string;
  subSectionId?: string;
  listingId?: string;
  headerText?: string;
  footerText?: string;
  fontId?: string;
};

export async function PUT(request: Request) {
  try {
    const body = await request.json() as SaveRequest;
    if (!body.shopId || !body.sectionId || !body.subSectionId || !body.listingId) {
      return NextResponse.json({ error: 'Missing listing context.' }, { status: 400 });
    }
    if (typeof body.headerText !== 'string' || typeof body.footerText !== 'string' || typeof body.fontId !== 'string') {
      return NextResponse.json({ error: 'Personalisation prompt settings are invalid.' }, { status: 400 });
    }
    const data = await savePersonalisationPromptSettings({
      shopId: body.shopId,
      sectionId: body.sectionId,
      subSectionId: body.subSectionId,
      listingId: body.listingId,
    }, {
      headerText: body.headerText,
      footerText: body.footerText,
      fontId: body.fontId,
    });
    return NextResponse.json({ data });
  } catch (error) {
    console.error('Failed to save personalisation prompt settings:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Unable to save personalisation prompt settings.' },
      { status: 500 },
    );
  }
}
