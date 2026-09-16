import { NextResponse } from 'next/server';
import { getListingEditorData } from '@/lib/listing-editor';
import { saveListingProducts, type SaveListingProductsInput } from '@/lib/listing-products';

export async function PUT(request: Request) {
  try {
    const body = (await request.json()) as SaveListingProductsInput;

    if (!body.shopId || !body.sectionId || !body.subSectionId || !body.listingId) {
      return NextResponse.json({ error: 'Missing listing context.' }, { status: 400 });
    }

    await saveListingProducts(body);
    const data = await getListingEditorData(body);
    if (!data) throw new Error('Listing not found after saving Etsy products.');

    return NextResponse.json({ data });
  } catch (error) {
    console.error('Failed to save listing Etsy products:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Unable to save Etsy products.' },
      { status: 500 }
    );
  }
}
