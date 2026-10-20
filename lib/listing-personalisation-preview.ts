import sharp from 'sharp';

import { LISTING_PAPER_SIZE_SPECS } from '@/lib/listing-paper-size-groups';
import { prepareOurCategoryTemplateArtwork } from '@/lib/our-category-template-personalisation';
import type { ListingPersonalisationTextAreas } from '@/lib/personalisation-text-areas';
import { createPrintableDownload } from '@/lib/printable-download-generator';
import type { ListingArtworkOrientation, PrintArtworkPlacement, PrintCropRegion } from '@/lib/listing-print-crops';
import type { EtsyProductSizeKey } from '@/lib/listing-products';
import type { PrintShrimpCustomFontId } from '@/lib/printshrimp/custom-fonts';

const PREVIEW_LONG_EDGE = 1400;

export type ListingPersonalisationPreviewInput = {
  sizeKey: EtsyProductSizeKey;
  topText: string;
  bottomText: string;
  fontId: PrintShrimpCustomFontId;
  borderEnabled: boolean;
  borderSizePercent: number;
  textAreas: ListingPersonalisationTextAreas;
  cropRegion: PrintCropRegion;
  artworkPlacement: PrintArtworkPlacement;
  orientation: ListingArtworkOrientation;
};

export function listingPersonalisationPreviewDimensions(sizeKey: EtsyProductSizeKey, landscape: boolean) {
  const paper = LISTING_PAPER_SIZE_SPECS[sizeKey];
  if (!paper) throw new Error('Choose a supported paper size.');
  const portraitWidth = Math.max(1, Math.round(PREVIEW_LONG_EDGE * paper.widthMillimetres / paper.heightMillimetres));
  return landscape
    ? { width: PREVIEW_LONG_EDGE, height: portraitWidth, ratio: paper.ratio }
    : { width: portraitWidth, height: PREVIEW_LONG_EDGE, ratio: paper.ratio };
}

async function applyWhiteBorder(source: Buffer, width: number, height: number, borderSizePercent: number) {
  const border = Math.max(1, Math.round(Math.min(width, height) * borderSizePercent / 100));
  const innerWidth = width - (border * 2);
  const innerHeight = height - (border * 2);
  if (innerWidth < 1 || innerHeight < 1) throw new Error('The selected border is too large for this paper size.');
  const artwork = await sharp(source, { failOn: 'error' })
    .resize({ width: innerWidth, height: innerHeight, fit: 'inside', withoutEnlargement: false, kernel: sharp.kernel.lanczos3 })
    .toBuffer({ resolveWithObject: true });
  return sharp({ create: { width, height, channels: 3, background: '#FFFFFF' } })
    .composite([{
      input: artwork.data,
      left: Math.round((width - artwork.info.width) / 2),
      top: Math.round((height - artwork.info.height) / 2),
    }])
    .png({ compressionLevel: 9 })
    .toBuffer();
}

export async function createListingPersonalisationPreview(source: Buffer, input: ListingPersonalisationPreviewInput) {
  if (input.borderEnabled && (!Number.isFinite(input.borderSizePercent) || input.borderSizePercent < 2.5 || input.borderSizePercent > 10)) {
    throw new Error('Border Size must be between 2.5% and 10%.');
  }
  const metadata = await sharp(source, { failOn: 'error' }).metadata();
  if (!metadata.width || !metadata.height) throw new Error('The listing thumbnail has invalid dimensions.');
  const dimensions = listingPersonalisationPreviewDimensions(input.sizeKey, input.orientation === 'landscape');
  const paper = await createPrintableDownload(
    source,
    dimensions.ratio,
    'Preview',
    dimensions,
    input.cropRegion,
    input.artworkPlacement,
  );
  const personalised = await prepareOurCategoryTemplateArtwork(
    paper.buffer,
    { topText: input.topText, bottomText: input.bottomText, fontId: input.fontId },
    {
      showTop: input.textAreas.showTop,
      showBottom: input.textAreas.showBottom,
      ...(input.textAreas.showTop ? { top: input.textAreas.top } : {}),
      ...(input.textAreas.showBottom ? { bottom: input.textAreas.bottom } : {}),
    },
  );
  const bordered = input.borderEnabled
    ? await applyWhiteBorder(personalised, dimensions.width, dimensions.height, input.borderSizePercent)
    : personalised;
  const buffer = await sharp(bordered, { failOn: 'error' })
    .flatten({ background: '#FFFFFF' })
    .toColourspace('srgb')
    .webp({ quality: 88, effort: 4 })
    .toBuffer();
  return { buffer, width: dimensions.width, height: dimensions.height };
}
