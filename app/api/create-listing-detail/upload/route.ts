import { imageSize } from 'image-size';
import { NextResponse } from 'next/server';
import { LISTING_DETAIL_IMAGE_ROWS, type ListingDetailImageKey } from '@/lib/listing-detail-workflow';
import { replaceListingImageAtPosition, type ListingEditorContext } from '@/lib/listing-editor';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

function requiredText(formData: FormData, key: string) {
  const value = formData.get(key);
  if (typeof value !== 'string' || !value.trim()) throw new Error(`Missing ${key}.`);
  return value.trim();
}

export async function POST(request: Request) {
  try {
    const formData = await request.formData();
    const context: ListingEditorContext = {
      shopId: requiredText(formData, 'shopId'),
      sectionId: requiredText(formData, 'sectionId'),
      subSectionId: requiredText(formData, 'subSectionId'),
      listingId: requiredText(formData, 'listingId'),
    };
    const detailKey = requiredText(formData, 'detailKey') as ListingDetailImageKey;
    const row = LISTING_DETAIL_IMAGE_ROWS.find((candidate) => candidate.key === detailKey);
    if (!row) return NextResponse.json({ error: 'Choose a valid Etsy image row.' }, { status: 400 });

    const file = formData.get('file');
    if (!(file instanceof File) || file.size === 0) {
      return NextResponse.json({ error: 'Choose an image to upload.' }, { status: 400 });
    }
    if (!/\.(?:jpe?g|png|webp)$/i.test(file.name)) {
      return NextResponse.json({ error: 'Choose a JPG, PNG, or WEBP image.' }, { status: 400 });
    }

    const contents = Buffer.from(await file.arrayBuffer());
    let dimensions: ReturnType<typeof imageSize>;
    try {
      dimensions = imageSize(contents);
    } catch {
      return NextResponse.json({ error: 'The selected file is not a valid image.' }, { status: 400 });
    }
    if (!dimensions.width || !dimensions.height) {
      return NextResponse.json({ error: 'The selected image dimensions could not be read.' }, { status: 400 });
    }

    const data = await replaceListingImageAtPosition(context, row.position, contents, file.name);
    return NextResponse.json({ data });
  } catch (error) {
    console.error('Failed to upload listing detail image:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Unable to upload the Etsy image.' },
      { status: 500 },
    );
  }
}
