import { NextResponse } from 'next/server';
import { getEtsyReturnPolicies } from '@/lib/local-listings';

export async function GET(request: Request) {
  try {
    const shopId = new URL(request.url).searchParams.get('shopId');
    if (!shopId) return NextResponse.json({ error: 'Missing shopId.' }, { status: 400 });
    return NextResponse.json({ policies: await getEtsyReturnPolicies(shopId) });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Unable to load Etsy return policies.' },
      { status: 500 }
    );
  }
}
