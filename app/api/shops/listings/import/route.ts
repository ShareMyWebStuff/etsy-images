import { NextResponse } from 'next/server';
import { getListingZipImportTemplates, importListingZip, listingZipImportContext, ListingZipImportError } from '@/lib/listing-zip-import';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 300;

function failure(error: unknown) {
  return NextResponse.json({ error: error instanceof Error ? error.message : 'Unable to import listings.' },
    { status: error instanceof ListingZipImportError ? error.status : 500 });
}

export async function GET(request: Request) {
  try { return NextResponse.json(await getListingZipImportTemplates(listingZipImportContext(Object.fromEntries(new URL(request.url).searchParams))), { headers: { 'Cache-Control': 'no-store' } }); }
  catch (error) { return failure(error); }
}

export async function POST(request: Request) {
  try {
    let form: FormData;
    try { form = await request.formData(); } catch { throw new ListingZipImportError('Choose a ZIP file and template.'); }
    const context = listingZipImportContext(Object.fromEntries(form));
    const file = form.get('file');
    if (!(file instanceof File)) throw new ListingZipImportError('Choose a ZIP file.');
    return NextResponse.json(await importListingZip(context, form.get('templateId'), file));
  } catch (error) { return failure(error); }
}
