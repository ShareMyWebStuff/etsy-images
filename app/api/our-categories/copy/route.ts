import { NextResponse } from 'next/server';
import { copyOurTemplateImages, getOurCategories } from '@/lib/our-categories';

export async function POST(request: Request) {
  try {
    const body = await request.json() as { sourceCategoryId?: unknown; targetCategoryId?: unknown };
    if (typeof body.sourceCategoryId !== 'string' || typeof body.targetCategoryId !== 'string') {
      return NextResponse.json({ error: 'Choose Copy From and Copy To templates.' }, { status: 400 });
    }
    await copyOurTemplateImages(body.sourceCategoryId, body.targetCategoryId);
    return NextResponse.json({ categories: await getOurCategories() });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : 'Unable to copy template.' }, { status: 400 });
  }
}
