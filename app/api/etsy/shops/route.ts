import { NextResponse } from 'next/server';
import { syncEtsyShops } from '@/lib/etsy-sync';

export async function GET() {
  try {
    const result = await syncEtsyShops();
    return NextResponse.json(result);
  } catch (error) {
    console.error('Failed to sync Etsy shops:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Unable to sync Etsy shops.' },
      { status: 500 }
    );
  }
}
