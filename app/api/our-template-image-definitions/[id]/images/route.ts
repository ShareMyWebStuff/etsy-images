import { NextResponse } from 'next/server';
import { createOurTemplateImageDefinitionImage } from '@/lib/our-template-image-definitions';
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try { return NextResponse.json(await createOurTemplateImageDefinitionImage((await params).id, await request.formData()), { status: 201 }); }
  catch (error) { return NextResponse.json({ error: error instanceof Error ? error.message : 'Unable to save template image.' }, { status: 400 }); }
}
