import { NextResponse } from 'next/server';

import { deleteOurCategory, updateOurCategory } from '@/lib/our-categories';

type RouteContext = { params: Promise<{ categoryId: string }> };

export async function PUT(request: Request, { params }: RouteContext) {
  try {
    const { categoryId } = await params;
    return NextResponse.json({ data: await updateOurCategory(categoryId, await request.json()) });
  } catch (error) {
    console.error('Failed to update Our Category:', error);
    return NextResponse.json({ error: error instanceof Error ? error.message : 'Unable to update Our Template.' }, { status: 500 });
  }
}

export async function DELETE(_request: Request, { params }: RouteContext) {
  try {
    const { categoryId } = await params;
    return NextResponse.json({ categories: await deleteOurCategory(categoryId) });
  } catch (error) {
    console.error('Failed to delete Our Category:', error);
    return NextResponse.json({ error: error instanceof Error ? error.message : 'Unable to delete Our Template.' }, { status: 500 });
  }
}
