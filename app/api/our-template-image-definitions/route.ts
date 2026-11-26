import { NextResponse } from 'next/server';
import { createOurTemplateImageDefinition, getOurTemplateImageDefinitions } from '@/lib/our-template-image-definitions';
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export async function GET() {
  try { return NextResponse.json({ definitions: await getOurTemplateImageDefinitions() }); }
  catch (error) { return NextResponse.json({ error: error instanceof Error ? error.message : 'Unable to load template image definitions.' }, { status: 500 }); }
}
export async function POST(request: Request) {
  try { return NextResponse.json({ definition: await createOurTemplateImageDefinition(await request.json()) }, { status: 201 }); }
  catch (error) { return NextResponse.json({ error: error instanceof Error ? error.message : 'Unable to create template image definition.' }, { status: 400 }); }
}
