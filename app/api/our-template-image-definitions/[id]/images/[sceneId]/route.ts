import { NextResponse } from 'next/server';
import { deleteOurTemplateImageDefinitionImage, getOurTemplateImageDefinition } from '@/lib/our-template-image-definitions';
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export async function DELETE(_request: Request, { params }: { params: Promise<{ id: string; sceneId: string }> }) {
  try {
    const { id, sceneId } = await params;
    const result = await deleteOurTemplateImageDefinitionImage(id, sceneId);
    try { return NextResponse.json({ ...result, definition: await getOurTemplateImageDefinition(id) }); }
    catch (error) {
      return NextResponse.json({ ...result,
        refreshError: `The image was deleted, but the definition could not be reloaded. Reload this page. ${error instanceof Error ? error.message : ''}` });
    }
  }
  catch (error) { return NextResponse.json({ error: error instanceof Error ? error.message : 'Unable to remove definition image.' }, { status: 400 }); }
}
