import { NextResponse } from 'next/server';

import { getEtsyOrdersPageData, syncEtsyOrders } from '@/lib/etsy-orders';

export const runtime = 'nodejs';

export async function GET() {
  try {
    return NextResponse.json(await getEtsyOrdersPageData());
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Unable to load Etsy orders.' },
      { status: 500 },
    );
  }
}

export async function POST() {
  try {
    const summary = await syncEtsyOrders();
    return NextResponse.json({ summary, data: await getEtsyOrdersPageData() });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unable to download Etsy orders.';
    const status = /connect etsy|authorization|scope|transactions_/i.test(message) ? 403 : 502;
    return NextResponse.json({ error: message }, { status });
  }
}
