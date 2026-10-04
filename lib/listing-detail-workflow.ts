import {
  buildAspectRatiosImagePrompt,
  buildBedroomDoorImagePrompt,
  buildBedroomImagePrompt,
  buildBesideBedImagePrompt,
  buildCustomisedPlayroomImagePrompt,
  buildCustomisedShelveImagePrompt,
  buildDigitalDownloadIncludedImagePrompt,
  buildHowToPrintIncludedImagePrompt,
  buildListingImagePrompt,
  buildNoFrameIncludedImagePrompt,
  buildPerfectGiftImagePrompt,
  buildPersonalUseIncludedImagePrompt,
  buildPlayroomImagePrompt,
  buildSizesImagePrompt,
  buildThreeFramesImagePrompt,
} from '@/lib/listing-prompts';
import {
  buildCameronsImagePrompt,
  buildGuysImagePrompt,
  buildIslasImagePrompt,
  buildVickiesImagePrompt,
} from '@/lib/image-personalisation-prompt';
import { getPersonalisationFont } from '@/lib/personalisation-fonts';
import type { LocalPersonalisationSpec } from '@/lib/thumbnail-personalisation';
import {
  buildThumbnailIllustrationPrompt,
  buildThumbnailPrintMasterPrompt,
  THUMBNAIL_PRINT_MASTER_HEIGHT_PX,
  THUMBNAIL_PRINT_MASTER_WIDTH_PX,
} from '@/lib/thumbnail-generate-prompt';

export const LISTING_DETAIL_IMAGE_KEYS = [
  'listing-image',
  'bedroom-image',
  'playroom-image',
  'perfect-gift-image',
  'frames-image',
  'sizes-image',
  'aspect-ratios-image',
  'customised-shelve-image',
  'customised-bedroom-door-image',
  'customised-beside-bed-image',
  'customised-playroom-image',
  'no-frames-included-image',
  'digital-download-image',
  'how-to-print-image',
  'personal-use-only-image',
] as const;

export type ListingDetailImageKey = typeof LISTING_DETAIL_IMAGE_KEYS[number];

export const CUSTOMISED_LISTING_DETAIL_IMAGE_KEYS = [
  'customised-shelve-image',
  'customised-bedroom-door-image',
  'customised-beside-bed-image',
  'customised-playroom-image',
] as const satisfies readonly ListingDetailImageKey[];

export type CustomisedListingDetailImageKey = typeof CUSTOMISED_LISTING_DETAIL_IMAGE_KEYS[number];

export function isCustomisedListingDetailImageKey(value: string): value is CustomisedListingDetailImageKey {
  return (CUSTOMISED_LISTING_DETAIL_IMAGE_KEYS as readonly string[]).includes(value);
}

export function isListingDetailImageStale(
  imageUpdatedAt: string | null | undefined,
  thumbnailUpdatedAt: string | null | undefined,
) {
  if (!imageUpdatedAt || !thumbnailUpdatedAt) return false;
  const imageTime = Date.parse(imageUpdatedAt);
  const thumbnailTime = Date.parse(thumbnailUpdatedAt);
  if (!Number.isFinite(imageTime) || !Number.isFinite(thumbnailTime)) return false;
  return imageTime < thumbnailTime;
}

export const CUSTOMISED_SHELVE_INDIVIDUAL_ACTIONS = [
  { stepIndex: 0, label: '1. Generate artwork', outputBaseName: 'generated-artwork' },
  { stepIndex: 1, label: '2. Download and name print master', outputBaseName: 'print-master' },
  { stepIndex: 2, label: '3. Generate image with letters', outputBaseName: 'print-master-with-letters' },
  { stepIndex: 3, label: '4. Generate customised shelve image', outputBaseName: 'customised-shelve-image' },
] as const;

export const LISTING_DETAIL_IMAGE_ROWS: ReadonlyArray<{
  key: ListingDetailImageKey;
  label: string;
  position: number;
}> = [
  { key: 'listing-image', label: 'Listing image', position: 1 },
  { key: 'bedroom-image', label: 'Bedroom image', position: 2 },
  { key: 'playroom-image', label: 'Playroom image', position: 3 },
  { key: 'perfect-gift-image', label: 'Perfect gift image', position: 4 },
  { key: 'frames-image', label: 'Frames image', position: 5 },
  { key: 'sizes-image', label: 'Sizes image', position: 6 },
  { key: 'aspect-ratios-image', label: 'Aspect ratios image', position: 7 },
  { key: 'customised-shelve-image', label: 'Customised shelve image', position: 8 },
  { key: 'customised-bedroom-door-image', label: 'Customised bedroom door image', position: 9 },
  { key: 'customised-beside-bed-image', label: 'Customised beside table image', position: 10 },
  { key: 'customised-playroom-image', label: 'Customised playroom image', position: 11 },
  { key: 'no-frames-included-image', label: 'No frames included image', position: 12 },
  { key: 'digital-download-image', label: 'Digital download image', position: 13 },
  { key: 'how-to-print-image', label: 'How to print image', position: 14 },
  { key: 'personal-use-only-image', label: 'Personal use only image', position: 15 },
];

type ListingDetailPromptInput = {
  roomTheme: string;
  listingItem: string;
  listingDescription?: string;
  sectionName?: string;
  sourceWidth?: number;
  sourceHeight?: number;
};

export type ListingDetailPromptStep = {
  prompt: string;
  includeFont: boolean;
  outputKind?: 'inline_image' | 'download_file';
  processor?: 'chatgpt' | 'local_print_master' | 'local_personalisation';
  localPersonalisation?: LocalPersonalisationSpec;
};

