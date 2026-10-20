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
  ourCategoryId?: number;
};

type DeleteListingRequest = {
  shopId?: string;
  sectionId?: string;
  subSectionId?: string;
  listingId?: string;
};

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const shopId = searchParams.get('shopId');
    const sectionId = searchParams.get('sectionId');
    const subSectionId = searchParams.get('subSectionId');
    if (!shopId || !sectionId || !subSectionId) {
      return NextResponse.json({ error: 'Missing listing context.' }, { status: 400 });
    }
    return NextResponse.json({ data: await getSubSectionListingsPageData(shopId, sectionId, subSectionId) });
  } catch (error) {
    console.error('Failed to load local listings:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Unable to load listings.' },
      { status: 500 },
    );
  }
}

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
      return NextResponse.json({ error: 'Choose 1, 3, 6, or 12 items.' }, { status: 400 });
    }
    if (!Number.isSafeInteger(body.ourCategoryId) || !body.ourCategoryId) {
      return NextResponse.json({ error: 'Choose a template.' }, { status: 400 });
    }

    await createLocalListing(body.shopId, body.sectionId, body.subSectionId, body.listingName ?? '', {
      numberOfItems,
      includeAllItems,
      etsyProductType: 'physical',
      ourCategoryId: body.ourCategoryId,
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
