import { NextResponse } from 'next/server';

import { fileContentDisposition } from '@/lib/file-content-disposition';
import { getOurCategoryTemplateImage } from '@/lib/our-categories';

export async function GET(request: Request, { params }: { params: Promise<{ templateId: string }> }) {
  try {
    const { templateId } = await params;
    const query = new URL(request.url).searchParams;
    const orientation = query.get('orientation');
    if (orientation !== null && orientation !== 'portrait' && orientation !== 'landscape') throw new Error('Choose Portrait or Landscape.');
    const image = orientation ? await getOurCategoryTemplateImage(templateId, query.get('preview') === '1', orientation)
      : await getOurCategoryTemplateImage(templateId, query.get('preview') === '1');
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
