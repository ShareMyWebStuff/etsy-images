import { NextResponse } from 'next/server'; import { prisma } from '@/lib/prisma'; import { generatePinCopy, publicationKey } from '@/lib/pinterest/copy'; import { deletePin, publishPin } from '@/lib/pinterest/pins';
export async function GET(request: Request) {
  const url = new URL(request.url);
  const mode = url.searchParams.get('mode');

  if (mode === 'listings') {
    const listings = await prisma.etsyListing.findMany({
      where: { isLocal: true, pinterestPins: { none: {} } },
      orderBy: { updatedAt: 'desc' },
      include: {
        images: { orderBy: [{ rank: 'asc' }, { id: 'asc' }] },
        sourceSection: { select: { title: true } },
        subSection: { include: { shopSection: { select: { title: true, numberOfDownloads: true, includeAllDownloads: true } } } },
      },
    });
    const data = listings
      .map((listing) => ({
        id: listing.id,
        title: listing.title,
        state: listing.state,
        url: listing.url,
        section: listing.subSection?.shopSection.title ?? listing.sourceSection?.title ?? 'Uncategorised',
        subject: listing.sourceSection?.title ?? 'Uncategorised',
        showSubject: Boolean(listing.subSection?.shopSection.includeAllDownloads)
          || [3, 6, 12].includes(listing.subSection?.shopSection.numberOfDownloads ?? 1),
        images: listing.images.map((image) => ({
          id: image.id,
          rank: image.rank,
          url: image.url170x135 ?? image.url570xN ?? image.urlFullxFull,
        })),
      }))
      .sort((first, second) =>
        first.section.localeCompare(second.section, undefined, { sensitivity: 'base' })
        || first.title.localeCompare(second.title, undefined, { sensitivity: 'base' })
      );
    return NextResponse.json({ data });
  }

  const status = url.searchParams.get('status');
  const data = await prisma.pinterestPin.findMany({
    where: status ? { status } : undefined,
    orderBy: { createdAt: 'desc' },
    include: {
      listing: { select: { title: true } },
      board: { select: { name: true } },
      campaign: { select: { name: true } },
    },
    take: 300,
  });
  return NextResponse.json({ data });
}
export async function POST(request: Request) { try { const body = await request.json() as { action?: string; id?: number; listingId?: number; imageId?: number | null; boardId?: number; title?: string; description?: string; scheduledAt?: string | null; publishNow?: boolean; saveDraft?: boolean }; if (body.action === 'publish' && body.id) return NextResponse.json({ data: await publishPin(body.id) }); if (!body.listingId || !body.boardId) return NextResponse.json({ error: 'Listing and board are required.' }, { status: 400 }); if (!body.publishNow && !body.saveDraft && !body.scheduledAt) return NextResponse.json({ error: 'Choose a date and time to publish later.' }, { status: 400 }); const listing = await prisma.etsyListing.findUnique({ where: { id: body.listingId }, include: { sourceSection: true } }); if (!listing) return NextResponse.json({ error: 'Listing not found.' }, { status: 404 }); const copy = generatePinCopy(listing, listing.sourceSection?.title); const scheduledAt = body.publishNow || body.saveDraft ? null : new Date(body.scheduledAt!); if (scheduledAt && Number.isNaN(scheduledAt.getTime())) return NextResponse.json({ error: 'Choose a valid publishing date and time.' }, { status: 400 }); const pin = await prisma.pinterestPin.create({ data: { listingId: listing.id, imageId: body.imageId, boardId: body.boardId, title: (body.title || copy.title).slice(0, 100), description: body.description || copy.description, destinationUrl: listing.url, status: body.publishNow || body.saveDraft ? 'DRAFT' : 'SCHEDULED', scheduledAt, publicationKey: publicationKey(listing.id, body.imageId ?? null, body.boardId, scheduledAt) } }); const result = body.publishNow ? await publishPin(pin.id) : pin; return NextResponse.json({ data: result }, { status: 201 }); } catch (error) { return NextResponse.json({ error: error instanceof Error ? error.message : 'Pin could not be saved.' }, { status: 400 }); } }
export async function DELETE(request: Request) { try { const body = await request.json() as { id?: number }; if (!body.id) return NextResponse.json({ error: 'Pin id is required.' }, { status: 400 }); return NextResponse.json({ data: await deletePin(body.id) }); } catch (error) { return NextResponse.json({ error: error instanceof Error ? error.message : 'Pin could not be deleted.' }, { status: 400 }); } }
export async function PATCH(request: Request) { try { const body = await request.json() as { id: number; status?: string; scheduledAt?: string; title?: string; description?: string }; const pin = await prisma.pinterestPin.update({ where: { id: body.id }, data: { status: body.status, scheduledAt: body.scheduledAt ? new Date(body.scheduledAt) : undefined, title: body.title?.slice(0, 100), description: body.description, error: body.status === 'SCHEDULED' ? null : undefined } }); return NextResponse.json({ data: pin }); } catch (error) { return NextResponse.json({ error: error instanceof Error ? error.message : 'Pin update failed.' }, { status: 400 }); } }
