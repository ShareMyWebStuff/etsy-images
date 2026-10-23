import { NextResponse } from 'next/server';

import { duplicateOurCategoryImageTemplate } from '@/lib/our-categories';

export async function POST(_request: Request, { params }: { params: Promise<{ templateId: string }> }) {
  try {
    const { templateId } = await params;
    return NextResponse.json({ template: await duplicateOurCategoryImageTemplate(templateId) });
  } catch (error) {
    console.error('Failed to make a copy of the image template:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Unable to make a copy of the image template.' },
      { status: 500 },
    );
  }
}
