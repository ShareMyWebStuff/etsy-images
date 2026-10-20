import { NextResponse } from 'next/server';

import { createOurCategory, getOurCategories } from '@/lib/our-categories';

export async function GET() {
  try {
    return NextResponse.json({ categories: await getOurCategories() });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : 'Unable to load Our Templates.' }, { status: 500 });
  }
}

export async function POST(request: Request) {
  try {
    return NextResponse.json({ data: await createOurCategory(await request.json()) });
  } catch (error) {
    console.error('Failed to create Our Category:', error);
    return NextResponse.json({ error: error instanceof Error ? error.message : 'Unable to create Our Template.' }, { status: 500 });
  }
}
