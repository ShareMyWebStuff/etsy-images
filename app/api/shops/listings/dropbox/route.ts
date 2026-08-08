import { NextResponse } from 'next/server';
import { createDropboxInstructionPdf, createDropboxZips, createOrUpdateDropbox } from '@/lib/dropbox-bundle';

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
    if (body.action === 'zip') return NextResponse.json(await createDropboxZips(context));
    if (body.action === 'dropbox') return NextResponse.json(await createOrUpdateDropbox(context));
    if (body.action === 'pdf') return NextResponse.json(await createDropboxInstructionPdf(context));
    return NextResponse.json({ error: 'Invalid action.' }, { status: 400 });
  } catch (error) {
    console.error('Dropbox listing action failed:', error);
    return NextResponse.json({ error: error instanceof Error ? error.message : 'Dropbox action failed.' }, { status: 500 });
  }
}
