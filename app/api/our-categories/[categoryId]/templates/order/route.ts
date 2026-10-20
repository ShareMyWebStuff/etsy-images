import { NextResponse } from 'next/server';

import { reorderOurCategoryImageTemplates } from '@/lib/our-categories';

export async function PUT(request: Request, { params }: { params: Promise<{ categoryId: string }> }) {
  try {
    const { categoryId } = await params;
    const body = await request.json() as { templateIds?: unknown };
    return NextResponse.json({
      templateIds: await reorderOurCategoryImageTemplates(categoryId, body.templateIds),
    });
  } catch (error) {
    console.error('Failed to reorder Our Category image templates:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Unable to save the image-template order.' },
      { status: 500 },
    );
  }
}
