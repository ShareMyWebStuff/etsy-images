import path from 'node:path';
import { NextResponse } from 'next/server';
import { getListingContext } from '@/lib/local-listings';
import { getListingDirectoryPath } from '@/lib/local-shop-directory';
import { prisma } from '@/lib/prisma';
import { readFile, readImagePreview } from '@/lib/s3-listing-storage';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const contentTypes: Record<string, string> = { '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp' };

export async function GET(request: Request) {
  const input = new URL(request.url).searchParams;
  const keys = ['shopId', 'sectionId', 'subSectionId', 'listingId'] as const;
  for (const key of keys) {
    const value = input.get(key);
    if (!value || !/^\d+$/.test(value) || BigInt(value) < 1n || (key !== 'shopId' && !Number.isSafeInteger(Number(value)))) {
      return NextResponse.json({ error: 'Missing or invalid listing context.' }, { status: 400 });
    }
  }
  try {
    const context = await getListingContext(input.get('shopId')!, input.get('sectionId')!, input.get('subSectionId')!);
    const sectionEtsyId = context.section.etsyShopSectionId === null ? null : Number(context.section.etsyShopSectionId);
    const listing = await prisma.etsyListing.findFirst({ where: {
      id: Number(input.get('listingId')), shopId: context.shop.etsyShopId.toString(), OR: [
        { subSectionId: context.subSection.id },
        ...(sectionEtsyId === null ? [] : [{ subSectionId: null, shopSectionId: sectionEtsyId }]),
      ],
    }, select: { id: true, localDirectoryName: true, thumbnailFileName: true } });
    if (!listing?.thumbnailFileName?.trim()) return NextResponse.json({ error: 'Artwork thumbnail not found.' }, { status: 404 });
    const name = listing.thumbnailFileName;
    const contentType = contentTypes[path.extname(name).toLowerCase()];
    if (path.basename(name) !== name || /[<>:"/\\|?*\x00-\x1F]/.test(name) || !contentType) {
      return NextResponse.json({ error: 'The artwork thumbnail filename is invalid.' }, { status: 404 });
    }
    const directory = getListingDirectoryPath(context.shop.displayName, context.section.title, context.subSection.name,
      listing.localDirectoryName ?? `Listing-${listing.id}`);
    const filePath = path.join(directory, 'thumbnail', name);
    const preview = input.get('preview') === '1';
    const contents = preview ? await readImagePreview(filePath) : await readFile(filePath);
    return new Response(new Uint8Array(contents), { headers: { 'Content-Type': preview ? 'image/webp' : contentType, 'Cache-Control': 'private, max-age=60' } });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : 'Unable to load the artwork thumbnail.' }, { status: 404 });
  }
}
