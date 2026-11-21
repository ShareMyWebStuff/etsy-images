import { NextResponse } from 'next/server';
import { createOurTemplateImage, getOurTemplateImages } from '@/lib/our-template-images';
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export async function GET() {
  try { return NextResponse.json({ images: await getOurTemplateImages() }); }
  catch (error) { return NextResponse.json({ error: error instanceof Error ? error.message : 'Unable to load template images.' }, { status: 500 }); }
}
export async function POST(request: Request) {
  try { return NextResponse.json({ image: await createOurTemplateImage(await request.formData()) }, { status: 201 }); }
  catch (error) { return NextResponse.json({ error: error instanceof Error ? error.message : 'Unable to create template image.' }, { status: 400 }); }
}
