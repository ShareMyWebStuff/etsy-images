import { NextResponse } from 'next/server';
import {
  getLatestThumbnailAutomationJob,
  getThumbnailAutomationJob,
  startThumbnailAutomation,
} from '@/lib/chatgpt-thumbnail-automation';
import { getListingEditorData, type ListingEditorContext } from '@/lib/listing-editor';
import {
  buildThumbnailIllustrationPrompt,
  missingThumbnailIllustrationPromptFields,
} from '@/lib/thumbnail-generate-prompt';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type CreateThumbnailRequest = Partial<ListingEditorContext> & { prompt?: string };

function listingContext(body: CreateThumbnailRequest): ListingEditorContext {
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

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as CreateThumbnailRequest;
    const context = listingContext(body);
    const data = await getListingEditorData(context);

    if (!data) {
      return NextResponse.json({ error: 'Listing not found.' }, { status: 404 });
    }

    const promptInput = {
      animal: data.listing.listingItem,
      listingDescription: data.listing.listingDescription,
      collectionTheme: data.listing.roomTheme,
      sectionName: data.section.sectionName,
    };
    const missingFields = missingThumbnailIllustrationPromptFields(promptInput);

    if (missingFields.length > 0) {
      return NextResponse.json(
        { error: `Complete ${missingFields.join(', ')} before generating the thumbnail.` },
        { status: 400 },
      );
    }

    const prompt = buildThumbnailIllustrationPrompt(promptInput);
    if (body.prompt !== prompt) {
      return NextResponse.json(
        { error: 'The thumbnail prompt is missing or does not match the saved listing values. Refresh the page and try again.' },
        { status: 400 },
      );
    }

    const job = startThumbnailAutomation({
      listingId: data.listing.id,
      listingName: data.listing.localDirectoryName ?? data.listing.title,
      prompt,
    });

    return NextResponse.json({ job }, { status: 202 });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unable to start thumbnail generation.';
    const status = message.startsWith('ChatGPT is already working on') ? 409 : 500;
    console.error('Failed to start ChatGPT thumbnail generation:', error);
    return NextResponse.json({ error: message }, { status });
  }
}

export async function GET(request: Request) {
  const searchParams = new URL(request.url).searchParams;
  const jobId = searchParams.get('jobId')?.trim();
  const listingId = searchParams.get('listingId')?.trim();
  const job = jobId
    ? getThumbnailAutomationJob(jobId)
    : listingId
      ? getLatestThumbnailAutomationJob(listingId)
      : null;

  if (!job) {
    return NextResponse.json({ error: 'Thumbnail generation job not found.' }, { status: 404 });
  }

  return NextResponse.json({ job });
}
