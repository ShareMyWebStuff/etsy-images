import { NextResponse } from 'next/server';
import { getOurTemplateImageDeletionImpact } from '@/lib/our-template-images';
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  try { return NextResponse.json(await getOurTemplateImageDeletionImpact((await params).id)); }
  catch (error) { return NextResponse.json({ error: error instanceof Error ? error.message : 'Unable to check dependencies.' }, { status: 400 }); }
}
