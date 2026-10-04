import { NextResponse } from 'next/server';

import { parseSetDetailsOutput } from '@/lib/combined-listing-details-prompt';
import { saveGeneratedListingDetails, type ListingEditorContext } from '@/lib/listing-editor';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type ImportSetDetailsRequest = Partial<ListingEditorContext> & {
  output?: unknown;
};

function listingContext(body: ImportSetDetailsRequest): ListingEditorContext {
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
    const body = (await request.json()) as ImportSetDetailsRequest;
    const context = listingContext(body);
    if (typeof body.output !== 'string' || !body.output.trim()) {
      return NextResponse.json({ error: 'Paste the complete Set Details output first.' }, { status: 400 });
    }

    const generated = parseSetDetailsOutput(body.output);
    const data = await saveGeneratedListingDetails(context, generated);
    return NextResponse.json({ data });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unable to import the Set Details output.';
    const isInputError = /^(Missing listing context|Paste |The pasted |Print |Digital |Tags |The Etsy |The output )/.test(message);
    if (!isInputError) console.error('Failed to import Set Details output:', error);
    return NextResponse.json({ error: message }, { status: isInputError ? 400 : 500 });
  }
}
