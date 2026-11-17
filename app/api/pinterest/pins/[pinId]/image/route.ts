import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { imageMediaSource } from '@/lib/pinterest/pins';

export async function GET(_request: Request, context: { params: Promise<{ pinId: string }> }) {
  const { pinId: rawId } = await context.params;
  const pinId = Number(rawId);
  if (!/^[1-9]\d*$/.test(rawId) || !Number.isSafeInteger(pinId)) {
    return NextResponse.json({ error: 'A valid Pin is required.' }, { status: 400 });
  }
  const pin = await prisma.pinterestPin.findUnique({ where: { id: pinId }, select: { listingId: true, imageId: true } });
  if (!pin) return NextResponse.json({ error: 'Pin not found.' }, { status: 404 });
  try {
    const source = await imageMediaSource(pin.listingId, pin.imageId, pinId);
    if (source.source_type === 'image_url') return NextResponse.redirect(source.url);
    return new Response(new Uint8Array(Buffer.from(source.data, 'base64')), {
      headers: { 'Content-Type': source.content_type, 'Cache-Control': 'private, no-store' },
    });
  } catch {
    return NextResponse.json({ error: 'The Pin image is unavailable.' }, { status: 404 });
  }
}
