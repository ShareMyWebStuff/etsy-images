import { NextResponse } from 'next/server';

import {
  deleteOurCategoryImageTemplate,
  getOurCategoryImageTemplateDeletionImpact,
  updateOurCategoryImageTemplate,
} from '@/lib/our-categories';

export async function GET(_request: Request, { params }: { params: Promise<{ templateId: string }> }) {
  try {
    const { templateId } = await params;
    return NextResponse.json({ impact: await getOurCategoryImageTemplateDeletionImpact(templateId) });
  } catch (error) {
    console.error('Failed to inspect Our Category image template deletion:', error);
    return NextResponse.json({ error: error instanceof Error ? error.message : 'Unable to inspect the image template.' }, { status: 500 });
  }
}

export async function PUT(request: Request, { params }: { params: Promise<{ templateId: string }> }) {
  try {
    const { templateId } = await params;
    return NextResponse.json({ template: await updateOurCategoryImageTemplate(templateId, await request.formData()) });
  } catch (error) {
    console.error('Failed to update Our Category image template:', error);
    return NextResponse.json({ error: error instanceof Error ? error.message : 'Unable to update the image template.' }, { status: 500 });
  }
}

export async function DELETE(_request: Request, { params }: { params: Promise<{ templateId: string }> }) {
  try {
    const { templateId } = await params;
    return NextResponse.json(await deleteOurCategoryImageTemplate(templateId));
  } catch (error) {
    console.error('Failed to delete Our Category image template:', error);
    return NextResponse.json({ error: error instanceof Error ? error.message : 'Unable to delete the image template.' }, { status: 500 });
  }
}
