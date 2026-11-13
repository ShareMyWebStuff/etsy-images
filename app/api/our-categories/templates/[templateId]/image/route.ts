import { NextResponse } from 'next/server';

import { fileContentDisposition } from '@/lib/file-content-disposition';
import { getOurCategoryTemplateImage } from '@/lib/our-categories';

export async function GET(request: Request, { params }: { params: Promise<{ templateId: string }> }) {
  try {
    const { templateId } = await params;
    const image = await getOurCategoryTemplateImage(templateId, new URL(request.url).searchParams.get('preview') === '1');
    return new Response(new Uint8Array(image.contents), {
      headers: {
        'Content-Type': image.contentType,
        'Content-Disposition': fileContentDisposition('inline', image.fileName),
        'Cache-Control': 'private, max-age=60',
      },
    });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : 'Unable to load the image template.' }, { status: 404 });
  }
}
