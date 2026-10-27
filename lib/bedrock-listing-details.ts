import { BedrockRuntimeClient, ConverseCommand } from '@aws-sdk/client-bedrock-runtime';
import { NodeHttpHandler } from '@smithy/node-http-handler';
import {
  buildCombinedListingDetailsPrompt,
  missingCombinedListingDetailsPromptFields,
  parseGeneratedListingDetails,
} from '@/lib/combined-listing-details-prompt';
import { formatPhysicalPrintSizesForPrompt } from '@/lib/details-generate-prompt';
import {
  buildMultipleListingDetailsPrompt,
  parseGeneratedMultipleListingDetails,
} from '@/lib/multiple-listing-details-prompt';
import {
  getListingEditorData,
  saveGeneratedListingDetails,
  saveListingDetails,
  setListingColoursFromThumbnail,
  setListingEtsySku,
  type ListingEditorContext,
} from '@/lib/listing-editor';
import { normalizeListingArtworkOrientation } from '@/lib/listing-print-crops';
import { prisma } from '@/lib/prisma';
import { printableDownloadDescriptionGuide } from '@/lib/printable-download-specs';
import { generateValidatedListingResponse } from '@/lib/generated-etsy-tags';

// This model is available for on-demand inference in the application's default
// eu-west-2 region. Keep AWS_BEDROCK_MODEL_ID as an escape hatch for accounts
// that use a different model or an inference-profile ARN/ID.
export const DEFAULT_BEDROCK_MODEL_ID = 'anthropic.claude-sonnet-4-6';
const BEDROCK_REQUEST_TIMEOUT_MS = 240_000;

function bedrockSettings() {
  const region = process.env.AWS_REGION?.trim() || process.env.AWS_DEFAULT_REGION?.trim();
  if (!region) throw new Error('Set AWS_REGION before generating listing details with AWS Bedrock.');
  const modelId = process.env.AWS_BEDROCK_MODEL_ID?.trim() || DEFAULT_BEDROCK_MODEL_ID;
  return {
    client: new BedrockRuntimeClient({
      region,
      requestHandler: new NodeHttpHandler({
        connectionTimeout: 10_000,
        requestTimeout: BEDROCK_REQUEST_TIMEOUT_MS,
        socketTimeout: BEDROCK_REQUEST_TIMEOUT_MS,
        throwOnRequestTimeout: true,
      }),
    }),
    modelId,
    region,
  };
}

function isInvalidModelIdentifier(error: unknown) {
  if (!(error instanceof Error)) return false;
  return error.name === 'ValidationException'
    && error.message.toLowerCase().includes('model identifier');
}

function isBedrockTimeout(error: unknown) {
  if (!error || typeof error !== 'object') return false;
  const candidate = error as { name?: unknown; code?: unknown };
  return candidate.name === 'TimeoutError' || candidate.code === 'ETIMEDOUT';
}

async function sendListingDetailsPrompt(prompt: string) {
  const { client, modelId, region } = bedrockSettings();
  let response;
  try {
    response = await client.send(new ConverseCommand({
      modelId,
      messages: [{ role: 'user', content: [{ text: prompt }] }],
      inferenceConfig: { maxTokens: 10000, temperature: 0.3 },
    }));
  } catch (error) {
    if (isBedrockTimeout(error)) {
      throw new Error(
        `AWS Bedrock did not finish generating the listing details within ${BEDROCK_REQUEST_TIMEOUT_MS / 1000} seconds. Please try Generate again.`,
        { cause: error },
      );
    }
    if (isInvalidModelIdentifier(error)) {
      throw new Error(
        `AWS Bedrock model "${modelId}" is not available in region "${region}". `
        + 'Set AWS_BEDROCK_MODEL_ID to an active model ID or inference-profile ID for that region.',
        { cause: error },
      );
    }
    throw error;
  }
  const responseText = response.output?.message?.content
    ?.flatMap((block) => 'text' in block && typeof block.text === 'string' ? [block.text] : [])
    .join('\n')
    .trim();
  if (!responseText) throw new Error('AWS Bedrock returned an empty listing-details response.');
  return responseText;
}

