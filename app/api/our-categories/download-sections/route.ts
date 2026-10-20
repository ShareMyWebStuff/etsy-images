import { NextResponse } from 'next/server';

import { createOurCategoryDownloadSection } from '@/lib/our-categories';

export async function POST(request: Request) {
  try {
    const body = await request.json() as { shopId?: string; title?: string };
    if (!body.shopId || typeof body.title !== 'string') {
      return NextResponse.json({ error: 'Enter a download section name.' }, { status: 400 });
    }
    return NextResponse.json({ section: await createOurCategoryDownloadSection(body.shopId, body.title) });
  } catch (error) {
    console.error('Failed to create an Our Category download section:', error);
    return NextResponse.json({ error: error instanceof Error ? error.message : 'Unable to create the download section.' }, { status: 500 });
  }
}
