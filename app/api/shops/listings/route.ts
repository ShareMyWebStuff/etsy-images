import { NextResponse } from 'next/server';
import { createLocalListing, deleteListing } from '@/lib/local-listings';
import { getSubSectionListingsPageData } from '@/lib/listing-table';

type CreateListingRequest = {
  shopId?: string;
  sectionId?: string;
  subSectionId?: string;
  listingName?: string;
  numberOfItems?: number | null;
  includeAllItems?: boolean;
  etsyProductType?: string;
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

    const includeAllItems = body.includeAllItems === true;
    const numberOfItems = includeAllItems ? null : Number(body.numberOfItems);
    if (!includeAllItems && (numberOfItems === null || ![1, 3, 6, 12].includes(numberOfItems))) {
      return NextResponse.json({ error: 'Choose 1, 3, 6, 12, or All items.' }, { status: 400 });
    }
    if (body.etsyProductType !== 'physical' && body.etsyProductType !== 'digital') {
      return NextResponse.json({ error: 'Choose a Physical or Digital Etsy product.' }, { status: 400 });
    }

    await createLocalListing(body.shopId, body.sectionId, body.subSectionId, body.listingName ?? '', {
      numberOfItems,
      includeAllItems,
      etsyProductType: body.etsyProductType,
    });
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
