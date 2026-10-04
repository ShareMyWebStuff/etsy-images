import { NextResponse } from 'next/server';

import {
  createPrintShrimpOrderPreview,
  type PrintShrimpOrderPreviewInput,
} from '@/lib/printshrimp/orders';

export const runtime = 'nodejs';

export async function POST(request: Request) {
  try {
    const input = await request.json() as PrintShrimpOrderPreviewInput;
    const { customArtwork: _customArtwork, ...preview } = await createPrintShrimpOrderPreview(input);
    return NextResponse.json(preview);
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Unable to prepare the PrintShrimp order.' },
      { status: 400 },
    );
  }
}
