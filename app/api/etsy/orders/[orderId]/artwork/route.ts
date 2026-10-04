import { NextResponse } from 'next/server';

import { generateEtsyOrderArtwork } from '@/lib/etsy-orders';

export const runtime = 'nodejs';

export async function POST(_request: Request, context: { params: Promise<{ orderId: string }> }) {
  try {
    const { orderId } = await context.params;
    return NextResponse.json(await generateEtsyOrderArtwork(orderId));
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Unable to generate the customised artwork.' },
      { status: 400 },
    );
  }
}
