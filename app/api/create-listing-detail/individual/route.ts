import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { NextResponse } from 'next/server';
import {
  getListingDetailIndividualProgress,
  getListingDetailIndividualStageOutput,
  startListingDetailIndividualAutomation,
} from '@/lib/chatgpt-thumbnail-automation';
import {
  buildListingDetailPromptSteps,
  CUSTOMISED_SHELVE_INDIVIDUAL_ACTIONS,
  LISTING_DETAIL_IMAGE_ROWS,
} from '@/lib/listing-detail-workflow';
import { getListingAssetFile, getListingEditorData, type ListingEditorContext } from '@/lib/listing-editor';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const DETAIL_KEY = 'customised-shelve-image' as const;

type IndividualStageRequest = Partial<ListingEditorContext> & {
  detailKey?: string;
  stepIndex?: number;
};

function listingContext(body: IndividualStageRequest): ListingEditorContext {
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

function contentTypeForFile(fileName: string) {
  const extension = path.extname(fileName).toLowerCase();
  if (extension === '.jpg' || extension === '.jpeg') return 'image/jpeg';
  if (extension === '.webp') return 'image/webp';
  return 'image/png';
}

export async function GET(request: Request) {
  const searchParams = new URL(request.url).searchParams;
  const listingId = searchParams.get('listingId')?.trim();
  const detailKey = searchParams.get('detailKey')?.trim() || DETAIL_KEY;
  if (!listingId || detailKey !== DETAIL_KEY) {
    return NextResponse.json({ error: 'Choose a valid listing and individual detail row.' }, { status: 400 });
  }

  return NextResponse.json({
    stages: getListingDetailIndividualProgress(
      listingId,
      DETAIL_KEY,
      CUSTOMISED_SHELVE_INDIVIDUAL_ACTIONS.length,
    ),
  });
}

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as IndividualStageRequest;
    const context = listingContext(body);
    const data = await getListingEditorData(context);
    if (!data) return NextResponse.json({ error: 'Listing not found.' }, { status: 404 });

    if (body.detailKey !== DETAIL_KEY) {
      return NextResponse.json({ error: 'Choose a valid individual detail row.' }, { status: 400 });
    }
    if (!Number.isInteger(body.stepIndex) || body.stepIndex! < 0 || body.stepIndex! >= CUSTOMISED_SHELVE_INDIVIDUAL_ACTIONS.length) {
      return NextResponse.json({ error: 'Choose a valid individual stage.' }, { status: 400 });
    }

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

    const stepIndex = body.stepIndex!;
    const steps = buildListingDetailPromptSteps(DETAIL_KEY, {
      roomTheme: data.listing.roomTheme,
      listingItem: data.listing.listingItem,
      listingDescription: data.listing.listingDescription,
      sectionName: data.section.sectionName,
    }, { includeThumbnailGeneration: true });
    const step = steps[stepIndex];
    const action = CUSTOMISED_SHELVE_INDIVIDUAL_ACTIONS[stepIndex];
    const row = LISTING_DETAIL_IMAGE_ROWS.find((candidate) => candidate.key === DETAIL_KEY)!;

    let sourceAttachment: { fileName: string; mimeType: string; contents: Buffer };
    if (stepIndex === 0) {
      const thumbnail = await getListingAssetFile(context, 'thumbnail', 'thumbnail');
      sourceAttachment = {
        fileName: data.thumbnail.originalFileName?.trim() || data.thumbnail.fileName,
        mimeType: thumbnail.contentType,
        contents: thumbnail.contents,
      };
    } else {
      const previousOutput = getListingDetailIndividualStageOutput(data.listing.id, DETAIL_KEY, stepIndex - 1);
      if (!previousOutput) {
        return NextResponse.json(
          { error: `Complete individual stage ${stepIndex} before running stage ${stepIndex + 1}.` },
          { status: 400 },
        );
      }
      sourceAttachment = {
        fileName: previousOutput.fileName,
        mimeType: contentTypeForFile(previousOutput.fileName),
        contents: previousOutput.contents,
      };
    }

    const fontAttachment = step.includeFont
      ? {
          fileName: 'Nunito-Regular.ttf',
          mimeType: 'font/ttf',
          contents: await readFile(path.join(process.cwd(), 'public', 'fonts', 'nunito', 'Nunito-Regular.ttf')),
        }
      : undefined;

    const job = startListingDetailIndividualAutomation({
      listingId: data.listing.id,
      listingName: data.listing.localDirectoryName ?? data.listing.title,
      listingContext: context,
      sourceAttachment,
      fontAttachment,
      key: DETAIL_KEY,
      label: `${row.label} Individual`,
      position: row.position,
      stepIndex,
      stepCount: steps.length,
      outputBaseName: action.outputBaseName,
      step,
    });

    return NextResponse.json({ job }, { status: 202 });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unable to start the individual listing detail stage.';
    const status = message.startsWith('ChatGPT is already working on') ? 409 : 500;
    console.error('Failed to start individual ChatGPT listing detail stage:', error);
    return NextResponse.json({ error: message }, { status });
  }
}
