export type ThumbnailGeneratePromptInput = {
  numberOfAnimals: number | null;
  animals: string;
  collectionTheme: string;
  sectionName: string;
};

export function missingThumbnailGeneratePromptFields(input: ThumbnailGeneratePromptInput) {
  const missing: string[] = [];
  if (!Number.isSafeInteger(input.numberOfAnimals) || (input.numberOfAnimals ?? 0) < 1) missing.push('Number of items');
  if (!input.animals.trim()) missing.push('Listing description');
  if (!input.collectionTheme.trim()) missing.push('Room theme');
  return missing;
}

export function animalTypeForThumbnailPrompt(sectionName: string, collectionTheme: string) {
  const category = `${sectionName} ${collectionTheme}`.toLocaleLowerCase();
  if (/bug|insect/.test(category)) return 'insect';
  if (/dinosaur/.test(category)) return 'dinosaur';
  if (/farm/.test(category)) return 'farm animal';
  if (/sea|ocean|marine|coastal/.test(category)) return 'sea creature';
  if (/jungle|safari/.test(category)) return 'wild animal';
  if (/woodland|forest/.test(category)) return 'woodland animal';
  return 'animal';
}

export type ThumbnailIllustrationPromptInput = {
  animal: string;
  listingDescription: string;
  collectionTheme: string;
  sectionName: string;
};

function sentenceCase(value: string) {
  const trimmed = value.trim();
  return trimmed ? `${trimmed.charAt(0).toLocaleUpperCase()}${trimmed.slice(1)}` : '';
}

export function thumbnailIllustrationPromptValues(input: ThumbnailIllustrationPromptInput) {
  const listingDescription = input.listingDescription.trim();
  const descriptionParts = listingDescription.match(/^(.+?)\s+(?:—|–|-)\s+(.+)$/s);
  const animal = descriptionParts?.[1].trim() || input.animal.trim();
  const animalDescription = sentenceCase(descriptionParts?.[2] ?? listingDescription);
  const theme = input.collectionTheme.trim();

  return {
    animal,
    animalDescription,
    collectionTheme: theme ? `Soft ${theme.toLocaleLowerCase()}-inspired nursery wall art` : '',
    animalType: sentenceCase(animalTypeForThumbnailPrompt(input.sectionName, theme)),
  };
}

export function missingThumbnailIllustrationPromptFields(input: ThumbnailIllustrationPromptInput) {
  const values = thumbnailIllustrationPromptValues(input);
  const missing: string[] = [];
  if (!values.animal) missing.push('Listing item');
  if (!input.listingDescription.trim()) missing.push('Listing description');
  if (!input.collectionTheme.trim()) missing.push('Room theme');
  return missing;
}

