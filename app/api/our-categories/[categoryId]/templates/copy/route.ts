import { NextResponse } from 'next/server';

import { copyOurCategoryImageTemplate } from '@/lib/our-categories';

export async function POST(request: Request, context: { params: Promise<{ categoryId: string }> }) {
  try {
    const { categoryId } = await context.params;
    const body = await request.json() as { sourceCategoryId?: string; sourceTemplateId?: string; imageItemNumbers?: unknown };
    if (typeof body.sourceCategoryId !== 'string' || typeof body.sourceTemplateId !== 'string') {
      return NextResponse.json({ error: 'Choose a source template and image template.' }, { status: 400 });
    }
    return NextResponse.json({
      template: await copyOurCategoryImageTemplate(
        categoryId,
        body.sourceCategoryId,
        body.sourceTemplateId,
        body.imageItemNumbers,
      ),
    });
  } catch (error) {
    console.error('Failed to copy a followed image template:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Unable to copy the image template.' },
      { status: 500 },
    );
  }
}
