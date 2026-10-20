import { BedrockRuntimeClient, ConverseCommand } from '@aws-sdk/client-bedrock-runtime';
import {
  buildCombinedListingDetailsPrompt,
  missingCombinedListingDetailsPromptFields,
  parseGeneratedListingDetails,
} from '@/lib/combined-listing-details-prompt';
import {
  getListingEditorData,
  saveGeneratedListingDetails,
  saveListingDetails,
  setListingColoursFromThumbnail,
  setListingEtsySku,
  type ListingEditorContext,
} from '@/lib/listing-editor';
import { PRINTABLE_DOWNLOAD_SPECS } from '@/lib/printable-download-specs';

// This model is available for on-demand inference in the application's default
// eu-west-2 region. Keep AWS_BEDROCK_MODEL_ID as an escape hatch for accounts
// that use a different model or an inference-profile ARN/ID.
export const DEFAULT_BEDROCK_MODEL_ID = 'anthropic.claude-sonnet-4-6';

function bedrockSettings() {
  const region = process.env.AWS_REGION?.trim() || process.env.AWS_DEFAULT_REGION?.trim();
  if (!region) throw new Error('Set AWS_REGION before generating listing details with AWS Bedrock.');
  const modelId = process.env.AWS_BEDROCK_MODEL_ID?.trim() || DEFAULT_BEDROCK_MODEL_ID;
  return { client: new BedrockRuntimeClient({ region }), modelId, region };
}

function isInvalidModelIdentifier(error: unknown) {
  if (!(error instanceof Error)) return false;
  return error.name === 'ValidationException'
    && error.message.toLowerCase().includes('model identifier');
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
  const printSizes = data.etsyProducts.sizes.filter((size) => size.enabled).map((size) => size.label);
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
    printSizes: printSizes.join(', '),
    frameColours: frameColours.join(', '),
    personalisationDetails: personalisationAreas.length > 0 ? `Optional ${personalisationAreas.join(' and ')} text personalisation is available.` : '',
    giftMessageEnabled: data.etsyProducts.config.giftMessageEnabled,
    digitalFilesIncluded: PRINTABLE_DOWNLOAD_SPECS.map((spec) => `${spec.label} (${spec.portraitWidth} x ${spec.portraitHeight}px)`).join(', '),
    orientation: data.listing.artworkOrientation,
    fileType: 'jpeg',
    recommendedPaper: data.materials.map(({ value }) => value).join(', ') || 'Heavyweight matte photo paper, approximately 200-250 gsm',
    licenceType: 'Personal use only',
  };
  const missing = missingCombinedListingDetailsPromptFields(values);
  if (missing.length > 0) throw new Error(`Complete ${missing.join(', ')} on Overview before generating details.`);
  const { client, modelId, region } = bedrockSettings();
  let response;
  try {
    response = await client.send(new ConverseCommand({
      modelId,
      messages: [{ role: 'user', content: [{ text: buildCombinedListingDetailsPrompt(values) }] }],
      inferenceConfig: { maxTokens: 10000, temperature: 0.3 },
    }));
  } catch (error) {
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
  const generated = parseGeneratedListingDetails(responseText);
  await saveGeneratedListingDetails(context, generated);
  await saveListingDetails({ ...context, quantity: data.listing.quantity && data.listing.quantity > 0 ? data.listing.quantity : 999, digitalQuantity: 999 });
  await setListingEtsySku(context);
  await setListingColoursFromThumbnail(context);
  const refreshed = await getListingEditorData(context);
  if (!refreshed) throw new Error('The Bedrock details were saved, but the listing could not be reloaded.');
  return refreshed;
}
