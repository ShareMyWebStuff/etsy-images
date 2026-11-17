import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { publicationKey } from '@/lib/pinterest/copy';
import { PinterestSchedulingError, schedulePinterestPins } from '@/lib/pinterest/scheduling';

export async function GET() {
  const campaigns = await prisma.pinterestCampaign.findMany({
    orderBy: { createdAt: 'desc' },
    include: {
      _count: { select: { pins: true } },
      pins: { take: 1, select: { board: { select: { id: true, name: true } } } },
    },
  });
  return NextResponse.json({
    data: campaigns.map(({ pins, ...campaign }) => ({ ...campaign, board: pins[0]?.board ?? null })),
  });
}

export async function POST(request: Request) {
  try {
    const body = await request.json() as { action?: string; name?: string; boardId?: number; pinIds?: number[]; startDate?: string; pinsPerDay?: number; timeZone?: string };
    if (body.action !== undefined && body.action !== 'schedule-selected') return NextResponse.json({ error: 'Unknown campaign action.' }, { status: 400 });
    const name = body.name?.trim();
    const boardId = Number(body.boardId);
    if (!name || !Number.isSafeInteger(boardId) || boardId < 1 || boardId > 2_147_483_647 || !body.startDate) {
      return NextResponse.json({ error: 'Enter a campaign name, board, and valid start date.' }, { status: 400 });
    }
    let pinIds = body.pinIds;
    if (body.action !== 'schedule-selected') {
      const pins = await prisma.pinterestPin.findMany({
        where: { boardId, status: 'DRAFT', scheduledAt: null, campaignId: null },
        orderBy: [{ createdAt: 'asc' }, { id: 'asc' }], select: { id: true },
      });
      pinIds = pins.map(pin => pin.id);
      if (!pinIds.length) return NextResponse.json({ error: 'This board has no unscheduled Pins. Add listings to the board for a campaign first.' }, { status: 400 });
    }
    const campaign = await schedulePinterestPins({
      name, boardId, pinIds: pinIds!, startDate: body.startDate,
      pinsPerDay: body.pinsPerDay ?? 1, timeZone: body.timeZone ?? 'Europe/London',
    });
    return NextResponse.json({ data: campaign }, { status: 201 });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : 'Campaign could not be created.' }, { status: error instanceof PinterestSchedulingError ? error.status : 400 });
  }
}

export async function PATCH(request: Request) {
  const body = await request.json() as { id: number; status: string };
  await prisma.$transaction([
    prisma.pinterestCampaign.update({ where: { id: body.id }, data: { status: body.status } }),
    prisma.pinterestPin.updateMany({
      where: { campaignId: body.id, status: { in: ['SCHEDULED', 'PAUSED'] } },
      data: { status: body.status === 'PAUSED' ? 'PAUSED' : 'SCHEDULED' },
    }),
  ]);
  return NextResponse.json({ data: true });
}

export async function DELETE(request: Request) {
  try {
    const body = await request.json() as { id?: number };
    const id = Number(body.id);
    if (!Number.isInteger(id) || id < 1) {
      return NextResponse.json({ error: 'A valid campaign is required.' }, { status: 400 });
    }

    const campaign = await prisma.pinterestCampaign.findUnique({
      where: { id },
      include: {
        pins: {
          where: { status: { in: ['SCHEDULED', 'PAUSED'] } },
          select: { id: true, listingId: true, imageId: true, boardId: true },
        },
      },
    });
    if (!campaign) {
      return NextResponse.json({ error: 'Campaign not found.' }, { status: 404 });
    }

    await prisma.$transaction(async (tx) => {
      for (const pin of campaign.pins) {
        await tx.pinterestPin.update({
          where: { id: pin.id },
          data: {
            campaignId: null,
            status: 'DRAFT',
            scheduledAt: null,
            error: null,
            publicationKey: publicationKey(pin.listingId, pin.imageId, pin.boardId),
          },
        });
      }
      await tx.pinterestCampaign.delete({ where: { id } });
    });

    return NextResponse.json({ data: { deleted: true, draftsRestored: campaign.pins.length } });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : 'Campaign could not be deleted.' }, { status: 400 });
  }
}
