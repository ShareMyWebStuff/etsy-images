import { NextResponse } from 'next/server';

import { resendEtsyOrder, searchEtsyOrdersForResend } from '@/lib/etsy-orders';

export const runtime = 'nodejs';

export async function GET(request: Request) {
  try {
    const query = new URL(request.url).searchParams.get('q') ?? '';
    return NextResponse.json({ orders: await searchEtsyOrdersForResend(query) });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Unable to search Etsy orders.' },
      { status: 500 },
    );
  }
}

export async function POST(request: Request) {
  try {
    const body = await request.json() as { orderId?: string; confirmation?: string };
    return NextResponse.json(await resendEtsyOrder(body.orderId ?? '', body.confirmation ?? ''));
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Unable to resend the PrintShrimp order.' },
      { status: 400 },
    );
  }
}
