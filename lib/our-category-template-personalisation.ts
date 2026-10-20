import { readFile } from 'node:fs/promises';
import path from 'node:path';

import sharp from 'sharp';

import {
  DEFAULT_PRINTSHRIMP_CUSTOM_FONT_ID,
  getPrintShrimpCustomFont,
  type PrintShrimpCustomFontId,
} from '@/lib/printshrimp/custom-fonts';
import { createPersonalisedPrintMaster } from '@/lib/thumbnail-personalisation';
import type { PersonalisationTextArea } from '@/lib/personalisation-text-areas';

export const OUR_CATEGORY_TEMPLATE_TEXT_MAX_LENGTH = 40;

export type OurCategoryTemplatePersonalisation = {
  topText: string;
  bottomText: string;
  fontId: PrintShrimpCustomFontId;
};

export type OurCategoryTemplateTextPlacement = {
  showTop: boolean;
  showBottom: boolean;
  top?: PersonalisationTextArea;
  bottom?: PersonalisationTextArea;
};

function textValue(value: unknown, label: string) {
  if (value === null || value === undefined) return '';
  if (typeof value !== 'string') throw new Error(`${label} is invalid.`);
  const trimmed = value.trim();
  if (trimmed.length > OUR_CATEGORY_TEMPLATE_TEXT_MAX_LENGTH) {
    throw new Error(`${label} must be ${OUR_CATEGORY_TEMPLATE_TEXT_MAX_LENGTH} characters or fewer.`);
  }
  return trimmed;
}

export function validateOurCategoryTemplatePersonalisation(
  topTextValue: unknown,
  bottomTextValue: unknown,
  fontIdValue: unknown,
): OurCategoryTemplatePersonalisation {
  const topText = textValue(topTextValue, 'Top Text');
  const bottomText = textValue(bottomTextValue, 'Bottom Text');
  const fontId = fontIdValue === null || fontIdValue === undefined || fontIdValue === ''
    ? DEFAULT_PRINTSHRIMP_CUSTOM_FONT_ID
    : fontIdValue;
  const font = getPrintShrimpCustomFont(fontId);
  if (!font) throw new Error('Select a valid font.');
  return { topText, bottomText, fontId: font.id };
}

export async function prepareOurCategoryTemplateArtwork(
  source: Buffer,
  personalisation: OurCategoryTemplatePersonalisation,
  placement?: OurCategoryTemplateTextPlacement,
) {
  const topText = placement?.showTop === false ? '' : personalisation.topText;
  const bottomText = placement?.showBottom === false ? '' : personalisation.bottomText;
  if (!topText && !bottomText) return source;
  const font = getPrintShrimpCustomFont(personalisation.fontId);
  if (!font) throw new Error('Select a valid font.');

  const normalized = await sharp(source, { failOn: 'error' })
    .rotate()
    .toColourspace('srgb')
    .ensureAlpha()
    .png()
    .toBuffer({ resolveWithObject: true });
  if (!normalized.info.width || !normalized.info.height) throw new Error('The attached image has invalid dimensions.');
  const fontContents = await readFile(path.join(process.cwd(), 'public', 'fonts', ...font.relativePath));
  const result = await createPersonalisedPrintMaster(
    normalized.data,
    fontContents,
    {
      headerText: topText,
      footerText: bottomText,
      textTransform: 'NONE',
    },
    {
      width: normalized.info.width,
      height: normalized.info.height,
      density: 300,
      requireSourceAlpha: false,
      fontFamily: font.family,
      fontWeight: font.weight,
      ...(placement?.top && topText ? { headerTextArea: placement.top } : {}),
      ...(placement?.bottom && bottomText ? { footerTextArea: placement.bottom } : {}),
    },
  );
  return result.buffer;
}
