import { NextResponse } from 'next/server';
import { EtsyDeliveryError } from '@/lib/etsy-delivery-api';
import { MarketsDeliveryError } from '@/lib/markets-delivery-core';
import type { ListingEditorContext } from '@/lib/listing-editor';

export function deliveryParameter(value: unknown, label: string): string {
  if (typeof value !== 'string' || !/^\d{1,20}$/.test(value) || BigInt(value) < 1n) throw new MarketsDeliveryError(`Choose a valid ${label}.`);
  return value;
}

export function deliveryListingContext(values: Record<string, unknown>): ListingEditorContext {
  return {
    shopId: deliveryParameter(values.shopId, 'shop'),
    sectionId: deliveryParameter(values.sectionId, 'section'),
    subSectionId: deliveryParameter(values.subSectionId, 'subsection'),
    listingId: deliveryParameter(values.listingId, 'listing'),
  };
}

export async function deliveryMutationBody(request: Request): Promise<Record<string, unknown>> {
  const origin = request.headers.get('origin');
  if ((origin && origin !== new URL(request.url).origin) || request.headers.get('sec-fetch-site') === 'cross-site') {
    throw new MarketsDeliveryError('This change must be made from this application.', 403);
  }
  if (!request.headers.get('content-type')?.toLowerCase().startsWith('application/json')) throw new MarketsDeliveryError('Send delivery settings as JSON.', 415);
  if (Number(request.headers.get('content-length')) > 200000) throw new MarketsDeliveryError('Delivery settings are too large.', 413);
  const text = await request.text();
  if (text.length > 200000) throw new MarketsDeliveryError('Delivery settings are too large.', 413);
  let body: unknown;
  try { body = JSON.parse(text); } catch { throw new MarketsDeliveryError('Delivery settings contain invalid JSON.'); }
  if (!body || typeof body !== 'object' || Array.isArray(body)) throw new MarketsDeliveryError('Choose valid delivery settings.');
  return body as Record<string, unknown>;
}

export function deliveryHttpError(error: unknown) {
  if (error instanceof MarketsDeliveryError) return NextResponse.json({ error: error.message }, { status: error.status });
  if (error instanceof EtsyDeliveryError) {
    const status = error.code === 'authentication' ? 401 : error.code === 'permission' ? 403
      : error.code === 'rate_limit' ? 429 : error.code === 'conflict' || error.code === 'ambiguous_create' ? 409
        : error.code === 'validation' ? 400 : 502;
    return NextResponse.json({ error: error.message }, { status, headers: error.retryAfterSeconds ? { 'Retry-After': String(error.retryAfterSeconds) } : undefined });
  }
  return NextResponse.json({ error: 'Unable to complete Markets & Delivery. Local changes remain saved; refresh and retry.' }, { status: 500 });
}
