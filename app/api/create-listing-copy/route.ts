import { NextResponse } from 'next/server';

import { startListingTextAutomation } from '@/lib/chatgpt-thumbnail-automation';
import {
  buildCombinedListingDetailsPrompt,
  missingCombinedListingDetailsPromptFields,
} from '@/lib/combined-listing-details-prompt';
import { getListingEditorData, type ListingEditorContext } from '@/lib/listing-editor';
import { PRINTABLE_DOWNLOAD_SPECS } from '@/lib/printable-download-specs';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type CreateListingCopyRequest = Partial<ListingEditorContext>;

function listingContext(body: CreateListingCopyRequest): ListingEditorContext {
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
    const context = listingContext((await request.json()) as CreateListingCopyRequest);
    const data = await getListingEditorData(context);
    if (!data) return NextResponse.json({ error: 'Listing not found.' }, { status: 404 });
    if (data.etsyProducts.config.needsConfirmation) {
      return NextResponse.json(
        { error: 'Confirm the saved Etsy Product settings before creating listing details.' },
        { status: 400 },
      );
    }

    const frameColours = data.etsyProducts.frames
      .filter((frame) => frame.key !== 'no_frame' && frame.enabled)
      .map((frame) => frame.key === 'oak' ? 'Natural Oak' : frame.label);
    const printSizes = data.etsyProducts.sizes
      .filter((size) => size.enabled)
      .map((size) => size.label);
    const firstDownloadImage = data.files.find((file) => file.widthPixels && file.heightPixels);
    const expectedDownloadFiles = PRINTABLE_DOWNLOAD_SPECS.map((spec) => (
      `${spec.label} (${spec.portraitWidth} × ${spec.portraitHeight}px)`
    ));
    const personalisationAreas = data.etsyProducts.config.customisePrints
      ? [
        data.etsyProducts.config.customTop ? 'top' : null,
        data.etsyProducts.config.customBottom ? 'bottom' : null,
      ].filter((area): area is string => area !== null)
      : [];
    const values = {
      sectionName: data.section.sectionName,
      listingName: data.listing.localDirectoryName ?? data.listing.title,
      animalName: data.listing.listingItem,
      animalDescription: data.listing.listingDescription,
      roomTheme: data.listing.roomTheme,
      digitalDownload: data.etsyProducts.config.digitalDownload,
      paperDetails: data.materials.map(({ value }) => value).join(', ')
        || 'Heavyweight matte art paper, at least 200gsm',
      printSizes: printSizes.join(', '),
      frameColours: frameColours.join(', '),
      personalisationDetails: personalisationAreas.length > 0
        ? `Optional ${personalisationAreas.join(' and ')} text personalisation is available.`
        : '',
      giftMessageEnabled: data.etsyProducts.config.giftMessageEnabled,
      digitalFilesIncluded: expectedDownloadFiles.join(', '),
      orientation: (firstDownloadImage?.widthPixels ?? 0) > (firstDownloadImage?.heightPixels ?? 0)
        ? 'landscape'
        : 'portrait',
      fileType: 'jpeg',
      recommendedPaper: data.materials.map(({ value }) => value).join(', ')
        || 'Heavyweight matte photo paper, approximately 200–250 gsm',
      licenceType: 'Personal use only',
    };
    const missingFields = missingCombinedListingDetailsPromptFields(values);
    if (missingFields.length > 0) {
      return NextResponse.json(
        { error: `Complete ${missingFields.join(', ')} on the Thumbnail tab first.` },
        { status: 400 },
      );
    }
    if (data.etsyProducts.config.printsFrames && printSizes.length === 0) {
      return NextResponse.json({ error: 'Select at least one Print size on the Etsy Products tab.' }, { status: 400 });
    }

    const job = startListingTextAutomation({
      listingId: data.listing.id,
      listingName: data.listing.localDirectoryName ?? data.listing.title,
      listingContext: context,
      prompt: buildCombinedListingDetailsPrompt(values),
    });
    return NextResponse.json({ job }, { status: 202 });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unable to start Etsy listing detail generation.';
    const status = message.startsWith('ChatGPT is already working on') ? 409 : 500;
    console.error('Failed to start ChatGPT Etsy listing detail generation:', error);
    return NextResponse.json({ error: message }, { status });
  }
}
