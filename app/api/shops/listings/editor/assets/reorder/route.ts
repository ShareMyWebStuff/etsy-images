import { NextResponse } from 'next/server';
import { reorderListingImages } from '@/lib/listing-editor';

type ReorderImagesRequest = {
  shopId?: string;
  sectionId?: string;
  subSectionId?: string;
  listingId?: string;
  imageIds?: string[];
};

export async function PUT(request: Request) {
  try {
    const body = (await request.json()) as ReorderImagesRequest;
    if (!body.shopId || !body.sectionId || !body.subSectionId || !body.listingId || !Array.isArray(body.imageIds)) {
      return NextResponse.json({ error: 'Missing image order details.' }, { status: 400 });
    }

    const data = await reorderListingImages(
      {
        shopId: body.shopId,
        sectionId: body.sectionId,
        subSectionId: body.subSectionId,
        listingId: body.listingId,
      },
      body.imageIds.map((id) => ({ id }))
    );
    return NextResponse.json({ data });
  } catch (error) {
    console.error('Failed to reorder listing images:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Unable to save image order.' },
      { status: 500 }
    );
  }
}
