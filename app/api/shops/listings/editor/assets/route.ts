import { NextResponse } from 'next/server';
import { createListingZipFiles, deleteAllListingDownloads, deleteListingAsset, getListingAssetFile, reduceListingDownload, reduceListingDownloadQuality, uploadListingAsset, type UploadKind } from '@/lib/listing-editor';

type DeleteAssetRequest = {
  shopId?: string;
  sectionId?: string;
  subSectionId?: string;
  listingId?: string;
  kind?: UploadKind;
  assetId?: string;
  action?: 'resize' | 'reduceQuality';
  deleteAll?: boolean;
};

type CreateZipsRequest = DeleteAssetRequest & {
  assignments?: Array<{ fileId: string; zipNumber: number | null }>;
};

export async function PATCH(request: Request) {
  try {
    const body = (await request.json()) as DeleteAssetRequest;
    if (!body.shopId || !body.sectionId || !body.subSectionId || !body.listingId || !body.assetId) {
      return NextResponse.json({ error: 'Missing resize details.' }, { status: 400 });
    }
    const context = { shopId: body.shopId, sectionId: body.sectionId, subSectionId: body.subSectionId, listingId: body.listingId };
    const data = body.action === 'reduceQuality'
      ? await reduceListingDownloadQuality(context, body.assetId)
      : await reduceListingDownload(context, body.assetId);
    return NextResponse.json({ data });
  } catch (error) {
    console.error('Failed to reduce listing download:', error);
    return NextResponse.json({ error: error instanceof Error ? error.message : 'Unable to reduce download.' }, { status: 500 });
  }
}

export async function PUT(request: Request) {
  try {
    const body = (await request.json()) as CreateZipsRequest;
    if (!body.shopId || !body.sectionId || !body.subSectionId || !body.listingId) {
      return NextResponse.json({ error: 'Missing zip details.' }, { status: 400 });
    }
    if (!Array.isArray(body.assignments)) return NextResponse.json({ error: 'Missing zip assignments.' }, { status: 400 });
    const data = await createListingZipFiles(
      {
        shopId: body.shopId,
        sectionId: body.sectionId,
        subSectionId: body.subSectionId,
        listingId: body.listingId,
      },
      body.assignments
    );
    return NextResponse.json({ data });
  } catch (error) {
    console.error('Failed to create listing zip files:', error);
    return NextResponse.json({ error: error instanceof Error ? error.message : 'Unable to create zip files.' }, { status: 500 });
  }
}

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const context = {
      shopId: searchParams.get('shopId') ?? '',
      sectionId: searchParams.get('sectionId') ?? '',
      subSectionId: searchParams.get('subSectionId') ?? '',
      listingId: searchParams.get('listingId') ?? '',
    };
    const kind = (searchParams.get('kind') ?? '') as UploadKind;
    const assetId = searchParams.get('assetId') ?? '';

    if (!context.shopId || !context.sectionId || !context.subSectionId || !context.listingId || !assetId || !['image', 'thumbnail'].includes(kind)) {
      return NextResponse.json({ error: 'Missing or invalid asset context.' }, { status: 400 });
    }

    const asset = await getListingAssetFile(context, kind, assetId);
    return new Response(new Uint8Array(asset.contents), {
      headers: { 'Content-Type': asset.contentType, 'Cache-Control': 'private, max-age=60' },
    });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : 'Unable to load asset.' }, { status: 404 });
  }
}

function getRequiredFormValue(formData: FormData, key: string) {
  const value = formData.get(key);

  if (typeof value !== 'string' || !value) {
    throw new Error(`Missing ${key}.`);
  }

  return value;
}

function getContext(body: DeleteAssetRequest) {
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

export async function POST(request: Request) {
  try {
    const formData = await request.formData();
    const kind = getRequiredFormValue(formData, 'kind') as UploadKind;
    const file = formData.get('file');

    if (!['thumbnail', 'image', 'file', 'video'].includes(kind)) {
      return NextResponse.json({ error: 'Choose a valid asset type.' }, { status: 400 });
    }

    if (!(file instanceof File)) {
      return NextResponse.json({ error: 'Choose a file to upload.' }, { status: 400 });
    }

    const data = await uploadListingAsset(
      {
        shopId: getRequiredFormValue(formData, 'shopId'),
        sectionId: getRequiredFormValue(formData, 'sectionId'),
        subSectionId: getRequiredFormValue(formData, 'subSectionId'),
        listingId: getRequiredFormValue(formData, 'listingId'),
      },
      kind,
      file
    );

    return NextResponse.json({ data });
  } catch (error) {
    console.error('Failed to upload listing asset:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Unable to upload asset.' },
      { status: 500 }
    );
  }
}

export async function DELETE(request: Request) {
  try {
    const body = (await request.json()) as DeleteAssetRequest;

    if (body.deleteAll) {
      const data = await deleteAllListingDownloads(getContext(body));
      return NextResponse.json({ data });
    }

    if (!body.kind || !body.assetId) {
      return NextResponse.json({ error: 'Missing asset details.' }, { status: 400 });
    }

    const data = await deleteListingAsset(getContext(body), body.kind, body.assetId);

    return NextResponse.json({ data });
  } catch (error) {
    console.error('Failed to delete listing asset:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Unable to delete asset.' },
      { status: 500 }
    );
  }
}
