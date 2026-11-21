import { NextResponse } from 'next/server';
import { getOurTemplateImageFile } from '@/lib/our-template-images';
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const query = new URL(request.url).searchParams;
    const preview = query.get('preview') === '1';
    const contents = await getOurTemplateImageFile((await params).id, preview);
    return new Response(new Uint8Array(contents), {
      headers: {
        'Content-Type': preview ? 'image/webp' : 'image/png',
        // Saved-image URLs include updatedAt, so replacements receive a new cache key.
        'Cache-Control': query.get('v')?.trim() ? 'private, max-age=86400' : 'private, no-cache',
      },
    });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : 'Template image not found.' }, { status: 404 });
  }
}
