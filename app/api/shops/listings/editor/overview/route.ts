import path from 'node:path';
import { NextResponse } from 'next/server';
import {
  generateListingTemplateImages,
  deleteAllListingImages,
  getGroupedListingThumbnail,
  getListingEditorData,
  saveListingGroupItems,
  type ListingEditorContext,
} from '@/lib/listing-editor';
import {
  generateListingDetailsWithBedrock,
  generateMultipleListingDetailsWithBedrock,
} from '@/lib/bedrock-listing-details';
import { createGroupedDropboxInstructionPdf } from '@/lib/dropbox-bundle';
import {
  generateListingOverview,
  recordCurrentListingOverviewFingerprint,
} from '@/lib/listing-overview-generation';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 300;

type OverviewRequest = Partial<ListingEditorContext> & {
  action?: 'clear-images' | 'images' | 'details' | 'grouped-pdf' | 'all' | 'changed' | 'mark-current';
  imageTemplateId?: number;
  sourceListingIds?: string[];
  preview?: string;
};

function contextFrom(value: OverviewRequest): ListingEditorContext {
  if (!value.shopId || !value.sectionId || !value.subSectionId || !value.listingId) {
    throw new Error('Missing listing context.');
  }
  return {
    shopId: value.shopId,
    sectionId: value.sectionId,
    subSectionId: value.subSectionId,
    listingId: value.listingId,
  };
}

export async function GET(request: Request) {
  try {
    const values = Object.fromEntries(new URL(request.url).searchParams) as OverviewRequest & { sourceListingId?: string };
    if (!values.sourceListingId) return NextResponse.json({ error: 'Missing source listing id.' }, { status: 400 });
    const file = await getGroupedListingThumbnail(contextFrom(values), values.sourceListingId, values.preview === '1');
    const extension = path.extname(file.fileName).toLocaleLowerCase();
    const contentType = extension === '.png' ? 'image/png' : extension === '.webp' ? 'image/webp' : 'image/jpeg';
    return new Response(new Uint8Array(file.contents), {
      headers: { 'Content-Type': contentType, 'Cache-Control': 'private, max-age=60' },
    });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : 'Unable to load thumbnail.' }, { status: 404 });
  }
}

export async function PUT(request: Request) {
  try {
    const body = await request.json() as OverviewRequest;
    if (!Array.isArray(body.sourceListingIds) || !body.sourceListingIds.every((id) => typeof id === 'string')) {
      return NextResponse.json({ error: 'Choose the listings to group.' }, { status: 400 });
    }
    return NextResponse.json({ data: await saveListingGroupItems(contextFrom(body), body.sourceListingIds) });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : 'Unable to save grouped listings.' }, { status: 400 });
  }
}

export async function POST(request: Request) {
  try {
    const body = await request.json() as OverviewRequest;
    const context = contextFrom(body);
    if (body.action === 'clear-images') {
      return NextResponse.json({ data: await deleteAllListingImages(context) });
    }
    if (body.action === 'images') {
      if (body.imageTemplateId !== undefined && (!Number.isSafeInteger(body.imageTemplateId) || body.imageTemplateId < 1)) {
        return NextResponse.json({ error: 'Choose a valid image template.' }, { status: 400 });
      }
      return NextResponse.json({ data: await generateListingTemplateImages(context, body.imageTemplateId) });
    }
    if (body.action === 'details') {
      const data = await getListingEditorData(context);
      if (!data) throw new Error('Listing not found.');
      return NextResponse.json({
        data: data.template?.templateType === 'multiple'
          ? await generateMultipleListingDetailsWithBedrock(context)
          : await generateListingDetailsWithBedrock(context),
      });
    }
    if (body.action === 'grouped-pdf') {
      await createGroupedDropboxInstructionPdf(context);
      return NextResponse.json({ data: await getListingEditorData(context) });
    }
    if (body.action === 'all' || body.action === 'changed') {
      return NextResponse.json(await generateListingOverview(context, body.action));
    }
    if (body.action === 'mark-current') {
      return NextResponse.json({ data: await recordCurrentListingOverviewFingerprint(context) });
    }
    return NextResponse.json({ error: 'Choose a valid generation action.' }, { status: 400 });
  } catch (error) {
    console.error('Failed to generate listing overview:', error);
    const message = error instanceof Error && error.message.trim()
      ? error.message
      : 'Unable to generate the listing. The server returned an error without a message.';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
