import { NextResponse } from 'next/server';
import { getEtsyOrdersForProcessing } from '@/lib/etsy-orders';

export const runtime = 'nodejs';

export async function GET() {
  try {
    return NextResponse.json({ orders: await getEtsyOrdersForProcessing() });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : 'Unable to load orders for processing.' }, { status: 500 });
  }
}
