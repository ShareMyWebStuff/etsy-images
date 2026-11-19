import { NextResponse } from 'next/server';
import { adjustListingThumbnailGap, getListingThumbnailGap, ListingThumbnailGapError } from '@/lib/listing-thumbnail-gap';
import type { ListingEditorContext } from '@/lib/listing-editor';

function contextFrom(input: Record<string, unknown>): ListingEditorContext {
  const values = ['shopId', 'sectionId', 'subSectionId', 'listingId'] as const;
  for (const key of values) {
    const value = input[key];
    if (typeof value !== 'string' || !/^\d+$/.test(value) || BigInt(value) < 1n
      || (key !== 'shopId' && !Number.isSafeInteger(Number(value)))) {
      throw new ListingThumbnailGapError('Missing or invalid listing context.');
    }
  }
  return Object.fromEntries(values.map((key) => [key, input[key]])) as ListingEditorContext;
}

function failure(error: unknown, fallback: string, defaultStatus = 400) {
  const status = error instanceof ListingThumbnailGapError ? error.status : defaultStatus;
  return NextResponse.json({ error: error instanceof Error ? error.message : fallback }, { status });
}

export async function GET(request: Request) {
  try {
    const context = contextFrom(Object.fromEntries(new URL(request.url).searchParams));
    return NextResponse.json(await getListingThumbnailGap(context), { headers: { 'Cache-Control': 'no-store' } });
  } catch (error) {
    return failure(error, 'Unable to analyse the thumbnail.');
  }
}

export async function POST(request: Request) {
  try {
    let input: unknown;
    try { input = await request.json(); }
    catch { throw new ListingThumbnailGapError('Invalid thumbnail gap request.'); }
    if (!input || typeof input !== 'object' || Array.isArray(input)) throw new ListingThumbnailGapError('Invalid thumbnail gap request.');
    const body = input as Record<string, unknown>;
    return NextResponse.json(await adjustListingThumbnailGap(contextFrom(body), body.gapPercent, body.expectedThumbnailVersion));
  } catch (error) {
    return failure(error, 'Unable to adjust the thumbnail gap.', 500);
  }
}
