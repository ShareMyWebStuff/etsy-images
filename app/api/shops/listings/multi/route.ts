import { NextResponse } from 'next/server';
import { completeMultiListing, createSixItemListing, createThreeItemListing, validateMultiListingName } from '@/lib/multi-listing';
import { loadTwelveListingImages, removeStagedTwelveListingImages } from '@/lib/multi-listing-staging';

type EtsyProductType = 'physical' | 'digital';

class InvalidListingConfigurationError extends Error {}

function requiredString(formData: FormData, name: string) {
  const value = formData.get(name);
  if (typeof value !== 'string' || !value) throw new Error(`Missing ${name}.`);
  return value;
}

function parseListingConfiguration(
  numberOfItemsValue: string | null,
  includeAllItemsValue: string | null,
  etsyProductTypeValue: string | null
) {
  const includeAllItems = includeAllItemsValue === 'true' || numberOfItemsValue === 'all';
  const numberOfItems = includeAllItems ? null : Number(numberOfItemsValue);
  if (!includeAllItems && (numberOfItems === null || ![3, 6, 12].includes(numberOfItems))) {
    throw new InvalidListingConfigurationError('Choose 3, 6, 12, or All items for a multi-item listing.');
  }
  if (etsyProductTypeValue !== 'physical' && etsyProductTypeValue !== 'digital') {
    throw new InvalidListingConfigurationError('Choose a Physical or Digital Etsy product.');
  }

  return {
    numberOfItems,
    includeAllItems,
    etsyProductType: etsyProductTypeValue as EtsyProductType,
  };
}

export async function POST(request: Request) {
  try {
    const formData = await request.formData();
    const bedroomImage = formData.get('bedroomImage');
    const playroomImage = formData.get('playroomImage');
    const sourceIds = JSON.parse(requiredString(formData, 'sourceIds')) as string[];
    const flowType = formData.get('flowType');
    const configuration = parseListingConfiguration(
      typeof formData.get('numberOfItems') === 'string' ? formData.get('numberOfItems') as string : null,
      typeof formData.get('includeAllItems') === 'string' ? formData.get('includeAllItems') as string : null,
      typeof formData.get('etsyProductType') === 'string' ? formData.get('etsyProductType') as string : null
    );
    const isDropboxFlow = flowType === 'all' || flowType === 'six' || flowType === 'twelve';
    const expectedFlowType = configuration.includeAllItems
      ? 'all'
      : configuration.numberOfItems === 12
        ? 'twelve'
        : configuration.numberOfItems === 6
          ? 'six'
          : 'three';
    if (flowType !== expectedFlowType) {
      throw new InvalidListingConfigurationError('The selected No of Items does not match this creation flow.');
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
      ...configuration,
    };
    let result;
    if (isDropboxFlow) {
      const imageKeys = flowType === 'all'
        ? Array.from({ length: Math.min(10, 6 + Math.ceil(sourceIds.length / 16)) }, (_, index) => `image${index + 1}`)
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
      result = await createThreeItemListing(context, {
        ...sharedInput,
        bedroomImage: bedroomImage instanceof File ? bedroomImage : null,
        playroomImage: playroomImage instanceof File ? playroomImage : null,
      });
    }
    return NextResponse.json(result);
  } catch (error) {
    console.error('Failed to create multi listing:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Unable to create listing.' },
      { status: error instanceof InvalidListingConfigurationError ? 400 : 500 }
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
    const configuration = parseListingConfiguration(
      searchParams.get('numberOfItems'),
      searchParams.get('includeAllItems'),
      searchParams.get('etsyProductType')
    );
    return NextResponse.json(await validateMultiListingName(
      { shopId, sectionId, subSectionId, sourceSectionId },
      listingName,
      configuration
    ));
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
