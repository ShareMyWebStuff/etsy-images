import { NextResponse } from 'next/server';
import { ensureRegisteredEtsySectionExists } from '@/lib/local-shop-sections';
import { getSyncToEtsyData } from '@/lib/sync-to-etsy';

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as { shopId?: string; categoryId?: string };
    const categoryId = Number(body.categoryId);
    if (!body.shopId || !Number.isInteger(categoryId)) {
      return NextResponse.json({ error: 'Choose a template category to add to Etsy.' }, { status: 400 });
    }

    await ensureRegisteredEtsySectionExists(body.shopId, categoryId);
    return NextResponse.json({ data: await getSyncToEtsyData() });
  } catch (error) {
    console.error('Failed to add template category to Etsy:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Unable to add the template category to Etsy.' },
      { status: 500 },
    );
  }
}