export function buildThumbnailIllustrationPrompt(input: ThumbnailIllustrationPromptInput) {
  const missing = missingThumbnailIllustrationPromptFields(input);
  if (missing.length > 0) throw new Error(`Fill in ${missing.join(', ')} before copying Thumbnail prompt 1.`);

  const values = thumbnailIllustrationPromptValues(input);

  return `ANIMAL = "${values.animal}"
ANIMAL_DESCRIPTION = "${values.animalDescription}"
COLLECTION_THEME = "${values.collectionTheme}"
ANIMAL_TYPE = "${values.animalType}"

Create one original standalone illustration for premium children’s nursery wall art.

Generate one image containing one animal only.

ARTWORK STYLE

Contemporary children’s illustration with:

- Soft, rounded shapes
- A warm, gentle expression
- Sweet, appealing features
- Soft painted texture
- Clean, delicate edges
- A calm, premium nursery-art appearance

The mood should be cheerful, peaceful, gentle, innocent, and lightly magical.

Do not copy an existing character or a specific artist’s exact style.

COLOUR PALETTE

Use muted, nursery-friendly colours appropriate to ANIMAL and COLLECTION_THEME.

Suggested colours include warm cream, soft ivory, pale sand beige, muted honey gold, soft caramel, gentle taupe, muted sage green, pale eucalyptus green, soft olive, delicate fern green, soft moss green, warm charcoal, and delicate blush.

Apply these colours only within the illustration. Do not apply a coloured wash or paper texture across the background.

ANIMAL AND SCENERY

Make ANIMAL the clear main subject.

Include a small amount of supporting scenery appropriate to COLLECTION_THEME, such as a compact sand or ground patch, a few small stones, or delicate plants.

Keep the scenery close to the animal and secondary to it.

Treat the animal and all supporting scenery as one compact composition.

Do not include unrelated animals or decorative themes.

Avoid wide spreading scenery, tall plants, distant scenery, floating particles, and isolated decorative dots.

COMPOSITION

Use a portrait canvas.

Place the complete composition approximately in the centre, with generous clear space around every edge.

Keep the animal, limbs, tail, plants, stones, ground patch, and all painted details fully inside the canvas.

Do not crop any part of the illustration.

Exact print dimensions, percentage borders, and final centring will be applied separately after generation. At this stage, prioritise a complete, attractive illustration with clean transparency.

TRANSPARENT BACKGROUND

Generate a PNG with genuine transparency.

All space outside the illustration and all open gaps between illustrated objects must be transparent.

Do not add:

- A solid white, cream, or coloured background
- A checkerboard pattern
- A rectangular painted backdrop
- Background paper texture
- Atmospheric washes
- Faint background speckles or stray marks

Preserve white and cream details that belong to the animal or scenery.

Use natural, softly painted edges that look clean when placed on pure white.

AVOID

Text, letters, names, signatures, watermarks, logos, borders, frames, mockup rooms, multiple animals, collages, grids, aggressive expressions, scary teeth, photorealism, harsh shadows, dense foliage, clutter, cropped details, and unrelated decorations.

OUTPUT

Return one generated illustration in the chat image viewer.

Do not describe it as an A1 print master or claim that exact dimensions, DPI, or percentage margins have been verified. Final print preparation will happen in a separate step.`;
}

