import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { publicationKey } from '@/lib/pinterest/copy';
import { deletePin, publishPin } from '@/lib/pinterest/pins';
import { loadPinCreativeStorageKeys } from '@/lib/pinterest/creative-storage';
import { sanitizePinResponse } from '@/lib/pinterest/pin-response';
import { generatePinterestDescription } from '@/lib/pinterest/bedrock-copy';
import { validatePinDescription } from '@/lib/pinterest/description';
import { canEditPinDescription, EDITABLE_PIN_DESCRIPTION_STATUSES, loadPinterestDescriptionSource } from '@/lib/pinterest/description-service';
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
        subSection: { include: { shopSection: { select: { title: true } } } },
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
        showSubject: Boolean(listing.includeAllItems) || [3, 6, 12].includes(listing.numberOfItems ?? 1),
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
  const integerParam = (name: string, fallback?: number) => {
    const value = url.searchParams.get(name);
    if (value === null) return fallback;
    const number = Number(value);
    return /^[1-9]\d*$/.test(value) && Number.isSafeInteger(number) ? number : NaN;
  };
  const page = integerParam('page', 1)!;
  const pageSize = integerParam('pageSize', 50)!;
  const boardId = integerParam('boardId');
  if (!Number.isSafeInteger(page) || !Number.isSafeInteger(pageSize) || pageSize > 100
    || (boardId !== undefined && (!Number.isSafeInteger(boardId) || boardId > 2_147_483_647))
    || !Number.isSafeInteger((page - 1) * pageSize) || (page - 1) * pageSize > 2_147_483_647) return NextResponse.json({ error: 'Choose a valid page, page size (1–100), and board.' }, { status: 400 });
  if (status && !['DRAFT', 'PAUSED', 'SCHEDULED', 'PUBLISHING', 'PUBLISHED', 'FAILED'].includes(status)) return NextResponse.json({ error: 'Choose a valid Pin status.' }, { status: 400 });
  const where = { ...(status ? { status } : {}), ...(boardId === undefined ? {} : { boardId }) };
  const [data, total, groupedCounts, allBoards] = await Promise.all([
    prisma.pinterestPin.findMany({
    where,
    orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
    include: {
      listing: { select: { title: true } },
      board: { select: { name: true } },
      campaign: { select: { name: true } },
    },
    skip: (page - 1) * pageSize, take: pageSize,
    }),
    prisma.pinterestPin.count({ where }),
    prisma.pinterestPin.groupBy({ by: ['boardId', 'status'], _count: { _all: true } }),
    prisma.pinterestBoard.findMany({ select: { id: true } }),
  ]);
  const counts = new Map(allBoards.map(board => [board.id, { boardId: board.id, total: 0, draft: 0, paused: 0, scheduled: 0, publishing: 0, published: 0, failed: 0 }]));
  for (const group of groupedCounts) {
    const count = counts.get(group.boardId);
    if (!count) continue;
    count.total += group._count._all;
    const statusFields: Record<string, 'draft' | 'paused' | 'scheduled' | 'publishing' | 'published' | 'failed'> = { DRAFT: 'draft', PAUSED: 'paused', SCHEDULED: 'scheduled', PUBLISHING: 'publishing', PUBLISHED: 'published', FAILED: 'failed' };
    const field = statusFields[group.status];
    if (field) count[field] += group._count._all;
  }
  const creativeKeys = await loadPinCreativeStorageKeys(data.map((pin) => pin.id));
  return NextResponse.json({ data: data.map((pin) => ({
    ...sanitizePinResponse(pin), previewUrl: `/api/pinterest/pins/${pin.id}/image`, hasDedicatedCreative: creativeKeys.has(pin.id),
  })), pagination: { page, pageSize, total, totalPages: Math.max(1, Math.ceil(total / pageSize)) }, boardCounts: [...counts.values()].sort((first, second) => first.boardId - second.boardId) });
}
export async function POST(request: Request) {
  try {
    const body = await request.json() as { action?: string; id?: number; listingId?: number; imageId?: number | null; boardId?: number; title?: string; description?: unknown; scheduledAt?: string | null; publishNow?: boolean; saveDraft?: boolean };
    if (body.action === 'publish' && body.id) return NextResponse.json({ data: sanitizePinResponse(await publishPin(body.id)) });
    if (body.action === 'regenerate-description') {
      if (!Number.isInteger(body.id) || Number(body.id) < 1) return NextResponse.json({ error: 'Pin id is required.' }, { status: 400 });
      const pin = await prisma.pinterestPin.findUnique({ where: { id: body.id } });
      if (!pin) return NextResponse.json({ error: 'Pin not found.' }, { status: 404 });
      if (!canEditPinDescription(pin)) return NextResponse.json({ error: 'Descriptions can only be changed for unpublished draft, paused or failed Pins. Pause a scheduled Pin before editing.' }, { status: 409 });
      const source = await loadPinterestDescriptionSource(pin.listingId, pin.boardId, pin.destinationUrl, pin.creativeType, pin.status === 'DRAFT' && !pin.destinationUrl);
      const description = validatePinDescription(await generatePinterestDescription(source.context));
      // Regeneration is a preview. Only the separate Save action changes the stored Pin.
      return NextResponse.json({ data: { id: pin.id, description } });
    }
    if (!Number.isInteger(body.listingId) || Number(body.listingId) < 1 || !Number.isInteger(body.boardId) || Number(body.boardId) < 1) return NextResponse.json({ error: 'Listing and board are required.' }, { status: 400 });
    if (!body.publishNow && !body.saveDraft && !body.scheduledAt) return NextResponse.json({ error: 'Choose a date and time to publish later.' }, { status: 400 });
    const scheduledAt = body.publishNow || body.saveDraft ? null : new Date(body.scheduledAt!);
    if (scheduledAt && Number.isNaN(scheduledAt.getTime())) return NextResponse.json({ error: 'Choose a valid publishing date and time.' }, { status: 400 });
    // Validate supplied copy before calling AWS; an explicitly empty value is not a request to generate.
    const suppliedDescription = Object.hasOwn(body, 'description') ? validatePinDescription(body.description) : undefined;
    const source = await loadPinterestDescriptionSource(body.listingId!, body.boardId!, undefined, undefined, body.saveDraft === true && !body.publishNow);
    const description = suppliedDescription ?? validatePinDescription(await generatePinterestDescription(source.context));
    const pin = await prisma.pinterestPin.create({ data: {
      listingId: body.listingId!, imageId: body.imageId, boardId: body.boardId!,
      title: (body.title?.trim() || source.title).slice(0, 100), description,
      destinationUrl: source.destinationUrl, status: body.publishNow || body.saveDraft ? 'DRAFT' : 'SCHEDULED', scheduledAt,
      publicationKey: publicationKey(body.listingId!, body.imageId ?? null, body.boardId!, scheduledAt),
    } });
    const result = body.publishNow ? await publishPin(pin.id) : pin;
    return NextResponse.json({ data: sanitizePinResponse(result) }, { status: 201 });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : 'Pin could not be saved.' }, { status: 400 });
  }
}
export async function DELETE(request: Request) { try { const body = await request.json() as { id?: number }; if (!body.id) return NextResponse.json({ error: 'Pin id is required.' }, { status: 400 }); return NextResponse.json({ data: await deletePin(body.id) }); } catch (error) { return NextResponse.json({ error: error instanceof Error ? error.message : 'Pin could not be deleted.' }, { status: 400 }); } }
export async function PATCH(request: Request) {
  try {
    const body = await request.json() as { id: number; status?: string; scheduledAt?: string; title?: string; description?: unknown; expectedDescription?: unknown };
    if (!Number.isInteger(body.id) || body.id < 1) return NextResponse.json({ error: 'Pin id is required.' }, { status: 400 });
    if (Object.hasOwn(body, 'description')) {
      const description = validatePinDescription(body.description);
      if (typeof body.expectedDescription !== 'string') return NextResponse.json({ error: 'Refresh the Pin before saving its description.' }, { status: 409 });
      if (body.status !== undefined || body.scheduledAt !== undefined || body.title !== undefined) return NextResponse.json({ error: 'Save the description separately from other Pin changes.' }, { status: 400 });
      const pin = await prisma.pinterestPin.findUnique({ where: { id: body.id } });
      if (!pin) return NextResponse.json({ error: 'Pin not found.' }, { status: 404 });
      if (!canEditPinDescription(pin)) return NextResponse.json({ error: 'Descriptions can only be changed for unpublished draft, paused or failed Pins. Pause a scheduled Pin before editing.' }, { status: 409 });
      if (pin.description !== body.expectedDescription) return NextResponse.json({ error: 'This description changed in another session. Refresh the page and reopen Review before saving.' }, { status: 409 });
      const saved = await prisma.pinterestPin.updateMany({
        where: { id: pin.id, status: { in: EDITABLE_PIN_DESCRIPTION_STATUSES }, pinterestPinId: null, description: body.expectedDescription, updatedAt: pin.updatedAt },
        data: { description },
      });
      if (saved.count !== 1) return NextResponse.json({ error: 'This Pin changed while you were editing. Refresh the page and reopen Review before saving.' }, { status: 409 });
      const updated = await prisma.pinterestPin.findUnique({ where: { id: pin.id } });
      if (!updated) return NextResponse.json({ error: 'This Pin was deleted. Refresh the board.' }, { status: 409 });
      return NextResponse.json({ data: sanitizePinResponse(updated) });
    }
    const pin = await prisma.pinterestPin.update({ where: { id: body.id }, data: {
      status: body.status, scheduledAt: body.scheduledAt ? new Date(body.scheduledAt) : undefined,
      title: body.title?.slice(0, 100), error: body.status === 'SCHEDULED' ? null : undefined,
    } });
    return NextResponse.json({ data: sanitizePinResponse(pin) });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : 'Pin update failed.' }, { status: 400 });
  }
}
