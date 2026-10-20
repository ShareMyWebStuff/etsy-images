import { generateListingPersonalisationPreview, type ListingEditorContext } from '@/lib/listing-editor';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 300;

type PreviewRequest = Partial<ListingEditorContext> & {
  sizeKey?: string;
  topText?: unknown;
  bottomText?: unknown;
  fontId?: unknown;
  borderEnabled?: unknown;
  borderSizePercent?: unknown;
};

function contextFrom(value: PreviewRequest): ListingEditorContext {
  if (!value.shopId || !value.sectionId || !value.subSectionId || !value.listingId) {
    throw new Error('Missing listing context.');
  }
  return {
    shopId: value.shopId,
    sectionId: value.sectionId,
    subSectionId: value.subSectionId,
    listingId: value.listingId,
  };
}

export async function POST(request: Request) {
  try {
    const body = await request.json() as PreviewRequest;
    if (!body.sizeKey) throw new Error('Choose a paper size.');
    if (typeof body.borderEnabled !== 'boolean') throw new Error('Choose whether to include a border.');
    const borderSizePercent = Number(body.borderSizePercent);
    if (!Number.isFinite(borderSizePercent)) throw new Error('Choose a valid border size.');
    const preview = await generateListingPersonalisationPreview(contextFrom(body), {
      sizeKey: body.sizeKey,
      topText: body.topText,
      bottomText: body.bottomText,
      fontId: body.fontId,
      borderEnabled: body.borderEnabled,
      borderSizePercent,
    });
    return new Response(new Uint8Array(preview.buffer), {
      headers: {
        'Content-Type': 'image/webp',
        'Cache-Control': 'no-store',
        'X-Image-Width': String(preview.width),
        'X-Image-Height': String(preview.height),
      },
    });
  } catch (error) {
    return Response.json(
      { error: error instanceof Error ? error.message : 'Unable to generate the paper-size image preview.' },
      { status: 400 },
    );
  }
}
