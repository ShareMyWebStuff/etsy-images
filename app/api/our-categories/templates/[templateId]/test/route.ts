import { NextResponse } from 'next/server';

import { testOurCategoryImageTemplate } from '@/lib/our-categories';

export async function POST(request: Request, { params }: { params: Promise<{ templateId: string }> }) {
  try {
    const { templateId } = await params;
    const formData = await request.formData();
    const uploadedFiles = formData.getAll('files').filter((value): value is File => value instanceof File);
    const singleFile = formData.get('file');
    const files = uploadedFiles.length > 0
      ? uploadedFiles
      : singleFile instanceof File ? [singleFile] : [];
    const result = await testOurCategoryImageTemplate(templateId, files);
    return new Response(new Uint8Array(result), {
      headers: {
        'Content-Type': 'image/png',
        'Cache-Control': 'no-store',
      },
    });
  } catch (error) {
    console.error('Failed to test Our Category image template:', error);
    return NextResponse.json({ error: error instanceof Error ? error.message : 'Unable to test the image template.' }, { status: 500 });
  }
}
