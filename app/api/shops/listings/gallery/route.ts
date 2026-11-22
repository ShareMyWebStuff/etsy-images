import { NextResponse } from 'next/server';
import { getListingGallery, ListingGalleryError } from '@/lib/listing-gallery';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
  try {
    const parameters = new URL(request.url).searchParams;
    return NextResponse.json(await getListingGallery(parameters.get('shopId') ?? '', parameters.get('sectionId') ?? ''),
      { headers: { 'Cache-Control': 'no-store' } });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : 'Unable to load the section gallery.' },
      { status: error instanceof ListingGalleryError ? error.status : 500, headers: { 'Cache-Control': 'no-store' } });
  }
}
