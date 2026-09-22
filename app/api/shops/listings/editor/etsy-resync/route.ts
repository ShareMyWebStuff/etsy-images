import { NextResponse } from 'next/server';
import { getListingEditorData, type ListingEditorContext } from '@/lib/listing-editor';
import { syncListingToEtsy } from '@/lib/local-listings';

type EtsyResyncRequest = Partial<ListingEditorContext>;

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as EtsyResyncRequest;
    if (!body.shopId || !body.sectionId || !body.subSectionId || !body.listingId) {
      return NextResponse.json({ error: 'Missing listing context.' }, { status: 400 });
    }

    const context: ListingEditorContext = {
      shopId: body.shopId,
      sectionId: body.sectionId,
      subSectionId: body.subSectionId,
      listingId: body.listingId,
    };
    const current = await getListingEditorData(context);
    if (!current) {
      return NextResponse.json({ error: 'Listing not found.' }, { status: 404 });
    }
    if (current.todoItems.length > 0) {
      return NextResponse.json(
        { error: 'Complete every item on the Todo tab before syncing this listing with Etsy.' },
        { status: 409 },
      );
    }
    if (!current.etsyProducts.config.listOnEtsy) {
      return NextResponse.json({ error: 'Enable List this listing on Etsy before syncing.' }, { status: 409 });
    }
    if (!current.etsyProducts.config.printsFrames && !current.etsyProducts.config.digitalDownload) {
      return NextResponse.json(
        { error: 'Enable Prints / Frames or Digital Download before syncing.' },
        { status: 409 },
      );
    }
    if (current.etsyProducts.config.printsFrames && !current.section.hasEtsySection) {
      return NextResponse.json({ error: 'Create the print section on Etsy before syncing.' }, { status: 409 });
    }

    await syncListingToEtsy(context.shopId, context.sectionId, context.subSectionId, context.listingId);
    const data = await getListingEditorData(context);
    if (!data) {
      throw new Error('The listing was synced, but its refreshed details could not be loaded.');
    }

    return NextResponse.json({ data });
  } catch (error) {
    console.error('Failed to resync listing with Etsy:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Unable to resync the listing with Etsy.' },
      { status: 500 },
    );
  }
}
