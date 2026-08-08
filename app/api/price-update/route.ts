import { NextResponse } from 'next/server';
import { updateSectionPrices } from '@/lib/price-update';

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as { sectionId?: string; priceAmount?: number };
    if (!body.sectionId || body.priceAmount === undefined) {
      return NextResponse.json({ error: 'Choose a section and price.' }, { status: 400 });
    }
    return NextResponse.json({ result: await updateSectionPrices(body.sectionId, body.priceAmount) });
  } catch (error) {
    console.error('Failed to update subsection prices:', error);
    return NextResponse.json({ error: error instanceof Error ? error.message : 'Unable to update prices.' }, { status: 500 });
  }
}
