import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { publicationKey, spreadSchedule } from '@/lib/pinterest/copy';

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
    const body = await request.json() as { name?: string; boardId?: number; startDate?: string; pinsPerDay?: number };
    const name = body.name?.trim();
    const boardId = Number(body.boardId);
    const startDate = body.startDate ? new Date(body.startDate) : null;
    const pinsPerDay = Math.min(4, Math.max(1, Number(body.pinsPerDay) || 1));
    if (!name || !Number.isInteger(boardId) || !startDate || Number.isNaN(startDate.getTime())) {
      return NextResponse.json({ error: 'Enter a campaign name, board, and valid start date.' }, { status: 400 });
    }

    const board = await prisma.pinterestBoard.findUnique({ where: { id: boardId }, select: { id: true } });
    if (!board) return NextResponse.json({ error: 'Pinterest board not found.' }, { status: 404 });
    const pins = await prisma.pinterestPin.findMany({
      where: { boardId, status: 'DRAFT', scheduledAt: null, campaignId: null },
      orderBy: { createdAt: 'asc' },
      select: { id: true, listingId: true, imageId: true },
    });
    if (!pins.length) {
      return NextResponse.json({ error: 'This board has no unscheduled Pins. Add listings to the board for a campaign first.' }, { status: 400 });
    }

    const dates = spreadSchedule(startDate, pins.length, pinsPerDay);
    const campaign = await prisma.$transaction(async (tx) => {
      const created = await tx.pinterestCampaign.create({
        data: { name, sourceSectionId: null, startDate, pinsPerDay, configuration: { boardId } },
      });
      for (let index = 0; index < pins.length; index += 1) {
        const pin = pins[index];
        await tx.pinterestPin.update({
          where: { id: pin.id },
          data: {
            campaignId: created.id,
            status: 'SCHEDULED',
            scheduledAt: dates[index],
            publicationKey: publicationKey(pin.listingId, pin.imageId, boardId, dates[index]),
          },
        });
      }
      return created;
    });
    return NextResponse.json({ data: campaign }, { status: 201 });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : 'Campaign could not be created.' }, { status: 400 });
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
