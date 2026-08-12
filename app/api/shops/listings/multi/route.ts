import { NextResponse } from 'next/server';
import { completeMultiListing, createSixItemListing, createThreeItemListing, validateMultiListingName } from '@/lib/multi-listing';
import { loadTwelveListingImages, removeStagedTwelveListingImages } from '@/lib/multi-listing-staging';

function requiredString(formData: FormData, name: string) {
  const value = formData.get(name);
  if (typeof value !== 'string' || !value) throw new Error(`Missing ${name}.`);
  return value;
}

export async function POST(request: Request) {
  try {
    const formData = await request.formData();
    const bedroomImage = formData.get('bedroomImage');
    const playroomImage = formData.get('playroomImage');
    const sourceIds = JSON.parse(requiredString(formData, 'sourceIds')) as string[];
    const flowType = formData.get('flowType');
    const isDropboxFlow = flowType === 'all' || flowType === 'six' || flowType === 'twelve';
    if (!isDropboxFlow && (!(bedroomImage instanceof File) || !(playroomImage instanceof File))) {
      return NextResponse.json({ error: 'Upload both generated images.' }, { status: 400 });
    }
    const context = {
      shopId: requiredString(formData, 'shopId'),
      sectionId: requiredString(formData, 'sectionId'),
      subSectionId: requiredString(formData, 'subSectionId'),
      sourceSectionId: requiredString(formData, 'sourceSectionId'),
    };
    const sharedInput = {
      sourceIds,
      listingName: requiredString(formData, 'listingName'),
      title: requiredString(formData, 'title'),
      description: requiredString(formData, 'description'),
      price: Number(requiredString(formData, 'price')),
      quantity: Number(requiredString(formData, 'quantity')),
      primaryColour: (formData.get('primaryColour') as string | null) ?? '',
      secondaryColour: (formData.get('secondaryColour') as string | null) ?? '',
      tags: JSON.parse(requiredString(formData, 'tags')) as string[],
    };
    let result;
    if (isDropboxFlow) {
      const imageKeys = flowType === 'all'
        ? Array.from({ length: 6 + Math.ceil(sourceIds.length / 16) }, (_, index) => `image${index + 1}`)
        : flowType === 'twelve'
        ? ['image1', 'image2', 'image3', 'image4', 'image5', 'image6', 'image7', 'image8']
        : ['bedroomImage', 'playroomImage', 'bestThreeImage', 'otherThreeImage'];
      const stageToken = flowType === 'twelve' ? formData.get('stageToken') : null;
      const uploadedImages = flowType === 'twelve' && typeof stageToken === 'string' && stageToken
        ? await loadTwelveListingImages(stageToken)
        : imageKeys.map((key) => {
            const file = formData.get(key);
            return file instanceof File ? file : null;
          });
      result = await createSixItemListing(context, {
          ...sharedInput,
          uploadedImages,
        });
      if (flowType === 'twelve' && typeof stageToken === 'string' && stageToken) {
        await removeStagedTwelveListingImages(stageToken);
      }
    } else {
      if (!(bedroomImage instanceof File) || !(playroomImage instanceof File)) {
        return NextResponse.json({ error: 'Upload both generated images.' }, { status: 400 });
      }
      result = await createThreeItemListing(context, { ...sharedInput, bedroomImage, playroomImage });
    }
    return NextResponse.json(result);
  } catch (error) {
    console.error('Failed to create multi listing:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Unable to create listing.' },
      { status: 500 }
    );
  }
}

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const shopId = searchParams.get('shopId');
    const sectionId = searchParams.get('sectionId');
    const subSectionId = searchParams.get('subSectionId');
    const sourceSectionId = searchParams.get('sourceSectionId');
    const listingName = searchParams.get('listingName');
    if (!shopId || !sectionId || !subSectionId || !sourceSectionId || !listingName) {
      return NextResponse.json({ error: 'Missing listing details.' }, { status: 400 });
    }
    return NextResponse.json(await validateMultiListingName({ shopId, sectionId, subSectionId, sourceSectionId }, listingName));
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Unable to validate listing name.' },
      { status: 400 }
    );
  }
}

export async function PATCH(request: Request) {
  try {
    const body = await request.json() as { shopId?: string; sectionId?: string; subSectionId?: string; listingId?: string };
    if (!body.shopId || !body.sectionId || !body.subSectionId || !body.listingId) {
      return NextResponse.json({ error: 'Missing listing context.' }, { status: 400 });
    }
    return NextResponse.json(await completeMultiListing(
      { shopId: body.shopId, sectionId: body.sectionId, subSectionId: body.subSectionId },
      body.listingId
    ));
  } catch (error) {
    console.error('Failed to complete multi listing:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Unable to complete listing.' },
      { status: 500 }
    );
  }
}
