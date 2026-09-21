import { NextResponse } from 'next/server';
import { createEtsyDownloadSection, getEtsyDownloadSections } from '@/lib/local-shop-sections';

export async function GET(request: Request) {
  const shopId = new URL(request.url).searchParams.get('shopId');
  if (!shopId) return NextResponse.json({ error: 'Missing shop id.' }, { status: 400 });
  try {
    return NextResponse.json({ sections: await getEtsyDownloadSections(shopId) });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : 'Unable to load Etsy sections.' }, { status: 500 });
  }
}

export async function POST(request: Request) {
  try {
    const body = await request.json() as { shopId?: string; title?: string };
    if (!body.shopId || typeof body.title !== 'string') {
      return NextResponse.json({ error: 'Enter a download section name.' }, { status: 400 });
    }
    return NextResponse.json({ section: await createEtsyDownloadSection(body.shopId, body.title) });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : 'Unable to create Etsy section.' }, { status: 500 });
  }
}
