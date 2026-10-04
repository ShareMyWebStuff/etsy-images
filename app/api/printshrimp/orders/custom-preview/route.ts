import {
  generatePrintShrimpCustomArtworkPreview,
  type PrintShrimpCustomArtworkPreviewInput,
} from '@/lib/printshrimp/orders';

export const runtime = 'nodejs';

export async function POST(request: Request) {
  try {
    const input = await request.json() as PrintShrimpCustomArtworkPreviewInput;
    const preview = await generatePrintShrimpCustomArtworkPreview(input);
    return new Response(new Uint8Array(preview.buffer), {
      status: 200,
      headers: {
        'Content-Type': 'image/jpeg',
        'Content-Disposition': `inline; filename="${preview.fileName}"`,
        'Cache-Control': 'no-store',
      },
    });
  } catch (error) {
    return Response.json(
      { error: error instanceof Error ? error.message : 'Unable to generate the custom artwork preview.' },
      { status: 400 },
    );
  }
}
