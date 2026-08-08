import { NextResponse } from 'next/server';
import { getImportableLocalListings, importLocalListing } from '@/lib/local-listings';
import { getSubSectionListingsPageData } from '@/lib/listing-table';

type ImportListingRequest = {
  shopId?: string;
  sectionId?: string;
  subSectionId?: string;
  listingName?: string;
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

    const listings = await getImportableLocalListings(shopId, sectionId, subSectionId);

    return NextResponse.json({ listings });
  } catch (error) {
    console.error('Failed to load importable listings:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Unable to load importable listings.' },
      { status: 500 }
    );
  }
}

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as ImportListingRequest;

    if (!body.shopId || !body.sectionId || !body.subSectionId) {
      return NextResponse.json({ error: 'Missing listing context.' }, { status: 400 });
    }

    if (!body.listingName) {
      return NextResponse.json({ error: 'Missing listingName.' }, { status: 400 });
    }

    await importLocalListing(body.shopId, body.sectionId, body.subSectionId, body.listingName);

    const [data, listings] = await Promise.all([
      getSubSectionListingsPageData(body.shopId, body.sectionId, body.subSectionId),
      getImportableLocalListings(body.shopId, body.sectionId, body.subSectionId),
    ]);

    return NextResponse.json({ data, listings });
  } catch (error) {
    console.error('Failed to import local listing:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Unable to import listing.' },
      { status: 500 }
    );
  }
}
