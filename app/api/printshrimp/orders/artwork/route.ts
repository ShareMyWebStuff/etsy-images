import { NextRequest, NextResponse } from 'next/server';

import { getPrintShrimpOrderArtworkUrl } from '@/lib/printshrimp/orders';

export const runtime = 'nodejs';

export async function GET(request: NextRequest) {
  try {
    const listingId = request.nextUrl.searchParams.get('listingId') ?? '';
    const size = request.nextUrl.searchParams.get('size') ?? '';
    return NextResponse.json(await getPrintShrimpOrderArtworkUrl(listingId, size));
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Unable to resolve the Dropbox artwork URL.' },
      { status: 400 },
    );
  }
}
