import { NextResponse } from 'next/server';
import { deleteOurTemplateImageDefinition, getOurTemplateImageDefinition, updateOurTemplateImageDefinition } from '@/lib/our-template-image-definitions';
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
type Context = { params: Promise<{ id: string }> };
export async function GET(_request: Request, { params }: Context) {
  try { return NextResponse.json({ definition: await getOurTemplateImageDefinition((await params).id) }); }
  catch (error) { return NextResponse.json({ error: error instanceof Error ? error.message : 'Template image definition not found.' }, { status: 404 }); }
}
export async function PATCH(request: Request, { params }: Context) {
  try { return NextResponse.json({ definition: await updateOurTemplateImageDefinition((await params).id, await request.json()) }); }
  catch (error) { return NextResponse.json({ error: error instanceof Error ? error.message : 'Unable to save template image definition.' }, { status: 400 }); }
}
export async function DELETE(_request: Request, { params }: Context) {
  try { return NextResponse.json(await deleteOurTemplateImageDefinition((await params).id)); }
  catch (error) { return NextResponse.json({ error: error instanceof Error ? error.message : 'Unable to delete template image definition.' }, { status: 400 }); }
}
