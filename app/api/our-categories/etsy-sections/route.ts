import { NextResponse } from 'next/server';

import { createOurCategoryEtsySection } from '@/lib/our-categories';
import type { EtsySectionUsage } from '@/lib/local-shop-sections';

export async function POST(request: Request) {
  try {
    const body = await request.json() as { shopId?: string; title?: string; usages?: EtsySectionUsage[] };
    if (!body.shopId || typeof body.title !== 'string' || !Array.isArray(body.usages)) {
      return NextResponse.json({ error: 'Enter an Etsy section name.' }, { status: 400 });
    }
    return NextResponse.json({
      section: await createOurCategoryEtsySection(body.shopId, body.title, body.usages),
    });
  } catch (error) {
    console.error('Failed to create an Our Category Etsy section:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Unable to create the Etsy section.' },
      { status: 500 },
    );
  }
}
