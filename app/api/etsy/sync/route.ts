import { NextResponse } from 'next/server';
import { getShopSummary, syncEtsyShops } from '@/lib/etsy-sync';

export async function GET() {
  try {
    const rows = await getShopSummary();
    return NextResponse.json({ rows });
  } catch (error) {
    console.error('Failed to load Etsy shop summary:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Unable to load Etsy shop summary.' },
      { status: 500 }
    );
  }
}

export async function POST() {
  try {
    const sync = await syncEtsyShops();
    const rows = await getShopSummary();

    return NextResponse.json({
      rows,
      sync: {
        shops: sync.shops,
        counts: {
          shops: sync.shops.length,
        },
      },
    });
  } catch (error) {
    console.error('Failed to sync Etsy user data:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Unable to sync Etsy user data.' },
      { status: 500 }
    );
  }
}
