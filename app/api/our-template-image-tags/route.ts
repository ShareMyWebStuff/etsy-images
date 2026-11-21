import { NextResponse } from 'next/server';

import { createTemplateImageTag, getTemplateImageTags } from '@/lib/our-template-image-tags';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET() {
  try { return NextResponse.json({ tags: await getTemplateImageTags() }); }
  catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : 'Unable to load template image tags.' }, { status: 500 });
  }
}

export async function POST(request: Request) {
  try {
    const body = await request.json() as { name?: unknown };
    return NextResponse.json({ tag: await createTemplateImageTag(body?.name) });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : 'Unable to create the tag.' }, { status: 400 });
  }
}
