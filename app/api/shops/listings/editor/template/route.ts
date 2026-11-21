import { NextResponse } from 'next/server';
import { assignListingTemplate, getListingTemplateOptions, listingTemplateContext, ListingTemplateAssignmentError } from '@/lib/listing-template-assignment';

export const dynamic = 'force-dynamic';

function failure(error: unknown) {
  return NextResponse.json({ error: error instanceof Error ? error.message : 'Unable to change the listing template.' },
    { status: error instanceof ListingTemplateAssignmentError ? error.status : 500 });
}

export async function GET(request: Request) {
  try {
    const context = listingTemplateContext(Object.fromEntries(new URL(request.url).searchParams));
    return NextResponse.json(await getListingTemplateOptions(context), { headers: { 'Cache-Control': 'no-store' } });
  } catch (error) { return failure(error); }
}

export async function PUT(request: Request) {
  try {
    let input: unknown;
    try { input = await request.json(); }
    catch { throw new ListingTemplateAssignmentError('Invalid template assignment request.'); }
    if (!input || typeof input !== 'object' || Array.isArray(input)) throw new ListingTemplateAssignmentError('Invalid template assignment request.');
    const body = input as Record<string, unknown>;
    const data = await assignListingTemplate(listingTemplateContext(body), body.templateId);
    return NextResponse.json({ data });
  } catch (error) { return failure(error); }
}