export async function generateListingDetailsWithBedrock(context: ListingEditorContext) {
  const data = await getListingEditorData(context);
  if (!data) throw new Error('Listing not found.');
  if (data.template?.templateType === 'multiple') {
    throw new Error('Multiple-template listing details are inherited and do not need a Bedrock run.');
  }
  const frameColours = data.etsyProducts.frames
    .filter((frame) => frame.key !== 'no_frame' && frame.enabled)
    .map((frame) => frame.key === 'oak' ? 'Natural Oak' : frame.label);
  const printSizes = data.etsyProducts.sizes.filter((size) => size.enabled);
  const personalisationAreas = data.etsyProducts.config.customisePrints
    ? [
      data.etsyProducts.config.customTop ? 'top' : null,
      data.etsyProducts.config.customBottom ? 'bottom' : null,
    ].filter((area): area is string => area !== null)
    : [];
  const values = {
    sectionName: data.section.sectionName,
    listingName: data.listing.localDirectoryName ?? data.listing.title,
    animalName: data.listing.listingItem,
    animalDescription: data.listing.listingDescription,
    roomTheme: data.listing.roomTheme,
    digitalDownload: data.etsyProducts.config.digitalDownload,
    paperDetails: data.materials.map(({ value }) => value).join(', ') || 'Heavyweight matte art paper, at least 200gsm',
    printSizes: formatPhysicalPrintSizesForPrompt(printSizes),
    frameColours: frameColours.join(', '),
    personalisationDetails: personalisationAreas.length > 0 ? `Optional ${personalisationAreas.join(' and ')} text personalisation is available.` : '',
    giftMessageEnabled: data.etsyProducts.config.giftMessageEnabled,
    digitalFilesIncluded: printableDownloadDescriptionGuide(data.listing.artworkOrientation),
    orientation: data.listing.artworkOrientation,
    fileType: 'jpeg',
    recommendedPaper: 'Good-quality matte photo or art paper around 200–250 gsm',
    licenceType: 'Personal use only: printing for the buyer’s own home décor or one personal printed gift is permitted. File sharing, redistribution, digital resale, commercial reproduction, selling printed copies, and modifying the artwork for resale are prohibited. A printing service may receive the relevant file only to produce the permitted personal print or gift.',
  };
  const missing = missingCombinedListingDetailsPromptFields(values);
  if (missing.length > 0) throw new Error(`Complete ${missing.join(', ')} on Overview before generating details.`);
  const generated = await generateValidatedListingResponse(
    buildCombinedListingDetailsPrompt(values), sendListingDetailsPrompt, parseGeneratedListingDetails,
  );
  await saveGeneratedListingDetails(context, generated);
  await saveListingDetails({ ...context, quantity: data.listing.quantity && data.listing.quantity > 0 ? data.listing.quantity : 999, digitalQuantity: 999 });
  await setListingEtsySku(context);
  await setListingColoursFromThumbnail(context);
  const refreshed = await getListingEditorData(context);
  if (!refreshed) throw new Error('The Bedrock details were saved, but the listing could not be reloaded.');
  return refreshed;
}

