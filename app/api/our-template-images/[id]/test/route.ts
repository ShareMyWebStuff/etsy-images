import { NextResponse } from 'next/server';
import { testOurTemplateImage } from '@/lib/our-template-images';
export const runtime = 'nodejs';
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try { return new Response(new Uint8Array(await testOurTemplateImage((await params).id, await request.formData())), { headers: { 'Content-Type': 'image/png', 'Cache-Control': 'no-store' } }); }
  catch (error) { return NextResponse.json({ error: error instanceof Error ? error.message : 'Unable to test template image.' }, { status: 400 }); }
}
