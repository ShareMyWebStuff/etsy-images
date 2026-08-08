import { NextResponse } from 'next/server';
import { syncEtsyShopSections } from '@/lib/etsy-sync';
import { deleteEtsyShopSection } from '@/lib/local-shop-sections';
import { getSyncToEtsyData } from '@/lib/sync-to-etsy';
import { refreshEtsySectionListings } from '@/lib/local-listings';

export async function GET() {
  try {
    const result = await syncEtsyShopSections();
    return NextResponse.json(result);
  } catch (error) {
    console.error('Failed to sync Etsy shop sections:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Unable to sync Etsy shop sections.' },
      { status: 500 }
    );
  }
}

export async function DELETE(request: Request) {
  try {
    const body = (await request.json()) as { sectionId?: string };
    if (!body.sectionId) return NextResponse.json({ error: 'Choose a section to delete.' }, { status: 400 });
    await deleteEtsyShopSection(body.sectionId);
    return NextResponse.json({ data: await getSyncToEtsyData() });
  } catch (error) {
    console.error('Failed to delete Etsy shop section:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Unable to delete Etsy shop section.' },
      { status: 500 }
    );
  }
}

export async function PATCH(request: Request) {
  try {
    const body = (await request.json()) as { sectionId?: string };
    if (!body.sectionId) return NextResponse.json({ error: 'Choose a section to refresh.' }, { status: 400 });
    const result = await refreshEtsySectionListings(body.sectionId);
    return NextResponse.json({ result, data: await getSyncToEtsyData() });
  } catch (error) {
    console.error('Failed to refresh Etsy listing sections:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Unable to refresh Etsy listing sections.' },
      { status: 500 }
    );
  }
}
