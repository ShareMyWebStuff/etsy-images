import { NextResponse } from 'next/server';
import { createShopDirectory } from '@/lib/local-shop-directory';
import { prisma } from '@/lib/prisma';
import { getShopSummary } from '@/lib/etsy-sync';

type CreateLocalDirectoryRequest = {
  shopId?: string;
};

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as CreateLocalDirectoryRequest;

    if (!body.shopId) {
      return NextResponse.json({ error: 'Missing shopId.' }, { status: 400 });
    }

    let etsyShopId: bigint;

    try {
      etsyShopId = BigInt(body.shopId);
    } catch {
      return NextResponse.json({ error: 'Invalid shopId.' }, { status: 400 });
    }

    const shop = await prisma.etsyShop.findUnique({
      where: {
        etsyShopId,
      },
      select: {
        etsyShopId: true,
        shopName: true,
        title: true,
      },
    });

    if (!shop) {
      return NextResponse.json({ error: 'Shop not found.' }, { status: 404 });
    }

    const shopName = shop.shopName ?? shop.title ?? `Shop ${shop.etsyShopId}`;
    const directoryPath = await createShopDirectory(shopName);
    const rows = await getShopSummary();

    return NextResponse.json({ directoryPath, rows });
  } catch (error) {
    console.error('Failed to create local shop directory:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Unable to create local shop directory.' },
      { status: 500 }
    );
  }
}
