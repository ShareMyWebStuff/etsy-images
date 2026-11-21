import { NextResponse } from 'next/server';
import { getOurTemplateArtworkOptions } from '@/lib/our-template-images';
export const dynamic = 'force-dynamic';
export async function GET() {
  try { return NextResponse.json({ artworks: await getOurTemplateArtworkOptions() }); }
  catch (error) { return NextResponse.json({ error: error instanceof Error ? error.message : 'Unable to load artwork.' }, { status: 500 }); }
}
