import type { PersonalisationFont } from '@/lib/personalisation-fonts';

export const PERSONALISATION_SOURCE_WIDTH_PX = 1446;
export const PERSONALISATION_SOURCE_HEIGHT_PX = 2048;

export type PersonalisationPromptMode = 'top' | 'bottom' | 'both';

type PreparePersonalisationPromptInput = {
  mode: PersonalisationPromptMode;
  headerText: string;
  footerText: string;
  font: PersonalisationFont;
  sourceWidth: number;
  sourceHeight: number;
  loadFont: (font: PersonalisationFont) => Promise<void>;
};

export type PreparedPersonalisationPrompt = {
  prompt: string;
  headerText: string;
  footerText: string;
  sourceWidth: number;
  sourceHeight: number;
};

export function textForPersonalisationMode(mode: PersonalisationPromptMode, headerText: string, footerText: string) {
  return {
    headerText: mode === 'bottom' ? '' : headerText,
    footerText: mode === 'top' ? '' : footerText,
  };
}

export function buildImagePersonalisationPrompt(input: {
  headerText: string;
  footerText: string;
  font: PersonalisationFont;
  sourceWidth: number;
  sourceHeight: number;
  textTransform?: 'UPPERCASE' | 'NONE';
}) {
  return `HEADER_TEXT = ${JSON.stringify(input.headerText)}
FOOTER_TEXT = ${JSON.stringify(input.footerText)}

FONT_NAME = ${JSON.stringify(input.font.family)}
FONT_WEIGHT = ${input.font.weight}
FONT_WIDTH = 100
FONT_FILE_NAME = ${JSON.stringify(input.font.downloadFileName)}

TEXT_TRANSFORM = ${JSON.stringify(input.textTransform ?? 'UPPERCASE')}
TARGET_TEXT_WIDTH_PERCENT = 65
MAX_FONT_SIZE_PERCENT = 18

HEADER_CURVE = "ARCH_UP"
FOOTER_CURVE = "ARCH_DOWN"
CURVE_RISE_PERCENT_OF_LINE_WIDTH = 5

SOURCE_WIDTH_PX = ${input.sourceWidth}
SOURCE_HEIGHT_PX = ${input.sourceHeight}

Use the attached original image and attached font file.

Perform this task programmatically using Python and Pillow, or an equivalent deterministic text-rendering library.

Do not use AI image generation to draw the text or recreate the artwork.

IMAGE VERIFICATION

- Verify that the attached image matches SOURCE_WIDTH_PX and SOURCE_HEIGHT_PX.
- If it does not match, explain the mismatch and request the correct original image before proceeding.
- Preserve the original image dimensions exactly.
- Preserve the source background and any existing transparency.

FONT

- Load the supplied font file specified by FONT_FILE_NAME.
- Verify that the supplied font belongs to the FONT_NAME family and supports FONT_WEIGHT.
- Use the weight specified by FONT_WEIGHT.
- If the supplied file is a variable font, explicitly set its wght axis to FONT_WEIGHT and its wdth axis to FONT_WIDTH if available.
- Do not rely on a variable font’s default weight.
- If the font file is unavailable, invalid or does not support the requested family and weight, request the correct font file.
- Do not silently substitute another font or simulate boldness.

UPPERCASE TRANSFORMATION

- Convert each non-empty text value to uppercase.
- Preserve punctuation, apostrophes, numbers and spaces.
- Do not otherwise rewrite the wording.
- Leave an empty text value absent.

SMOOTH CURVED TEXT

- Arrange the header along a gentle, symmetrical upward arch (HEADER_CURVE). Its middle must sit higher than its left and right ends.
- Arrange the footer along a gentle, symmetrical downward arch (FOOTER_CURVE). Its middle must sit lower than its left and right ends.
- Use a smooth circular baseline rather than random letter offsets.
- Set the baseline’s centre-to-end rise or fall to CURVE_RISE_PERCENT_OF_LINE_WIDTH percent of that line’s uncurved advance width.
- Calculate the curve separately for each line using the same percentage.
- Do not force shorter text to match the longer line’s width.

Place the letters naturally along the curve:

- Render individual glyphs using their normal font metrics and baseline positions.
- Use the font’s advance widths and kerning to determine spacing.
- Map the character positions onto the circular baseline by distance along the arc.
- Rotate each glyph only as needed to follow the local tangent of the curve.
- Characters near the centre should be approximately upright.
- Characters towards the ends should tilt gradually and symmetrically with the arch.
- Preserve the apostrophe’s natural raised position relative to the baseline.
- Spaces retain their normal advance width.
- Maintain comfortable, consistent spacing and prevent visible glyph collisions.

Do not use individual orientation arrays, repeating rotation patterns, random tilts or random vertical offsets.

Do not bend, warp, stretch, shear or distort the glyph shapes. The curve must come from positioning and rotating intact glyphs.

AUTOMATIC SHARED FONT SIZE

Calculate one shared font size for all non-empty lines:

1. Set the maximum completed-line width to TARGET_TEXT_WIDTH_PERCENT percent of the image width.
2. Set the maximum permitted font size to MAX_FONT_SIZE_PERCENT percent of the image width.
3. Assemble each curved line, including tangent rotations, punctuation and anti-aliased edges.
4. Measure each completed line’s final visible bounding box.
5. Select the largest whole-number font size for which:
   - Every completed line fits within the maximum width.
   - The header fits entirely between 5% and 15% of the image height.
   - The footer fits entirely between 85% and 95% of the image height.
   - Both lines remain clear of the illustration.
   - No character is clipped.
6. Use exactly the same font size for the header and footer.

The text should be prominent while retaining the actual appearance of the requested font weight.

Do not independently resize the lines, stretch them to reach the target width, compress, wrap or truncate the text.

If the illustration extends into a text area, reduce the shared font size as needed. Do not move or resize the artwork. If no usable placement is possible, explain the conflict.

LETTER RENDERING QUALITY

- Render glyphs and assemble curved text on tightly sized transparent text layers at four times their final resolution.
- Do not upscale the original artwork or the entire image for text rendering.
- Rotate high-resolution glyphs using bicubic resampling.
- Downsample each completed text layer using Lanczos resampling.
- Preserve smooth anti-aliased edges.
- Do not blur or artificially thicken the text.

LINE MEASUREMENT AND POSITIONING

- Measure each complete curved line using its final visible bounding box.
- Centre each completed line horizontally using that bounding box.
- Position the header’s final visible top edge 5% of the image height below the top edge, rounded to the nearest pixel.
- Position the footer’s final visible bottom edge 5% of the image height above the bottom edge, rounded to the nearest pixel.
- Keep the complete header above the 15% image-height boundary.
- Keep the complete footer below the 85% image-height boundary.
- Keep all text clear of the illustration, including antennae, foliage and ground details.
- Do not clip any character or anti-aliased edge.

TEXT COLOUR

- Analyse the artwork’s palette and the backgrounds behind both text positions.
- Evaluate transparent areas against pure white for contrast, while preserving transparency in the output.
- Prefer a dark, subdued green when it suits the artwork.
- Use exactly the same text colour for both lines.
- Ensure readable contrast at every active text position.
- Darken or lighten a sampled shade while preserving its hue if necessary.
- Do not use pure black unless no suitable palette-derived colour provides sufficient contrast.

RENDERING RESTRICTIONS

- Overlay only the requested curved text.
- Do not add outlines, shadows, boxes, banners or background panels.
- Do not crop, resize, reposition, regenerate, redraw, recolour or filter the artwork.
- Preserve original pixels everywhere outside the anti-aliased text.
- Preserve the original colour profile and resolution metadata where supported.
- Preserve the original transparency wherever text is not added.

OUTPUT

- Export the completed image as a lossless PNG at the original width and height.
- Provide the completed PNG as a downloadable file.
- Report the font family and filename, selected weight, calculated shared font size in pixels, text colour hex code and image dimensions.
- Confirm the header follows a smooth upward arch and the footer follows a smooth downward arch, each with a curve rise or fall of CURVE_RISE_PERCENT_OF_LINE_WIDTH percent of its uncurved advance width.
- Confirm that the artwork was not moved, resized or recreated.`;
}

