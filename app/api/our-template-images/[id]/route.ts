import { NextResponse } from 'next/server';
import { deleteOurTemplateImage, getOurTemplateImage, updateOurTemplateImage } from '@/lib/our-template-images';
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
type Context = { params: Promise<{ id: string }> };
export async function GET(_request: Request, { params }: Context) {
  try { return NextResponse.json({ image: await getOurTemplateImage((await params).id) }); }
  catch (error) { return NextResponse.json({ error: error instanceof Error ? error.message : 'Template image not found.' }, { status: 404 }); }
}
export async function PATCH(request: Request, { params }: Context) {
  try { return NextResponse.json({ image: await updateOurTemplateImage((await params).id, await request.formData()) }); }
  catch (error) { return NextResponse.json({ error: error instanceof Error ? error.message : 'Unable to save template image.' }, { status: 400 }); }
}
export async function DELETE(_request: Request, { params }: Context) {
  try { return NextResponse.json(await deleteOurTemplateImage((await params).id)); }
  catch (error) { return NextResponse.json({ error: error instanceof Error ? error.message : 'Unable to delete template image.' }, { status: 400 }); }
}