export function buildThumbnailPrintMasterPrompt() {
  return `FINAL_WIDTH_PX = 7016
FINAL_HEIGHT_PX = 9933
DPI = 300
FILE_FORMAT = "PNG"
BACKGROUND = "TRANSPARENT"

SIDE_MARGIN_MINIMUM_PERCENT = 7.5
TOP_MARGIN_MINIMUM_PERCENT = 15
BOTTOM_MARGIN_MINIMUM_PERCENT = 15

Use the attached illustration as the source artwork.

Perform this task programmatically using Python and Pillow, or an equivalent deterministic image-processing library.

Do not use AI image generation to redraw, recreate, or reposition the artwork.

GOAL

Create one verified transparent print master with:

* Equal left and right borders
* Equal top and bottom borders
* At least 7.5% of the canvas width clear on EACH side
* At least 15% of the canvas height clear at BOTH top and bottom

Aim for 7.5% side borders. Allow larger equal side borders only when the illustration’s proportions require them to satisfy the vertical minimums.

Horizontal and vertical borders do not need to equal each other.

SOURCE VERIFICATION

Open the actual attached file and inspect:

* Pixel dimensions
* Image format
* Colour mode
* Alpha channel
* Transparency around the illustration

Do not assume the image has transparency simply because the preview appears to have a plain background.

If the image is flattened onto a solid background or contains a baked-in checkerboard, explain the issue and request a genuinely transparent PNG before proceeding.

PRESERVE THE ARTWORK

Preserve the animal, plants, stones, ground patch, colours, textures, and genuine painted details.

Do not redraw, recolour, stretch, sharpen aggressively, add scenery, or crop genuine details.

Treat the entire illustration as one composition.

BACKGROUND CLEANUP

Inspect the alpha channel for isolated low-opacity pixels or accidental background residue outside the intended composition.

Compare the image against white and a contrasting background to distinguish residue from genuine soft edges.

Remove only clearly accidental background residue.

Do not apply a blanket opacity threshold across the image.

Preserve genuine pale foliage, delicate shadows, soft painted edges, and white or cream details.

If a mark cannot confidently be distinguished from genuine artwork, preserve it and include it in the measured bounds.

MEASURE THE COMPLETE ILLUSTRATION

After cleanup, calculate the bounding box of every remaining pixel with alpha greater than zero.

Include all genuine illustrated details, not just the animal.

Crop only the fully transparent padding outside this bounding box.

CALCULATE THE SAFE AREA

Use the final canvas dimensions, not the source dimensions, to calculate the borders.

Round minimum borders UP to whole pixels:

side_margin_px = ceil(
SIDE_MARGIN_MINIMUM_PERCENT / 100 × FINAL_WIDTH_PX
)

top_margin_px = ceil(
TOP_MARGIN_MINIMUM_PERCENT / 100 × FINAL_HEIGHT_PX
)

bottom_margin_px = ceil(
BOTTOM_MARGIN_MINIMUM_PERCENT / 100 × FINAL_HEIGHT_PX
)

safe_width_px = FINAL_WIDTH_PX - 2 × side_margin_px
safe_height_px = FINAL_HEIGHT_PX - top_margin_px - bottom_margin_px

For the specified 7016 × 9933 canvas:

* Minimum left margin: 527 pixels
* Minimum right margin: 527 pixels
* Minimum top margin: 1490 pixels
* Minimum bottom margin: 1490 pixels
* Maximum illustration box: 5962 × 6953 pixels

RESIZE PROPORTIONALLY

Calculate one uniform scale factor:

scale = min(
safe_width_px / illustration_width,
safe_height_px / illustration_height
)

Resize using high-quality resampling.

Round the resulting dimensions down to whole pixels so the resized illustration does not exceed the safe area.

Preserve the original aspect ratio to within unavoidable whole-pixel rounding.

Do not stretch width and height independently.

Preserve smooth alpha edges and avoid coloured or dark halos.

If upscaling is necessary, do not claim that it creates native detail at the final resolution.

CENTRE THE COMPLETE ILLUSTRATION

After resizing, measure the non-transparent bounds again, including soft edge pixels introduced during resampling.

Remove only fully transparent outer padding.

Create a fully transparent RGBA canvas exactly FINAL_WIDTH_PX × FINAL_HEIGHT_PX.

Place the complete resized illustration at:

x = floor((FINAL_WIDTH_PX - resized_illustration_width) / 2)
y = floor((FINAL_HEIGHT_PX - resized_illustration_height) / 2)

Preserve the illustration’s alpha values when placing it.

Do not centre using the face, shell, body, or perceived visual weight. Centre using the complete illustration’s measured bounds.

FINAL MARGIN VERIFICATION

Measure the alpha bounding box on the completed canvas.

Using an exclusive right and bottom bounding-box convention:

left_margin = bounding_box_left
right_margin = FINAL_WIDTH_PX - bounding_box_right
top_margin = bounding_box_top
bottom_margin = FINAL_HEIGHT_PX - bounding_box_bottom

Verify:

* left_margin ≥ side_margin_px
* right_margin ≥ side_margin_px
* top_margin ≥ top_margin_px
* bottom_margin ≥ bottom_margin_px
* abs(left_margin - right_margin) ≤ 1 pixel
* abs(top_margin - bottom_margin) ≤ 1 pixel

Every pixel within the mandatory border strips must have alpha = 0.

If a check fails, correct the scale or placement and verify again. Do not erase genuine artwork to force the borders to pass.

EXPORT

Save one PNG with:

* Exactly FINAL_WIDTH_PX × FINAL_HEIGHT_PX pixels
* Genuine RGBA transparency
* DPI × DPI resolution metadata
* An sRGB colour profile, converting correctly if the source uses another known profile
* No added text
* No background flattening

REOPEN AND CHECK

Reopen the saved PNG and verify its dimensions, alpha channel, DPI metadata, and final margins.

Allow normal PNG metadata rounding when checking 300 DPI.

Inspect a temporary white-background preview to check that the artwork remains complete and its edges look clean. Do not replace the transparent master with this preview.

DELIVERY

Return the verified final PNG as a downloadable file.

Include a short verification table showing:

* Final pixel dimensions
* DPI
* Left border: pixels and percentage of canvas width
* Right border: pixels and percentage of canvas width
* Top border: pixels and percentage of canvas height
* Bottom border: pixels and percentage of canvas height
* Whether all margin and centring checks passed

State whether the artwork was upscaled.

If any requirement cannot be met or verified, explain the limitation rather than claiming compliance.`;
}

