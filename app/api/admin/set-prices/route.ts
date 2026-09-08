import { NextResponse } from 'next/server';

import { getSetPricesData, saveProductPrices } from '@/lib/set-prices';

export async function GET() {
  try {
    return NextResponse.json({ data: await getSetPricesData() });
  } catch (error) {
    console.error('Failed to load Set Prices:', error);
    return NextResponse.json({ error: error instanceof Error ? error.message : 'Unable to load prices.' }, { status: 500 });
  }
}

export async function PUT(request: Request) {
  try {
    const body = (await request.json()) as { prices?: unknown };
    return NextResponse.json({ result: await saveProductPrices(body.prices) });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unable to save prices.';
    return NextResponse.json({ error: message }, { status: /price|product|submit|GBP/i.test(message) ? 400 : 500 });
  }
}
