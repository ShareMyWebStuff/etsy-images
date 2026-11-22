import { NextResponse } from 'next/server';
import { getListingZipImportTemplates, listingZipImportContext, ListingZipImportError } from '@/lib/listing-zip-import';
import { actOnListingZipReview, closeListingZipReview, getListingZipReview, getListingZipReviewImage, startListingZipReview } from '@/lib/listing-zip-review';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 300;

function failure(error: unknown) {
  return NextResponse.json({ error: error instanceof Error ? error.message : 'Unable to import listings.' },
    { status: error instanceof ListingZipImportError ? error.status : 500, headers: { 'Cache-Control': 'private, no-store' } });
}

async function json(request: Request): Promise<Record<string, unknown>> {
  let value: unknown;
  try { value = await request.json(); } catch { throw new ListingZipImportError('Send a valid ZIP review action.'); }
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new ListingZipImportError('Send a valid ZIP review action.');
  return value as Record<string, unknown>;
}

function sessionId(value: unknown) {
  if (typeof value !== 'string' || !/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value)) throw new ListingZipImportError('Choose an active ZIP review.');
  return value;
}

export async function GET(request: Request) {
  try {
    const parameters = new URL(request.url).searchParams;
    const context = listingZipImportContext(Object.fromEntries(parameters));
    const action = parameters.get('action');
    if (!action) return NextResponse.json(await getListingZipImportTemplates(context), { headers: { 'Cache-Control': 'no-store' } });
    const id = sessionId(parameters.get('sessionId'));
    if (action === 'review') return NextResponse.json(await getListingZipReview(context, id), { headers: { 'Cache-Control': 'private, no-store' } });
    if (action === 'image') {
      const row = parameters.get('rowIndex');
      if (row === null || !/^(0|[1-9]\d*)$/.test(row)) throw new ListingZipImportError('Choose a valid review row.');
      return new Response(new Uint8Array(await getListingZipReviewImage(context, id, Number(row))), { headers: { 'Content-Type': 'image/webp', 'Cache-Control': 'private, no-store' } });
    }
    throw new ListingZipImportError('Choose a valid ZIP review action.');
  }
  catch (error) { return failure(error); }
}

export async function POST(request: Request) {
  try {
    if (request.headers.get('content-type')?.includes('application/json')) {
      const body = await json(request), context = listingZipImportContext(body);
      if (body.action !== 'insert' && body.action !== 'skip') throw new ListingZipImportError('Choose Insert or Skip for this review row.');
      if (typeof body.rowIndex !== 'number' || !Number.isSafeInteger(body.rowIndex) || body.rowIndex < 0) throw new ListingZipImportError('Choose a valid review row.');
      return NextResponse.json(await actOnListingZipReview(context, sessionId(body.sessionId), body.rowIndex, body.action), { headers: { 'Cache-Control': 'private, no-store' } });
    }
    let form: FormData;
    try { form = await request.formData(); } catch { throw new ListingZipImportError('Choose a ZIP file and template.'); }
    const context = listingZipImportContext(Object.fromEntries(form));
    const file = form.get('file');
    if (!(file instanceof File)) throw new ListingZipImportError('Choose a ZIP file.');
    return NextResponse.json(await startListingZipReview(context, form.get('templateId'), file), { headers: { 'Cache-Control': 'private, no-store' } });
  } catch (error) { return failure(error); }
}

export async function DELETE(request: Request) {
  try {
    const body = await json(request), context = listingZipImportContext(body);
    await closeListingZipReview(context, sessionId(body.sessionId));
    return NextResponse.json({ closed: true }, { headers: { 'Cache-Control': 'private, no-store' } });
  } catch (error) { return failure(error); }
}
