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
Warm cream, soft ivory, pale sand beige, gentle golden ochre, muted honey gold, soft caramel, warm amber, dusty terracotta, muted tiger orange, soft cocoa brown, gentle taupe, creamy milk white, muted sage green, pale eucalyptus green, soft olive, faded palm green, delicate fern green, soft moss green, warm charcoal grey, softened black accents, and delicate blush.

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
Treat the animal, antennae, held objects, foliage, flowers, ground patch, and every other painted detail as ONE complete illustration.

Centre that complete illustration horizontally and vertically on the master canvas.

Do not position the ground patch near the bottom edge of the page.
Do not leave a large empty area above the animal with only a small margin below the ground.
Balance the empty space above the highest illustrated detail and below the lowest illustrated detail.

The animal must remain the main focus. Keep the surrounding scenery modest so it does not make the animal appear small.

Use a compact, naturally balanced composition suitable for both narrower and wider portrait canvases.

Keep the full animal and all decorative details visible.
Do not crop antennae, ears, tails, limbs, leaves, flowers, or the ground patch.

MASTER CANVAS SAFE AREA:
SIDE_MARGIN_MINIMUM_PERCENT: 5
TOP_MARGIN_MINIMUM_PERCENT: 15
BOTTOM_MARGIN_MINIMUM_PERCENT: 15
MAX_ILLUSTRATION_WIDTH_PERCENT: 90
MAX_ILLUSTRATION_HEIGHT_PERCENT: 70
ILLUSTRATION_CENTRE_X_PERCENT: 50
ILLUSTRATION_CENTRE_Y_PERCENT: 50

Keep the COMPLETE illustration inside this central safe area:

- Horizontal bounds: 5% to 95% of canvas width
- Vertical bounds: 15% to 85% of canvas height

The top 15% and bottom 15% must contain no illustrated content. These areas are reserved for optional text added later.

Use as much of the safe area as the illustration’s natural proportions allow, without stretching or cropping.

The illustration does not have to touch all four safe-area boundaries. If its proportions require additional space on one axis, preserve that extra space symmetrically.

These are transparent margins in the master PNG. They will appear white when placed on the finished print canvas.

MATCHING COLLECTION:
For each entry in ANIMALS, create one separate standalone image containing only that animal.

If NO_OF_ANIMALS is greater than one:

- Generate separate images, not a combined sheet
- Keep the palette, painted texture, level of detail, and visual prominence consistent
- Use the same placement and safe-area rules
- Make the animals feel balanced when displayed side by side
- Allow natural differences in anatomy without stretching animals to identical dimensions

AVOID:
Photorealism, aggressive expressions, snarling, roaring, hunting poses, scary teeth, threatening poses, dark moody colours, harsh shadows, cluttered backgrounds, dense scenery, heavy foliage, blood, prey, fighting, text, letters, watermarks, signatures, multiple animals in one image, collages, grids, contact sheets, multi-panel layouts, unrelated themed elements, background paper texture, opaque background washes, checkerboard patterns, cropped details, and decorative elements inside the reserved text areas.

POST-PROCESSING AND EXACT PLACEMENT:
After generation, use image-processing tools to prepare each final master PNG.

1. Preserve the genuine alpha channel.
2. Measure the visible bounds of the COMPLETE illustration, including all pale foliage and softly painted edges. Do not measure only the animal.
3. Remove excess transparent padding around those bounds without cutting off visible details.
4. Create a fully transparent canvas exactly FINAL_WIDTH_PX × FINAL_HEIGHT_PX.
5. Scale the complete illustration proportionally to fit inside a box measuring 90% of the final canvas width and 70% of its height.

Use one uniform scale factor:

scale = min(
0.90 × FINAL_WIDTH_PX / illustration_width,
0.70 × FINAL_HEIGHT_PX / illustration_height
)

Do not stretch width and height independently.

6. Centre the resized illustration on the final canvas using its complete visible bounds.
7. Preserve smooth alpha edges during resizing. Do not flatten the artwork onto white or cream.
8. Export as PNG with DPI × DPI resolution metadata.

ADAPTATION TO OTHER PRINT SIZES:
This delivered image is a reusable master, not a file to stretch into different aspect ratios.

When later creating each print size:

- Create a new canvas in that size’s exact aspect ratio
- Use a pure white #FFFFFF background
- Measure the master illustration’s visible alpha bounds, excluding its transparent padding
- Scale the complete illustration proportionally into the new canvas’s central 90%-width × 70%-height safe area
- Centre it horizontally and vertically
- Keep all illustrated details visible
- Allow extra margins where the aspect ratios differ
- Never crop or distort the illustration to force identical margins
- Add optional text separately in the reserved top and bottom areas
- Keep the illustration’s scale and position consistent across text options for the same print size

FINAL DELIVERY REQUIREMENTS:
Deliver NO_OF_ANIMALS separate final master files.

Each file must be:

- Exactly FINAL_WIDTH_PX × FINAL_HEIGHT_PX pixels
- PNG format
- Genuinely transparent, with a working alpha channel
- Exported with DPI × DPI resolution metadata
- One standalone illustration
- Centred within the specified safe area
- Free of text

Do not deliver the native preview as the final print master.

If necessary, upscale and post-process the generated artwork before delivery. Do not describe upscaled artwork as having native detail at the final resolution.

FINAL VERIFICATION:
Before delivery, check each exported file for:

- Correct pixel dimensions
- Correct PNG format
- Correct resolution metadata
- Actual transparency in the empty margins
- Complete, uncropped artwork
- At least 5% clear space on each side
- At least 15% clear space above and below
- Balanced placement of the complete illustration
- Clean edges when previewed against pure white

If generation or post-processing tools cannot meet a requirement, explain the limitation instead of claiming that an unverified file meets it.

Deliver only the verified final master PNG files.`;
}
