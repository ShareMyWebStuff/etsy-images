import { NextResponse } from 'next/server';
import {
  discardThumbnailAutomationResult,
  getCompletedThumbnailAutomationResult,
} from '@/lib/chatgpt-thumbnail-automation';
import {
  getListingEditorData,
  replaceListingThumbnailFromBuffer,
  type ListingEditorContext,
} from '@/lib/listing-editor';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type ReviewRequest = Partial<ListingEditorContext> & { jobId?: string; accepted?: boolean };

function listingContext(body: ReviewRequest): ListingEditorContext {
  if (!body.shopId || !body.sectionId || !body.subSectionId || !body.listingId) {
    throw new Error('Missing listing context.');
  }
  return {
    shopId: body.shopId,
    sectionId: body.sectionId,
    subSectionId: body.subSectionId,
    listingId: body.listingId,
  };
}

export async function GET(request: Request) {
  const jobId = new URL(request.url).searchParams.get('jobId')?.trim();
  if (!jobId) return NextResponse.json({ error: 'Missing thumbnail job.' }, { status: 400 });
  const result = getCompletedThumbnailAutomationResult(jobId);
  if (!result) return NextResponse.json({ error: 'Generated thumbnail not found.' }, { status: 404 });
  const lowerName = result.fileName.toLowerCase();
  const contentType = lowerName.endsWith('.jpg') || lowerName.endsWith('.jpeg')
    ? 'image/jpeg'
    : lowerName.endsWith('.webp')
      ? 'image/webp'
      : 'image/png';
  return new NextResponse(result.contents, {
    headers: { 'Content-Type': contentType, 'Cache-Control': 'no-store' },
  });
}

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as ReviewRequest;
    const context = listingContext(body);
    if (!body.jobId || typeof body.accepted !== 'boolean') {
      return NextResponse.json({ error: 'Missing thumbnail review choice.' }, { status: 400 });
    }
    const result = getCompletedThumbnailAutomationResult(body.jobId);
    if (!result || result.listingId !== context.listingId) {
      return NextResponse.json({ error: 'Generated thumbnail not found for this listing.' }, { status: 404 });
    }

    const data = body.accepted
      ? await replaceListingThumbnailFromBuffer(context, result.contents, result.fileName)
      : await getListingEditorData(context);
    discardThumbnailAutomationResult(body.jobId);
    return NextResponse.json({ data });
  } catch (error) {
    console.error('Failed to review generated thumbnail:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Unable to review generated thumbnail.' },
      { status: 500 },
    );
  }
}
