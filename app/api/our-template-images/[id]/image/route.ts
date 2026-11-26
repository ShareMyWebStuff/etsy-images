import { NextResponse } from 'next/server';
import { fileContentDisposition } from '@/lib/file-content-disposition';
import { getOurTemplateImageFile, getStoredOurTemplateImage } from '@/lib/our-template-images';
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const query = new URL(request.url).searchParams;
    const { id } = await params;
    const download = query.get('download') === '1';
    const preview = !download && query.get('preview') === '1';
    const stored = download ? await getStoredOurTemplateImage(id) : null;
    const fileName = stored?.originalFileName.replace(/[\u0000-\u001f\u007f]/g, '').trim() || `${id}.png`;
    const contents = await getOurTemplateImageFile(id, preview);
    return new Response(new Uint8Array(contents), {
      headers: {
        'Content-Type': preview ? 'image/webp' : 'image/png',
        ...(download ? { 'Content-Disposition': fileContentDisposition('attachment', fileName) } : {}),
        // Saved-image URLs include updatedAt, so replacements receive a new cache key.
        'Cache-Control': download ? 'private, no-store' : query.get('v')?.trim() ? 'private, max-age=86400' : 'private, no-cache',
      },
    });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : 'Template image not found.' }, { status: 404 });
  }
}
