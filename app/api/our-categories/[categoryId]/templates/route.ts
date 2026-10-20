import { NextResponse } from 'next/server';

import { createOurCategoryImageTemplate } from '@/lib/our-categories';

export async function POST(request: Request, { params }: { params: Promise<{ categoryId: string }> }) {
  try {
    const { categoryId } = await params;
    return NextResponse.json({ template: await createOurCategoryImageTemplate(categoryId, await request.formData()) });
  } catch (error) {
    console.error('Failed to create Our Category image template:', error);
    return NextResponse.json({ error: error instanceof Error ? error.message : 'Unable to create the image template.' }, { status: 500 });
  }
}
