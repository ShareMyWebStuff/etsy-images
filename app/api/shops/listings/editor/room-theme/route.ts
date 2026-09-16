import { NextResponse } from 'next/server';
import { saveListingRoomTheme } from '@/lib/listing-editor';

type SaveListingRoomThemeRequest = {
  shopId?: string;
  sectionId?: string;
  subSectionId?: string;
  listingId?: string;
  roomTheme?: string;
};

export async function PUT(request: Request) {
  try {
    const body = await request.json() as SaveListingRoomThemeRequest;
    if (!body.shopId || !body.sectionId || !body.subSectionId || !body.listingId) {
      return NextResponse.json({ error: 'Missing listing context.' }, { status: 400 });
    }
    if (typeof body.roomTheme !== 'string') {
      return NextResponse.json({ error: 'Enter a room theme.' }, { status: 400 });
    }
    const data = await saveListingRoomTheme({
      shopId: body.shopId,
      sectionId: body.sectionId,
      subSectionId: body.subSectionId,
      listingId: body.listingId,
    }, body.roomTheme);
    return NextResponse.json({ data });
  } catch (error) {
    console.error('Failed to save listing room theme:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Unable to save the room theme.' },
      { status: 500 }
    );
  }
}