export function buildThumbnailGeneratePrompt(input: ThumbnailGeneratePromptInput) {
  const missing = missingThumbnailGeneratePromptFields(input);
  if (missing.length > 0) throw new Error(`Fill in ${missing.join(', ')} before copying the Thumbnail prompt.`);

  const theme = input.collectionTheme.trim();
  const animalType = animalTypeForThumbnailPrompt(input.sectionName, theme);
  const themeScenery = `${theme.toLocaleLowerCase()}-inspired`;

  return `NO_OF_ANIMALS: ${input.numberOfAnimals}

ANIMALS:
${input.animals.trim()}

ORIENTATION: portrait
PRINT_LAYOUT: A1 master canvas
FINAL_WIDTH_PX: 7016
FINAL_HEIGHT_PX: 9933
DPI: 300
FILE_FORMAT: PNG
BACKGROUND: TRANSPARENT
FINAL_PRINT_BACKGROUND: pure white #FFFFFF, applied later when creating individual print sizes

COLLECTION_THEME: soft ${themeScenery} nursery wall art
ANIMAL_TYPE: ${animalType}
ANIMALS_PER_IMAGE: one animal only

MASTER_ARTWORK_PURPOSE:
Create a reusable standalone illustration that will later be placed on white canvases for the following portrait print sizes:

- A4
- A3
- A2
- 8 × 10 inches
- 11 × 14 inches
- 12 × 16 inches
- 16 × 20 inches
- 18 × 24 inches
- 20 × 28 inches
- 24 × 36 inches

Some finished prints will have personalised text above the illustration, below it, or both.

Do not generate text at this stage.

STYLE:
Original contemporary children’s wall art, soft, playful, nursery-friendly, rounded shapes, simple features, warm gentle expressions, soft painted texture, clean delicate edges, and a premium illustrated feel.

Do not copy a specific artist’s exact style or an existing character.

MOOD:
Sweet, cheerful, playful, peaceful, adventurous, gentle, innocent, lightly magical, and suitable for a young child’s bedroom.

COLOUR_PALETTE:
Warm cream, soft ivory, pale sand beige, gentle golden ochre, muted honey gold, soft caramel, warm amber, dusty terracotta, muted tiger orange, soft cocoa brown, gentle taupe, creamy milk white, muted sage green, pale eucalyptus green, soft olive, delicate fern green, soft moss green, warm charcoal grey, softened black accents, and delicate blush.

Use these colours within the animal and illustrated scenery only. Adapt them to COLLECTION_THEME and the specified animal without changing the calm, nursery-friendly feel.

Do not apply a cream tint, coloured wash, or paper texture across the canvas.

TRANSPARENT BACKGROUND:
Create a genuinely transparent PNG background with an alpha channel.

All empty space surrounding the illustration and all open gaps between leaves, limbs, antennae, flowers, and other objects must be transparent.

Do not simulate transparency with a checkerboard pattern.
Do not add a solid white, cream, ivory, or coloured background.
Do not add a rectangular painted backdrop.

Preserve cream and white details that belong to the illustration itself. Do not make those details transparent.

Soft painted edges may fade into transparency. They must look clean and natural when placed on pure white, without a cream halo or hard cutout edge.

ILLUSTRATED SCENERY:
Include sparse, delicate accents appropriate to COLLECTION_THEME as part of one compact composition around the animal.

Suitable elements, when appropriate to the animal and theme, include:

- A small soft ground patch directly beneath the animal
- A short log or small stone if appropriate to the pose
- A few pale leaves
- Small foliage shapes and leafy sprigs
- Delicate grasses
- Tiny wildflowers

Choose only accents that suit the specified animal and COLLECTION_THEME; do not add unrelated jungle, farmyard, woodland or ocean details.
Keep every accent secondary to the animal.

Keep accents close to the animal and ground patch. Avoid wide spreading branches or tall plants that make the illustration unnecessarily broad or push the animal downwards.

Do not include distant scenery, a canopy across the top, atmospheric background washes, or decoration extending towards the canvas edges.

Avoid isolated floating dots or particles outside the main composition. These must not occupy the spaces reserved for text.

COMPOSITION AND PLACEMENT:
Treat the animal, antennae, held objects, foliage, flowers, ground patch, shadows, softly painted edges, and every other illustrated detail as ONE complete illustration.

Centre that complete illustration horizontally and vertically on the master canvas.

Do not position the ground patch near the bottom edge of the page.
Do not leave a large empty area above the animal with only a small margin below the ground.
Balance the empty space above the highest illustrated detail and below the lowest illustrated detail.

The animal must remain the main focus. Keep the surrounding scenery modest so it does not make the animal appear small.

Use a compact, naturally balanced composition suitable for both narrower and wider portrait canvases.

Keep the full animal and all decorative details visible.
Do not crop antennae, ears, tails, limbs, leaves, flowers, or the ground patch.

MANDATORY MINIMUM BORDERS:
LEFT_MARGIN_MINIMUM_PERCENT: 5
RIGHT_MARGIN_MINIMUM_PERCENT: 5
TOP_MARGIN_MINIMUM_PERCENT: 15
BOTTOM_MARGIN_MINIMUM_PERCENT: 15
MAX_ILLUSTRATION_WIDTH_PERCENT: 90
MAX_ILLUSTRATION_HEIGHT_PERCENT: 70
ILLUSTRATION_CENTRE_X_PERCENT: 50
ILLUSTRATION_CENTRE_Y_PERCENT: 50

These requirements apply separately to EACH edge:

- Left: at least 5% of the full canvas width.
- Right: at least 5% of the full canvas width.
- Top: at least 15% of the full canvas height.
- Bottom: at least 15% of the full canvas height.

The horizontal requirement is not 5% shared between both sides.
The vertical requirement is not 15% shared between top and bottom.

All four minimum borders must be satisfied simultaneously.

The complete illustration must remain within:

- Horizontal bounds: 5% to 95% of canvas width.
- Vertical bounds: 15% to 85% of canvas height.

Every pixel inside the mandatory border strips must be fully transparent, with alpha = 0. No foliage, shadows, faint painted edges, stray pixels, or decorative details may enter these strips.

For the specified 7016 × 9933 pixel master canvas, use at least:

- 351 fully transparent columns on the left.
- 351 fully transparent columns on the right.
- 1490 fully transparent rows at the top.
- 1490 fully transparent rows at the bottom.

This leaves a maximum illustration box of 6314 × 6953 pixels.

Use as much of the safe area as the illustration’s natural proportions allow, without stretching or cropping.

The illustration does not have to touch all four safe-area boundaries. If its proportions require additional space on one axis, preserve that extra space symmetrically.

Opposite margins must be equal to within one pixel after centring.

These are transparent borders in the master PNG. They will appear white when placed on the finished print canvas.

MATCHING COLLECTION:
For each entry in ANIMALS, create one separate standalone image containing only that animal.

If NO_OF_ANIMALS is greater than one:

- Generate separate images, not a combined sheet.
- Keep the palette, painted texture, level of detail, and visual prominence consistent.
- Use the same placement and safe-area rules.
- Make the animals feel balanced when displayed side by side.
- Allow natural differences in anatomy without stretching animals to identical dimensions.

AVOID:
Photorealism, aggressive expressions, snarling, roaring, hunting poses, scary teeth, threatening poses, dark moody colours, harsh shadows, cluttered backgrounds, dense scenery, heavy foliage, blood, prey, fighting, text, letters, watermarks, signatures, multiple animals in one image, collages, grids, contact sheets, multi-panel layouts, unrelated themed elements, background paper texture, opaque background washes, checkerboard patterns, cropped details, and decorative elements inside the mandatory borders.

POST-PROCESSING AND EXACT PLACEMENT:
After generation, use image-processing tools to prepare each final master PNG. Do not rely on visual estimation alone to meet the border requirements.

1. Preserve the genuine alpha channel.

2. Measure the bounds of the COMPLETE illustration, including all pale foliage, shadows, and softly painted edges. Include every pixel with alpha greater than zero. Do not measure only the animal.

3. Remove excess transparent padding around those bounds without cutting off illustrated details.

4. Create a fully transparent canvas exactly FINAL_WIDTH_PX × FINAL_HEIGHT_PX.

5. Calculate the mandatory borders, rounding UP to whole pixels:

left_margin_px = ceil(0.05 × FINAL_WIDTH_PX)
right_margin_px = ceil(0.05 × FINAL_WIDTH_PX)
top_margin_px = ceil(0.15 × FINAL_HEIGHT_PX)
bottom_margin_px = ceil(0.15 × FINAL_HEIGHT_PX)

safe_width_px = FINAL_WIDTH_PX - left_margin_px - right_margin_px
safe_height_px = FINAL_HEIGHT_PX - top_margin_px - bottom_margin_px

6. Scale the complete illustration proportionally to fit inside this safe box.

Use one uniform scale factor:

scale = min(
safe_width_px / illustration_width,
safe_height_px / illustration_height
)

Round the resulting image dimensions down to whole pixels so neither dimension exceeds its safe limit.

Do not stretch width and height independently.

7. Preserve smooth alpha edges during resizing. Allow for any faint edge pixels introduced by resampling when checking the final bounds.

8. Centre the resized illustration on the final canvas using its complete non-transparent bounds. Opposite margins must be equal to within one pixel.

9. Measure the final alpha bounds again. Confirm that every non-transparent pixel is inside the safe area and every mandatory border strip has alpha = 0.

If any border is too small, reduce the complete illustration proportionally and centre it again. Do not crop or erase genuine illustrated details to force compliance.

10. Do not flatten the artwork onto white or cream.

11. Export as PNG with DPI × DPI resolution metadata.

ADAPTATION TO OTHER PRINT SIZES:
This delivered image is a reusable master, not a file to stretch into different aspect ratios.

When later creating each print size:

- Create a new canvas in that size’s exact aspect ratio.
- Use a pure white #FFFFFF background.
- Measure the master illustration’s complete alpha bounds, excluding its transparent padding.
- Calculate minimum left and right margins of 5% of the new canvas width EACH, rounding up to whole pixels.
- Calculate minimum top and bottom margins of 15% of the new canvas height EACH, rounding up to whole pixels.
- Scale the complete illustration proportionally to fit within the remaining central safe area.
- Centre it horizontally and vertically.
- Keep all illustrated details visible.
- Allow extra margins where the aspect ratios differ.
- Never crop or distort the illustration to force identical margins.
- Verify all four minimum margins after placement.
- Keep the illustration’s scale and position consistent across text options for the same print size.

Add optional text separately. The minimum margins above define the clearance around the illustration; personalised text may later occupy the reserved top and bottom areas.

FINAL DELIVERY REQUIREMENTS:
Deliver NO_OF_ANIMALS separate final master files.

Each file must be:

- Exactly FINAL_WIDTH_PX × FINAL_HEIGHT_PX pixels.
- PNG format.
- Genuinely transparent, with a working alpha channel.
- Exported with DPI × DPI resolution metadata.
- One standalone illustration.
- Centred within the specified safe area.
- Surrounded by at least 5% fully transparent space on EACH side.
- Surrounded by at least 15% fully transparent space at BOTH the top and bottom.
- Free of text.

Do not deliver the native preview as the final print master.

If necessary, upscale and post-process the generated artwork before delivery. Do not describe upscaled artwork as having native detail at the final resolution.

FINAL VERIFICATION:
Reopen each exported PNG and check:

- Correct pixel dimensions.
- Correct PNG format.
- Correct resolution metadata.
- Actual transparency in the empty margins.
- Complete, uncropped artwork.
- Left clear space ≥ 5% of canvas width.
- Right clear space ≥ 5% of canvas width.
- Top clear space ≥ 15% of canvas height.
- Bottom clear space ≥ 15% of canvas height.
- Every pixel in the mandatory border strips has alpha = 0.
- Opposite margins are balanced to within one pixel.
- Clean edges when previewed against pure white.

If any check fails, correct the file and verify it again before delivery.

If generation or post-processing tools cannot meet a requirement, explain the limitation instead of claiming that an unverified file meets it.

Deliver only the verified final master PNG files.`;
}
