import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { NextResponse } from 'next/server';

import {
  buildListingDetailPromptSteps,
  isCustomisedListingDetailImageKey,
  LISTING_DETAIL_IMAGE_ROWS,
} from '@/lib/listing-detail-workflow';
import { getListingAssetFile, getListingEditorData, type ListingEditorContext } from '@/lib/listing-editor';
import { createPersonalisedPrintMaster } from '@/lib/thumbnail-personalisation';
import { createThumbnailPrintMaster } from '@/lib/thumbnail-print-master';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type CreatePersonalisedSourceRequest = Partial<ListingEditorContext> & { detailKey?: string };

function listingContext(body: CreatePersonalisedSourceRequest): ListingEditorContext {
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

function safeFilePart(value: string) {
  return value.replace(/[^a-z0-9_-]+/gi, '-').replace(/^-+|-+$/g, '') || 'listing';
}

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as CreatePersonalisedSourceRequest;
    const context = listingContext(body);
    if (!body.detailKey || !isCustomisedListingDetailImageKey(body.detailKey)) {
      return NextResponse.json({ error: 'Choose a customised listing image.' }, { status: 400 });
    }
    const data = await getListingEditorData(context);
    if (!data) return NextResponse.json({ error: 'Listing not found.' }, { status: 404 });
    if (!data.thumbnail) {
      return NextResponse.json({ error: 'Create or upload a thumbnail first.' }, { status: 400 });
    }

    const personalisation = buildListingDetailPromptSteps(body.detailKey, {
      roomTheme: data.listing.roomTheme,
      listingItem: data.listing.listingItem,
      listingDescription: data.listing.listingDescription,
      sectionName: data.section.sectionName,
    }).find((step) => step.processor === 'local_personalisation')?.localPersonalisation;
    if (!personalisation) throw new Error('The customised text settings could not be found.');

    const [thumbnail, font] = await Promise.all([
      getListingAssetFile(context, 'thumbnail', 'thumbnail'),
      readFile(path.join(process.cwd(), 'public', 'fonts', 'nunito', 'Nunito-Regular.ttf')),
    ]);
    const printMaster = await createThumbnailPrintMaster(thumbnail.contents);
    const personalised = await createPersonalisedPrintMaster(printMaster.buffer, font, personalisation);
    const row = LISTING_DETAIL_IMAGE_ROWS.find((candidate) => candidate.key === body.detailKey)!;
    const listingName = safeFilePart(data.listing.localDirectoryName ?? data.listing.title);
    const fileName = `${listingName}-${row.position}-${body.detailKey}-source.png`;

    return new Response(new Uint8Array(personalised.buffer), {
      status: 200,
      headers: {
        'Content-Type': 'image/png',
        'Content-Disposition': `attachment; filename="${fileName}"`,
        'Cache-Control': 'no-store',
        'X-Image-Width': String(personalised.width),
        'X-Image-Height': String(personalised.height),
      },
    });
  } catch (error) {
    console.error('Failed to create customised listing source image:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Unable to create the customised source image.' },
      { status: 500 },
    );
  }
}