type ListingDetailPromptOptions = {
  includeThumbnailGeneration?: boolean;
};

export function buildListingDetailPromptSteps(
  key: ListingDetailImageKey,
  input: ListingDetailPromptInput,
  options: ListingDetailPromptOptions = {},
): ListingDetailPromptStep[] {
  const nunitoRegular = getPersonalisationFont('nunito');
  if (!nunitoRegular) throw new Error('Nunito Regular is not configured.');
  const { roomTheme, listingItem } = input;
  const personalisedMasterDimensions = {
    sourceWidth: THUMBNAIL_PRINT_MASTER_WIDTH_PX,
    sourceHeight: THUMBNAIL_PRINT_MASTER_HEIGHT_PX,
  };
  const customisedPreparationSteps = (): ListingDetailPromptStep[] => [
    ...(options.includeThumbnailGeneration ? [{
      prompt: buildThumbnailIllustrationPrompt({
        animal: listingItem,
        listingDescription: input.listingDescription ?? '',
        collectionTheme: roomTheme,
        sectionName: input.sectionName ?? '',
      }),
      includeFont: false,
    }] : []),
    {
      prompt: buildThumbnailPrintMasterPrompt(),
      includeFont: false,
      outputKind: 'download_file',
      processor: 'local_print_master',
    },
  ];

  switch (key) {
    case 'listing-image':
      return [{ prompt: buildListingImagePrompt(roomTheme), includeFont: false }];
    case 'bedroom-image':
      return [{ prompt: buildBedroomImagePrompt(roomTheme, listingItem), includeFont: false }];
    case 'playroom-image':
      return [{ prompt: buildPlayroomImagePrompt(roomTheme, listingItem), includeFont: false }];
    case 'perfect-gift-image':
      return [{ prompt: buildPerfectGiftImagePrompt(roomTheme, listingItem), includeFont: false }];
    case 'frames-image':
      return [{ prompt: buildThreeFramesImagePrompt(roomTheme, listingItem), includeFont: false }];
    case 'sizes-image':
      return [{ prompt: buildSizesImagePrompt(roomTheme, listingItem), includeFont: false }];
    case 'aspect-ratios-image':
      return [{ prompt: buildAspectRatiosImagePrompt(), includeFont: false }];
    case 'customised-shelve-image':
      return [
        ...customisedPreparationSteps(),
        {
          prompt: buildIslasImagePrompt(nunitoRegular, personalisedMasterDimensions),
          includeFont: true,
          outputKind: 'download_file',
          processor: 'local_personalisation',
          localPersonalisation: { headerText: "Isla's bedroom", footerText: 'Keep out', textTransform: 'NONE' },
        },
        { prompt: buildCustomisedShelveImagePrompt(roomTheme, listingItem), includeFont: true },
      ];
    case 'customised-bedroom-door-image':
      return [
        ...customisedPreparationSteps(),
        {
          prompt: buildCameronsImagePrompt(nunitoRegular, personalisedMasterDimensions),
          includeFont: true,
          outputKind: 'download_file',
          processor: 'local_personalisation',
          localPersonalisation: { headerText: "Cameron's", footerText: 'Room', textTransform: 'NONE' },
        },
        { prompt: buildBedroomDoorImagePrompt(roomTheme, listingItem), includeFont: true },
      ];
    case 'customised-beside-bed-image':
      return [
        ...customisedPreparationSteps(),
        {
          prompt: buildGuysImagePrompt(nunitoRegular, personalisedMasterDimensions),
          includeFont: true,
          outputKind: 'download_file',
          processor: 'local_personalisation',
          localPersonalisation: { headerText: "Guy's Bedroom", footerText: '', textTransform: 'UPPERCASE' },
        },
        { prompt: buildBesideBedImagePrompt(roomTheme, listingItem), includeFont: true },
      ];
    case 'customised-playroom-image':
      return [
        ...customisedPreparationSteps(),
        {
          prompt: buildVickiesImagePrompt(nunitoRegular, personalisedMasterDimensions),
          includeFont: true,
          outputKind: 'download_file',
          processor: 'local_personalisation',
          localPersonalisation: { headerText: '', footerText: "Vickie's Playroom", textTransform: 'NONE' },
        },
        { prompt: buildCustomisedPlayroomImagePrompt(roomTheme, listingItem), includeFont: true },
      ];
    case 'no-frames-included-image':
      return [{ prompt: buildNoFrameIncludedImagePrompt(roomTheme, listingItem), includeFont: false }];
    case 'digital-download-image':
      return [{ prompt: buildDigitalDownloadIncludedImagePrompt(roomTheme, listingItem), includeFont: false }];
    case 'how-to-print-image':
      return [{ prompt: buildHowToPrintIncludedImagePrompt(roomTheme, listingItem), includeFont: false }];
    case 'personal-use-only-image':
      return [{ prompt: buildPersonalUseIncludedImagePrompt(roomTheme, listingItem), includeFont: false }];
  }
}

export function buildListingDetailClipboardPrompt(
  key: ListingDetailImageKey,
  input: ListingDetailPromptInput,
) {
  const steps = buildListingDetailPromptSteps(key, input);
  if (steps.length === 1) return steps[0].prompt;
  return steps.map((step, index) => `STAGE ${index + 1}\n\n${step.prompt}`).join('\n\n---\n\n');
}

export function buildListingDetailActionPrompt(
  key: ListingDetailImageKey,
  input: ListingDetailPromptInput,
) {
  const steps = buildListingDetailPromptSteps(key, input);
  return steps[steps.length - 1].prompt;
}