export async function generateMultipleListingDetailsWithBedrock(context: ListingEditorContext) {
  const data = await getListingEditorData(context);
  if (!data) throw new Error('Listing not found.');
  if (!data.template || data.template.templateType !== 'multiple') {
    throw new Error('This listing does not use a multiple template.');
  }
  if (data.groupItems.length !== data.template.itemCount) {
    throw new Error(`Select exactly ${data.template.itemCount} grouped listings before generating details.`);
  }

  const sourceIds = data.groupItems.map((item) => Number(item.id));
  const sourceRows = await prisma.etsyListing.findMany({
    where: { id: { in: sourceIds } },
    select: {
      id: true,
      title: true,
      localDirectoryName: true,
      listingItem: true,
      listingDescription: true,
      artworkOrientation: true,
      roomTheme: true,
      primaryColour: true,
      secondaryColour: true,
      ourCategory: { select: { roomTheme: true } },
    },
  });
  const sourceById = new Map(sourceRows.map((source) => [source.id, source]));
  const missingSources = data.groupItems.filter((item) => !sourceById.has(Number(item.id)));
  if (missingSources.length > 0) throw new Error('One or more grouped source listings could not be loaded.');

  const sources = data.groupItems.map((groupItem, index) => {
    const source = sourceById.get(Number(groupItem.id))!;
    return {
      position: index + 1,
      listingName: source.localDirectoryName ?? source.title,
      itemName: source.listingItem?.trim() || source.localDirectoryName || source.title,
      description: source.listingDescription?.trim() ?? '',
      roomTheme: source.roomTheme?.trim() || source.ourCategory?.roomTheme.trim() || data.listing.roomTheme,
      orientation: normalizeListingArtworkOrientation(source.artworkOrientation),
      primaryColour: source.primaryColour ?? '',
      secondaryColour: source.secondaryColour ?? '',
    };
  });
  const sourcesWithoutDescriptions = sources.filter((source) => !source.description);
  if (sourcesWithoutDescriptions.length > 0) {
    throw new Error(`Complete the Listing Description for these grouped listings first: ${sourcesWithoutDescriptions.map((source) => source.listingName).join(', ')}.`);
  }

  const frameColours = data.etsyProducts.frames
    .filter((frame) => frame.key !== 'no_frame' && frame.enabled)
    .map((frame) => frame.key === 'oak' ? 'Natural Oak' : frame.label);
  const printSizes = data.etsyProducts.sizes.filter((size) => size.enabled);
  const personalisationAreas = data.etsyProducts.config.customisePrints
    ? [
      data.etsyProducts.config.customTop ? 'top' : null,
      data.etsyProducts.config.customBottom ? 'bottom' : null,
    ].filter((area): area is string => area !== null)
    : [];
  const orientations = Array.from(new Set(sources.map((source) => source.orientation)));
  const digitalFileGuides = orientations.map((orientation) => [
    `${orientation.toLocaleUpperCase()} ARTWORK FILES`,
    printableDownloadDescriptionGuide(orientation),
  ].join('\n')).join('\n\n');

  const prompt = buildMultipleListingDetailsPrompt({
    sectionName: data.section.sectionName,
    listingName: data.listing.localDirectoryName ?? data.listing.title,
    listingDescription: data.listing.listingDescription,
    templateName: data.template.name,
    roomTheme: data.listing.roomTheme,
    itemCount: data.template.itemCount,
    items: sources,
    printSizes: formatPhysicalPrintSizesForPrompt(printSizes),
    frameColours: frameColours.join(', '),
    personalisationDetails: personalisationAreas.length > 0 ? `Optional ${personalisationAreas.join(' and ')} text personalisation is available.` : '',
    giftMessageEnabled: data.etsyProducts.config.giftMessageEnabled,
    digitalDownloadEnabled: data.etsyProducts.config.digitalDownload,
    digitalFileGuides,
    recommendedPaper: 'Good-quality matte photo or art paper around 200–250 gsm',
    licenceType: 'Personal use only: printing for the buyer’s own home décor or one personal printed gift is permitted. File sharing, redistribution, digital resale, commercial reproduction, selling printed copies, and modifying the artwork for resale are prohibited. A printing service may receive the relevant file only to produce the permitted personal print or gift.',
  });
  const generated = await generateValidatedListingResponse(
    prompt, sendListingDetailsPrompt, parseGeneratedMultipleListingDetails,
  );
  await saveGeneratedListingDetails(context, generated);
  await saveListingDetails({
    ...context,
    quantity: data.listing.quantity && data.listing.quantity > 0 ? data.listing.quantity : 999,
    digitalQuantity: 999,
    primaryColour: generated.primaryColour,
    secondaryColour: generated.secondaryColour,
  });
  await setListingEtsySku(context);
  const refreshed = await getListingEditorData(context);
  if (!refreshed) throw new Error('The grouped Bedrock details were saved, but the listing could not be reloaded.');
  return refreshed;
}
