import { NextResponse } from 'next/server';
import {
  createDropboxInstructionPdf,
  createDropboxZips,
  createOrUpdateDropbox,
  DropboxBundleStateError,
} from '@/lib/dropbox-bundle';
import { getListingEditorData } from '@/lib/listing-editor';

type RequestBody = {
  shopId?: string; sectionId?: string; subSectionId?: string; listingId?: string;
  action?: 'zip' | 'dropbox' | 'pdf';
};

export async function POST(request: Request) {
  try {
    const body = await request.json() as RequestBody;
    if (!body.shopId || !body.sectionId || !body.subSectionId || !body.listingId) {
      return NextResponse.json({ error: 'Missing listing context.' }, { status: 400 });
    }
    const context = { shopId: body.shopId, sectionId: body.sectionId, subSectionId: body.subSectionId, listingId: body.listingId };
    let result: unknown;
    if (body.action === 'zip') result = await createDropboxZips(context);
    else if (body.action === 'dropbox') result = await createOrUpdateDropbox(context);
    else if (body.action === 'pdf') result = await createDropboxInstructionPdf(context);
    else return NextResponse.json({ error: 'Invalid action.' }, { status: 400 });
    // Keep the legacy top-level result fields for the multi-listing wizard while
    // also returning the refreshed editor payload used by the listing editor.
    const legacyResult = result && typeof result === 'object' && !Array.isArray(result)
      ? result as Record<string, unknown>
      : {};
    return NextResponse.json({ ...legacyResult, result, data: await getListingEditorData(context) });
  } catch (error) {
    console.error('Dropbox listing action failed:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Dropbox action failed.' },
      { status: error instanceof DropboxBundleStateError ? error.status : 500 },
    );
  }
}
