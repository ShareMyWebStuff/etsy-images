import { NextResponse } from 'next/server';
import { compareEtsyListings } from '@/lib/etsy-compare';

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as { firstId?: string; secondId?: string };
    if (!body.firstId || !/^\d+$/.test(body.firstId) || !body.secondId || !/^\d+$/.test(body.secondId)) {
      return NextResponse.json({ error: 'Enter two valid Etsy listing IDs.' }, { status: 400 });
    }
    return NextResponse.json({ data: await compareEtsyListings(body.firstId, body.secondId) });
  } catch (error) {
    console.error('Failed to compare Etsy listings:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Unable to compare Etsy listings.' },
      { status: 500 }
    );
  }
}
