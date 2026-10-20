import { NextResponse } from 'next/server';

import { linkFollowedOurCategoryImageTemplate } from '@/lib/our-categories';

export async function POST(request: Request, context: { params: Promise<{ categoryId: string }> }) {
  try {
    const { categoryId } = await context.params;
    const body = await request.json() as { sourceTemplateId?: string; imageItemNumber?: number };
    if (typeof body.sourceTemplateId !== 'string') {
      return NextResponse.json({ error: 'Choose an image template from the Followed Template.' }, { status: 400 });
    }
    return NextResponse.json({
      template: await linkFollowedOurCategoryImageTemplate(categoryId, body.sourceTemplateId, body.imageItemNumber),
    });
  } catch (error) {
    console.error('Failed to link a followed image template:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Unable to link the followed image template.' },
      { status: 500 },
    );
  }
}
