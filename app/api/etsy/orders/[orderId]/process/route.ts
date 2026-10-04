import { NextResponse } from 'next/server';

import { processEtsyOrder } from '@/lib/etsy-orders';

export const runtime = 'nodejs';

export async function POST(_request: Request, context: { params: Promise<{ orderId: string }> }) {
  try {
    const { orderId } = await context.params;
    return NextResponse.json(await processEtsyOrder(orderId));
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unable to process the Etsy order.';
    const status = /already been sent|already been.*attempt/i.test(message) ? 409 : 400;
    return NextResponse.json({ error: message }, { status });
  }
}
