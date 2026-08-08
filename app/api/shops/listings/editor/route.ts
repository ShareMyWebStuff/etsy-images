import { NextResponse } from 'next/server';
import {
  addListingCollectionItem,
  deleteListingCollectionItem,
  saveListingTags,
  saveListingDetails,
  type CollectionKind,
  type SaveListingDetailsInput,
} from '@/lib/listing-editor';

type SaveRequest = SaveListingDetailsInput;

type CollectionRequest = {
  shopId?: string;
  sectionId?: string;
  subSectionId?: string;
  listingId?: string;
  kind?: CollectionKind;
  itemId?: string;
  payload?: Record<string, unknown>;
  tags?: string[];
};

function getContext(body: CollectionRequest) {
  if (!body.shopId || !body.sectionId || !body.subSectionId || !body.listingId) {
    throw new Error('Missing listing context.');
  }

  return {
    shopId: body.shopId,
    sectionId: body.sectionId,
    subSectionId: body.subSectionId,
    listingId: body.listingId,
  };
}

export async function PUT(request: Request) {
  try {
    const body = (await request.json()) as SaveRequest;

    if (!body.shopId || !body.sectionId || !body.subSectionId || !body.listingId) {
      return NextResponse.json({ error: 'Missing listing context.' }, { status: 400 });
    }

    const data = await saveListingDetails(body);

    return NextResponse.json({ data });
  } catch (error) {
    console.error('Failed to save listing editor details:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Unable to save listing details.' },
      { status: 500 }
    );
  }
}

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as CollectionRequest;

    if (!body.kind) {
      return NextResponse.json({ error: 'Missing collection kind.' }, { status: 400 });
    }

    const data = await addListingCollectionItem(getContext(body), body.kind, body.payload ?? {});

    return NextResponse.json({ data });
  } catch (error) {
    console.error('Failed to add listing editor item:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Unable to add item.' },
      { status: 500 }
    );
  }
}

export async function PATCH(request: Request) {
  try {
    const body = (await request.json()) as CollectionRequest;

    if (!Array.isArray(body.tags) || !body.tags.every((tag) => typeof tag === 'string')) {
      return NextResponse.json({ error: 'Tags must be an array of strings.' }, { status: 400 });
    }

    const data = await saveListingTags(getContext(body), body.tags);
    return NextResponse.json({ data });
  } catch (error) {
    console.error('Failed to save listing tags:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Unable to save tags.' },
      { status: 500 }
    );
  }
}

export async function DELETE(request: Request) {
  try {
    const body = (await request.json()) as CollectionRequest;

    if (!body.kind || !body.itemId) {
      return NextResponse.json({ error: 'Missing item details.' }, { status: 400 });
    }

    const data = await deleteListingCollectionItem(getContext(body), body.kind, body.itemId);

    return NextResponse.json({ data });
  } catch (error) {
    console.error('Failed to delete listing editor item:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Unable to delete item.' },
      { status: 500 }
    );
  }
}
