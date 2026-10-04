import { NextResponse } from 'next/server';
import { startListingImageAutomation } from '@/lib/chatgpt-thumbnail-automation';
import { getListingAssetFile, getListingEditorData, type ListingEditorContext } from '@/lib/listing-editor';
import { buildListingImagePrompt } from '@/lib/listing-prompts';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type CreateListingImageRequest = Partial<ListingEditorContext> & { prompt?: string };

function listingContext(body: CreateListingImageRequest): ListingEditorContext {
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
    const body = (await request.json()) as CreateListingImageRequest;
    const context = listingContext(body);
    const data = await getListingEditorData(context);

    if (!data) {
      return NextResponse.json({ error: 'Listing not found.' }, { status: 404 });
    }
    if (!data.thumbnail) {
      return NextResponse.json(
        { error: 'Upload a thumbnail before generating the listing image.' },
        { status: 400 },
      );
    }

    const prompt = buildListingImagePrompt(data.listing.roomTheme);
    if (body.prompt !== prompt) {
      return NextResponse.json(
        { error: 'The listing image prompt is missing or does not match the saved listing values. Refresh the page and try again.' },
        { status: 400 },
      );
    }

    const thumbnail = await getListingAssetFile(context, 'thumbnail', 'thumbnail');
    const job = startListingImageAutomation({
      listingId: data.listing.id,
      listingName: data.listing.localDirectoryName ?? data.listing.title,
      prompt,
      attachment: {
        fileName: data.thumbnail.originalFileName?.trim() || data.thumbnail.fileName,
        mimeType: thumbnail.contentType,
        contents: thumbnail.contents,
      },
    });

    return NextResponse.json({ job }, { status: 202 });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unable to start listing image generation.';
    const status = message.startsWith('ChatGPT is already working on') ? 409 : 500;
    console.error('Failed to start ChatGPT listing image generation:', error);
    return NextResponse.json({ error: message }, { status });
  }
}
