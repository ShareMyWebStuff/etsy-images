import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { imageSize } from 'image-size';
import { NextResponse } from 'next/server';
import { startListingDetailAutomation } from '@/lib/chatgpt-thumbnail-automation';
import {
  buildListingDetailPromptSteps,
  LISTING_DETAIL_IMAGE_KEYS,
  LISTING_DETAIL_IMAGE_ROWS,
  type ListingDetailImageKey,
} from '@/lib/listing-detail-workflow';
import { getListingAssetFile, getListingEditorData, type ListingEditorContext } from '@/lib/listing-editor';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type CreateListingDetailRequest = Partial<ListingEditorContext> & { detailKeys?: string[] };

function listingContext(body: CreateListingDetailRequest): ListingEditorContext {
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

function isListingDetailImageKey(value: string): value is ListingDetailImageKey {
  return (LISTING_DETAIL_IMAGE_KEYS as readonly string[]).includes(value);
}

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as CreateListingDetailRequest;
    const context = listingContext(body);
    const data = await getListingEditorData(context);
    if (!data) return NextResponse.json({ error: 'Listing not found.' }, { status: 404 });

    const missingFields = [
      !data.listing.listingItem.trim() ? 'Listing Item' : null,
      !data.listing.roomTheme.trim() ? 'Room Theme' : null,
      !data.listing.listingDescription.trim() ? 'Listing Description' : null,
    ].filter((value): value is string => value !== null);
    if (missingFields.length > 0) {
      return NextResponse.json(
        { error: `Complete ${missingFields.join(', ')} on the Thumbnail tab first.` },
        { status: 400 },
      );
    }
    if (data.etsyProducts.config.needsConfirmation) {
      return NextResponse.json(
        { error: 'Confirm the saved Etsy Product settings before creating listing details.' },
        { status: 400 },
      );
    }
    if (!data.thumbnail) {
      return NextResponse.json({ error: 'Create or upload a thumbnail first.' }, { status: 400 });
    }

    const requestedKeys = [...new Set(body.detailKeys ?? [])];
    if (requestedKeys.length === 0 || !requestedKeys.every(isListingDetailImageKey)) {
      return NextResponse.json({ error: 'Choose valid Etsy image rows to create.' }, { status: 400 });
    }

    const thumbnail = await getListingAssetFile(context, 'thumbnail', 'thumbnail');
    const thumbnailDimensions = imageSize(thumbnail.contents);
    if (!thumbnailDimensions.width || !thumbnailDimensions.height) {
      return NextResponse.json(
        { error: 'The thumbnail dimensions could not be read.' },
        { status: 400 },
      );
    }
    const fontContents = await readFile(path.join(process.cwd(), 'public', 'fonts', 'nunito', 'Nunito-Regular.ttf'));
    const rowsByKey = new Map(LISTING_DETAIL_IMAGE_ROWS.map((row) => [row.key, row]));
    const plans = requestedKeys.map((key) => {
      const row = rowsByKey.get(key);
      if (!row) throw new Error(`Unknown listing detail row: ${key}`);
      return {
        ...row,
        steps: buildListingDetailPromptSteps(key, {
          roomTheme: data.listing.roomTheme,
          listingItem: data.listing.listingItem,
          listingDescription: data.listing.listingDescription,
          sectionName: data.section.sectionName,
          sourceWidth: thumbnailDimensions.width,
          sourceHeight: thumbnailDimensions.height,
        }),
      };
    });

    const job = startListingDetailAutomation({
      listingId: data.listing.id,
      listingName: data.listing.localDirectoryName ?? data.listing.title,
      listingContext: context,
      thumbnailAttachment: {
        fileName: data.thumbnail.originalFileName?.trim() || data.thumbnail.fileName,
        mimeType: thumbnail.contentType,
        contents: thumbnail.contents,
      },
      fontAttachment: {
        fileName: 'Nunito-Regular.ttf',
        mimeType: 'font/ttf',
        contents: fontContents,
      },
      plans,
    });
    return NextResponse.json({ job }, { status: 202 });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unable to start listing detail generation.';
    const status = message.startsWith('ChatGPT is already working on') ? 409 : 500;
    console.error('Failed to start ChatGPT listing detail generation:', error);
    return NextResponse.json({ error: message }, { status });
  }
}
