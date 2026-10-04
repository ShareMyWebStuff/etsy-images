import { NextResponse } from 'next/server';

import { getEtsyOrderDetails } from '@/lib/etsy-orders';

export const runtime = 'nodejs';

export async function GET(_request: Request, context: { params: Promise<{ orderId: string }> }) {
  try {
    const { orderId } = await context.params;
    return NextResponse.json(await getEtsyOrderDetails(orderId));
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Unable to load the Etsy order.' },
      { status: 400 },
    );
  }
}
