import { NextResponse } from 'next/server';
import { stageTwelveListingImages } from '@/lib/multi-listing-staging';

export async function POST(request: Request) {
  try {
    const formData = await request.formData();
    const existingToken = formData.get('token');
    const images: Array<{ slot: number; file: File }> = [];
    for (let slot = 1; slot <= 8; slot += 1) {
      const file = formData.get(`image${slot}`);
      if (file instanceof File) images.push({ slot, file });
    }
    const token = await stageTwelveListingImages(typeof existingToken === 'string' ? existingToken : null, images);
    return NextResponse.json({ token });
  } catch (error) {
    console.error('Failed to stage Sets-of-12 images:', error);
    return NextResponse.json({ error: error instanceof Error ? error.message : 'Unable to upload image batch.' }, { status: 500 });
  }
}
