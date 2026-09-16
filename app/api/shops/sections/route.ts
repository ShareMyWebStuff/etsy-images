import { NextResponse } from 'next/server';
import { getShopSectionsPageData } from '@/lib/etsy-sync';
import { createLocalShopSection, createOrLinkEtsyShopSection, deleteLocalShopSection, renameShopSection } from '@/lib/local-shop-sections';

type CreateSectionRequest = {
  shopId?: string;
  sectionName?: string;
  numberOfDownloads?: number | null;
  includeAllDownloads?: boolean;
  roomTheme?: string;
};

type DeleteSectionRequest = {
  shopId?: string;
  sectionId?: string;
};

type LinkEtsySectionRequest = {
  shopId?: string;
  sectionId?: string;
};

type RenameSectionRequest = LinkEtsySectionRequest & { sectionName?: string };

export async function PUT(request: Request) {
  try {
    const body = (await request.json()) as RenameSectionRequest;
    if (!body.shopId || !body.sectionId || !body.sectionName) {
      return NextResponse.json({ error: 'Missing shopId, sectionId, or sectionName.' }, { status: 400 });
    }
    await renameShopSection(body.shopId, body.sectionId, body.sectionName);
    return NextResponse.json({ data: await getShopSectionsPageData(body.shopId) });
  } catch (error) {
    console.error('Failed to rename shop section:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Unable to rename section.' },
      { status: 500 }
    );
  }
}

export async function PATCH(request: Request) {
  try {
    const body = (await request.json()) as LinkEtsySectionRequest;

    if (!body.shopId || !body.sectionId) {
      return NextResponse.json({ error: 'Missing shopId or sectionId.' }, { status: 400 });
    }

    await createOrLinkEtsyShopSection(body.shopId, body.sectionId);
    const data = await getShopSectionsPageData(body.shopId);
    return NextResponse.json({ data });
  } catch (error) {
    console.error('Failed to create or link Etsy shop section:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Unable to create or link Etsy section.' },
      { status: 500 }
    );
  }
}

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as CreateSectionRequest;

    if (!body.shopId) {
      return NextResponse.json({ error: 'Missing shopId.' }, { status: 400 });
    }

    if (!body.sectionName) {
      return NextResponse.json({ error: 'Enter a section name.' }, { status: 400 });
    }

    const includeAllDownloads = body.includeAllDownloads === true;
    const numberOfDownloads = includeAllDownloads ? null : Number(body.numberOfDownloads);
    if (!includeAllDownloads && (!Number.isInteger(numberOfDownloads) || numberOfDownloads! < 1)) {
      return NextResponse.json({ error: 'Select a valid number of downloads.' }, { status: 400 });
    }

    await createLocalShopSection(body.shopId, body.sectionName, numberOfDownloads, includeAllDownloads, body.roomTheme ?? '');
    const data = await getShopSectionsPageData(body.shopId);

    return NextResponse.json({ data });
  } catch (error) {
    console.error('Failed to create shop section:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Unable to create section.' },
      { status: 500 }
    );
  }
}

export async function DELETE(request: Request) {
  try {
    const body = (await request.json()) as DeleteSectionRequest;

    if (!body.shopId) {
      return NextResponse.json({ error: 'Missing shopId.' }, { status: 400 });
    }

    if (!body.sectionId) {
      return NextResponse.json({ error: 'Missing sectionId.' }, { status: 400 });
    }

    await deleteLocalShopSection(body.shopId, body.sectionId);
    const data = await getShopSectionsPageData(body.shopId);

    return NextResponse.json({ data });
  } catch (error) {
    console.error('Failed to delete shop section:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Unable to delete section.' },
      { status: 500 }
    );
  }
}
