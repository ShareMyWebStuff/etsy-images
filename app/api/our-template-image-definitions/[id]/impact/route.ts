import { NextResponse } from 'next/server';
import { getOurTemplateImageDefinitionDeletionImpact } from '@/lib/our-template-image-definitions';
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  try { return NextResponse.json({ impact: await getOurTemplateImageDefinitionDeletionImpact((await params).id) }); }
  catch (error) { return NextResponse.json({ error: error instanceof Error ? error.message : 'Unable to inspect template image definition.' }, { status: 404 }); }
}