export function buildCameronsImagePrompt(font: PersonalisationFont) {
  return buildImagePersonalisationPrompt({
    headerText: "Cameron's",
    footerText: 'Room',
    font,
    sourceWidth: PERSONALISATION_SOURCE_WIDTH_PX,
    sourceHeight: PERSONALISATION_SOURCE_HEIGHT_PX,
    textTransform: 'NONE',
  });
}

export function buildGuysImagePrompt(font: PersonalisationFont) {
  return buildImagePersonalisationPrompt({
    headerText: "Guy's Bedroom",
    footerText: '',
    font,
    sourceWidth: PERSONALISATION_SOURCE_WIDTH_PX,
    sourceHeight: PERSONALISATION_SOURCE_HEIGHT_PX,
    textTransform: 'UPPERCASE',
  });
}

export function buildVickiesImagePrompt(font: PersonalisationFont) {
  return buildImagePersonalisationPrompt({
    headerText: '',
    footerText: "Vickie's Playroom",
    font,
    sourceWidth: PERSONALISATION_SOURCE_WIDTH_PX,
    sourceHeight: PERSONALISATION_SOURCE_HEIGHT_PX,
    textTransform: 'NONE',
  });
}

export function buildIslasImagePrompt(font: PersonalisationFont) {
  return buildImagePersonalisationPrompt({
    headerText: "Isla's bedroom",
    footerText: 'Keep out',
    font,
    sourceWidth: PERSONALISATION_SOURCE_WIDTH_PX,
    sourceHeight: PERSONALISATION_SOURCE_HEIGHT_PX,
    textTransform: 'NONE',
  });
}

export async function prepareImagePersonalisationPrompt(input: PreparePersonalisationPromptInput): Promise<PreparedPersonalisationPrompt> {
  const text = textForPersonalisationMode(input.mode, input.headerText, input.footerText);
  if (![text.headerText, text.footerText].some((value) => value.trim().length > 0)) {
    throw new Error('Enter text for this personalisation prompt before copying it.');
  }
  if (!Number.isSafeInteger(input.sourceWidth) || !Number.isSafeInteger(input.sourceHeight)
    || input.sourceWidth <= 0 || input.sourceHeight <= 0) {
    throw new Error('The source image dimensions are invalid.');
  }

  await input.loadFont(input.font);

  return {
    ...text,
    sourceWidth: input.sourceWidth,
    sourceHeight: input.sourceHeight,
    prompt: buildImagePersonalisationPrompt({
      ...text,
      font: input.font,
      sourceWidth: input.sourceWidth,
      sourceHeight: input.sourceHeight,
    }),
  };
}
