import { NextResponse } from 'next/server';
import { createLocalListing, deleteListing } from '@/lib/local-listings';
import { getSubSectionListingsPageData } from '@/lib/listing-table';

type CreateListingRequest = {
  shopId?: string;
  sectionId?: string;
  subSectionId?: string;
  listingName?: string;
};

type DeleteListingRequest = {
  shopId?: string;
  sectionId?: string;
  subSectionId?: string;
  listingId?: string;
};

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as CreateListingRequest;

    if (!body.shopId) {
      return NextResponse.json({ error: 'Missing shopId.' }, { status: 400 });
    }

    if (!body.sectionId) {
      return NextResponse.json({ error: 'Missing sectionId.' }, { status: 400 });
    }

    if (!body.subSectionId) {
      return NextResponse.json({ error: 'Missing subSectionId.' }, { status: 400 });
    }

    await createLocalListing(body.shopId, body.sectionId, body.subSectionId, body.listingName ?? '');
    const data = await getSubSectionListingsPageData(body.shopId, body.sectionId, body.subSectionId);

    return NextResponse.json({ data });
  } catch (error) {
    console.error('Failed to create local listing:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Unable to create listing.' },
      { status: 500 }
    );
  }
}

export async function DELETE(request: Request) {
  try {
    const body = (await request.json()) as DeleteListingRequest;

    if (!body.shopId) {
      return NextResponse.json({ error: 'Missing shopId.' }, { status: 400 });
    }

    if (!body.sectionId) {
      return NextResponse.json({ error: 'Missing sectionId.' }, { status: 400 });
    }

    if (!body.subSectionId) {
      return NextResponse.json({ error: 'Missing subSectionId.' }, { status: 400 });
    }

    if (!body.listingId) {
      return NextResponse.json({ error: 'Missing listingId.' }, { status: 400 });
    }

    await deleteListing(body.shopId, body.sectionId, body.subSectionId, body.listingId);
    const data = await getSubSectionListingsPageData(body.shopId, body.sectionId, body.subSectionId);

    return NextResponse.json({ data });
  } catch (error) {
    console.error('Failed to delete listing:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Unable to delete listing.' },
      { status: 500 }
    );
  }
}
