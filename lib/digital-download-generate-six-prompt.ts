export type DigitalDownloadGenerateSixPromptInput = {
  animalName: string;
  animalDescription: string;
  roomTheme: string;
  frameColour: string;
  orientation: string;
  fileType: string;
  referenceImage: string;
};

const DIGITAL_DOWNLOAD_GENERATE_SIX_PROMPT = `Create a six-ratio nursery wall art printable bundle from the existing source artwork.

INPUTS — RESOLVE FROM THE PREVIOUS VARIABLE SCRIPT

ANIMAL: {{ANIMAL}}
ROOM_THEME: {{ROOM_THEME}}
FRAME_COLOUR: {{FRAME_COLOUR}}
ORIENTATION: {{ORIENTATION}}
FILE_TYPE: {{FILE_TYPE}}
REFERENCE_IMAGE: {{REFERENCE_IMAGE}}
SOURCE_IMAGE_FILE: {{REFERENCE_IMAGE}}

IMAGE ATTACHMENT REQUIREMENT

The listing thumbnail image must be attached to the same ChatGPT message when this prompt is run. Treat that attached image as both REFERENCE_IMAGE and SOURCE_IMAGE_FILE.

Do not run this task without the image attachment. If the image is not attached to the prompt, stop and reply only:
ERROR: The source artwork image must be attached when this prompt is run.

VARIABLE VALIDATION

This task must use the values created by the previous variable script. Do not invent replacement values or run this prompt with unresolved placeholders.

If ANIMAL, ROOM_THEME, FRAME_COLOUR, ORIENTATION or FILE_TYPE is missing, blank or unresolved, stop and reply only:
ERROR: Required variable missing or unresolved. Run the previous variable script first.

Resolve SOURCE_IMAGE_FILE directly from REFERENCE_IMAGE. If either reference is missing, blank, unresolved, inaccessible or not a usable image, stop and reply only:
ERROR: SOURCE_IMAGE_FILE is missing or invalid. Run the previous variable script first and make sure REFERENCE_IMAGE is set to a usable image.

Do not ask for an upload or master image. Do not search for, generate, assume or substitute another image. Do not use an image from another message unless it is the resolved REFERENCE_IMAGE.

ANIMAL must contain an animal name and description separated by the first spaced en dash: “ – ”. Split only at that separator; preserve hyphens within names.
Derive ANIMAL_NAME from the text before the separator and ANIMAL_DESCRIPTION from the text after it. Both must be nonempty. If the format is invalid, stop and reply only:
ERROR: ANIMAL must contain an animal name and description separated by a spaced en dash.

Derive ANIMAL_TITLE by converting ANIMAL_NAME to title case and replacing spaces and hyphens with underscores. Use a filename-safe form, removing path separators and invalid filename characters. Do not include ANIMAL_DESCRIPTION in filenames.

These derived values are permitted; do not invent or replace the original animal, description or other input values.

Accept ORIENTATION as Portrait or Landscape, case-insensitively. For any other value, stop and reply only:
ERROR: ORIENTATION must be Portrait or Landscape.

Accept FILE_TYPE as jpeg, jpg or png, case-insensitively. Derive EXT as its lowercase value and TYPE_LABEL as its uppercase value. jpeg and jpg both use JPEG encoding. Do not silently change the requested format. For another format, stop and reply only:
ERROR: FILE_TYPE must be jpeg, jpg or png.

Use ANIMAL_NAME in normal descriptive text and ANIMAL_DESCRIPTION only if a buyer-facing artwork description is needed. ROOM_THEME and FRAME_COLOUR remain available inputs, but do not add room scenes, frames or decorations to the artwork.

TASK AND DELIVERABLES

Produce exactly:
- Six separate printable image files, one for each ratio specified below.
- One plain-text file named How_To_Print_Guide.txt.
- One final ZIP containing those seven files directly in its root.

Use SOURCE_IMAGE_FILE as the sole artwork source for every image. Preserve its animal design, pose, colours, expression, illustrated elements and overall style.

Do not generate new artwork or use an image generator. Perform this task programmatically using Python and Pillow or an equivalent deterministic image-processing library.

Do not create mockups, room previews, frame previews, collages, grids, contact sheets, size-guide graphics, advertising images, listing text files or PDFs. Do not add text to the printable artwork. Do not add animals or decorative content.

SIX MASTER IMAGES

The following dimensions are WIDTH × HEIGHT for Portrait. For Landscape, swap width and height for every output. Adapt the canvas without rotating the animal sideways or distorting it.

1. ISO A-series — A1 master
Portrait: 7016 × 9933 pixels
Landscape: 9933 × 7016 pixels
Filename template: {ANIMAL_TITLE}_ISO_A1_{WIDTH}x{HEIGHT}_300DPI.{EXT}
Covers A1, A2, A3, A4 and A5, in the chosen orientation.
Do not advertise A0 as supported at 300 DPI by this file.

2. 2:3 ratio — 24×36-inch master
Portrait: 7200 × 10800 pixels
Landscape: 10800 × 7200 pixels
Filename template: {ANIMAL_TITLE}_2x3_24x36_{WIDTH}x{HEIGHT}_300DPI.{EXT}
Covers 4×6, 6×9, 8×12, 10×15, 12×18, 16×24, 20×30 and 24×36 inches.

3. 3:4 ratio — 18×24-inch master
Portrait: 5400 × 7200 pixels
Landscape: 7200 × 5400 pixels
Filename template: {ANIMAL_TITLE}_3x4_18x24_{WIDTH}x{HEIGHT}_300DPI.{EXT}
Covers 6×8, 9×12, 12×16, 15×20 and 18×24 inches, plus 30×40 cm.
Do not advertise 24×32 or 30×40 INCHES as supported at 300 DPI by this file.

4. 4:5 ratio — 16×20-inch master
Portrait: 4800 × 6000 pixels
Landscape: 6000 × 4800 pixels
Filename template: {ANIMAL_TITLE}_4x5_16x20_{WIDTH}x{HEIGHT}_300DPI.{EXT}
Covers 4×5, 8×10, 12×15 and 16×20 inches.

5. 11:14 ratio — 11×14-inch master
Portrait: 3300 × 4200 pixels
Landscape: 4200 × 3300 pixels
Filename template: {ANIMAL_TITLE}_11x14_11x14_{WIDTH}x{HEIGHT}_300DPI.{EXT}
Covers 11×14 inches.
Do not advertise 22×28 inches as supported at 300 DPI by this file.

6. 5:7 ratio — 20×28-inch master
Portrait: 6000 × 8400 pixels
Landscape: 8400 × 6000 pixels
Filename template: {ANIMAL_TITLE}_5x7_20x28_{WIDTH}x{HEIGHT}_300DPI.{EXT}
Covers 5×7, 10×14, 15×21 and 20×28 inches, plus 50×70 cm.

All six files must contain 300 DPI metadata. Values approximately equal to 300 because of format rounding, such as 299.999 or 299.9994, are acceptable.

The ratio and master-size tokens in filenames identify the ratio family. WIDTH and HEIGHT must always reflect the actual exported pixel dimensions. In the guide, reverse physical width/height pairs for Landscape; keep standard ISO names unchanged.

These are six master files, not one file for every physical size. A master may serve several smaller print sizes with the same aspect ratio.

IMAGE ADAPTATION RULES

1. Open and inspect SOURCE_IMAGE_FILE. Record its native pixel dimensions, orientation, colour profile and transparency before processing.
2. Work from that original source independently for each ratio. Do not resize one exported master to create another.
3. Scale proportionally using high-quality resampling such as Lanczos. Never stretch or distort the artwork.
4. Prefer a proportional cover-and-crop operation when the crop removes only safe outer background and preserves all meaningful artwork.
5. Do not crop away the animal, limbs, tail, important illustrated elements or existing meaningful text. Keep the composition centred and balanced, with comfortable margins.
6. If a safe crop is impossible, proportionally fit the complete artwork within the target canvas and use only a plain background colour sampled from a suitable uniform area of the source. Centre the artwork with equal opposite margins. Do not introduce a conspicuous background seam; if neither a safe crop nor clean plain padding is possible, stop and explain the limitation rather than damage or fabricate artwork.
7. Never use AI outpainting, generative fill, cloned artwork, repeated image content, mirrored content, blurred extensions, smeared edges or duplicated strips. Plain padding must contain no illustrated content.
8. Preserve source colours and transparency where the output format permits. Do not recolour the artwork to match ROOM_THEME or FRAME_COLOUR.

SOURCE RESOLUTION AND PRINT QUALITY

Use real image processing to produce the exact dimensions. Deterministic upscaling is permitted where needed, but it does not recover missing source detail. Do not describe a small upscaled source as native high-resolution artwork simply because its dimensions or DPI metadata were increased.

Inspect each export at full resolution for pixelation, blur, compression artefacts, clipping and padding seams. If the source is too poor to produce usable results, stop with a clear explanation of the source-resolution limitation; do not deliver misleadingly labelled print masters or ask for another image under this prompt. If acceptable upscaling was needed, disclose that fact briefly with delivery.

EXPORT REQUIREMENTS

For jpeg or jpg:
- Flatten transparency onto a plain colour sampled from the source's natural light background. If the source is fully transparent around the artwork and provides no usable background colour, use white.
- Encode as RGB JPEG in sRGB with an embedded sRGB profile where available.
- Use high quality, preferably quality 95 or higher with chroma subsampling disabled.
- Save with 300 DPI metadata. Do not retain transparency or use CMYK.

For png:
- Encode as RGB or RGBA PNG in sRGB, preserving existing transparency.
- Where padding is needed around transparent artwork, keep that padding transparent.
- Use lossless compression and 300 DPI metadata.

Do not substitute another format. Do not rename previews or source files and claim they are finished exports. Pixel dimensions must match the specification exactly.

HOW TO PRINT GUIDE

Create How_To_Print_Guide.txt as readable UTF-8 plain text, with clear headings and simple bullet points. No HTML, Markdown tables or unresolved placeholders.

Required content:

How to Print Guide

This is a digital download only. No physical product will be shipped.
Your download is supplied as one ZIP containing six {TYPE_LABEL} artwork files in six print-ratio families and this guide.

Which file should I use?

List all six final resolved filenames in full. Under each, list the supported physical sizes specified above, using the correct orientation and explicit units. Include 30×40 cm under 3:4 and 50×70 cm under 5:7.

Explain that each file can be printed at the smaller sizes listed without needing a separate download. Do not claim that the A1 file supports A0 at 300 DPI or that the 11×14 file supports 22×28 at 300 DPI.

Explain that 12×16 inches and 30×40 cm share a ratio but are different physical sizes; the same is true of 20×28 inches and 50×70 cm. Buyers must select the actual dimensions that fit their frame.

How to print
- Print at home, at a local print shop or through an online printing service.
- Choose the included image file whose ratio matches your paper or frame.
- Select your intended physical print size and orientation in the printing settings. The embedded DPI describes the master size; smaller sizes require proportional scaling.
- Preserve the aspect ratio. Never stretch the artwork.
- Check the print preview and disable automatic cropping that removes artwork.
- Use suitable matte or heavyweight archival paper and the printer settings recommended for that paper.
- When printing professionally, upload the appropriate full-resolution file and specify the intended dimensions and units.

Colour note
Colours may vary slightly depending on the monitor, printer, paper and print settings.

Use the actual resolved FILE_TYPE in the guide. Do not include references to PDFs, listing assets, multiple ZIP files or other files not supplied. Do not claim availability of every print size through every printing service or in every country.

ZIP CONTENTS AND NAMING

Create exactly one ZIP named:
{ANIMAL_TITLE}_Nursery_Wall_Art_{TYPE_LABEL}_Printable_Bundle.zip

For FILE_TYPE=jpeg, TYPE_LABEL must be JPEG and all image extensions must be .jpeg.

Include exactly seven files directly in the ZIP root:
- The resolved ISO_A1 master filename.
- The resolved 2x3_24x36 master filename.
- The resolved 3x4_18x24 master filename.
- The resolved 4x5_16x20 master filename.
- The resolved 11x14_11x14 master filename.
- The resolved 5x7_20x28 master filename.
- How_To_Print_Guide.txt.

No folders, subfolders, nested ZIPs, duplicate files, metadata sidecars, previews, scripts, manifests, PDFs or extra files may be included. Temporary processing files must remain outside the final ZIP.

MANDATORY VERIFICATION

Before packaging:
- Confirm the sole source is SOURCE_IMAGE_FILE resolved from REFERENCE_IMAGE.
- Reopen all six actual exported files, not just previews.
- Verify actual file encoding, filename, exact width and height for ORIENTATION, colour mode, DPI metadata and successful image decoding.
- Visually check all six for preserved artwork, proportional scaling, clean margins, no clipping, no distorted subjects and no duplicated or blurred extension strips.
- Confirm the six ratios and master sizes match this specification.
- Reopen How_To_Print_Guide.txt and verify that all six filenames exactly match the exports, every print-size mapping is correct, and no unresolved placeholders or outdated five-image/six-total-file counts remain.
- Correct any failed output before proceeding.

After packaging:
- Reopen the saved ZIP and run an archive integrity check.
- Confirm exactly seven unique root entries, with six requested-format images and one How_To_Print_Guide.txt.
- Confirm there are no directories or extra files.
- Reopen the image data and guide directly from the ZIP and verify their dimensions, metadata, names and contents again.
- Do not claim successful verification unless these checks were actually performed.

DELIVERY

Deliver one link to the final verified ZIP with a brief confirmation that it contains six artwork masters and one plain-text guide. State any material source-upscaling limitation if applicable. Do not deliver intermediate files or separate ratio ZIPs.

If the required variables or source cannot be resolved, use the applicable error message above and do not create the bundle.`;

function promptValue(value: string) {
  return value.trim().replace(/\s+/g, ' ');
}

function animalValue(name: string, description: string) {
  const normalizedName = promptValue(name);
  if (normalizedName.includes(' – ')) return normalizedName;
  const normalizedDescription = promptValue(description)
    || 'the animal featured in the supplied source artwork';
  return `${normalizedName} – ${normalizedDescription}`;
}

export function buildDigitalDownloadGenerateSixPrompt(input: DigitalDownloadGenerateSixPromptInput) {
  const replacements: Record<string, string> = {
    ANIMAL: animalValue(input.animalName, input.animalDescription),
    ROOM_THEME: promptValue(input.roomTheme),
    FRAME_COLOUR: promptValue(input.frameColour),
    ORIENTATION: promptValue(input.orientation),
    FILE_TYPE: promptValue(input.fileType),
    REFERENCE_IMAGE: promptValue(input.referenceImage),
  };
  return Object.entries(replacements).reduce(
    (prompt, [key, value]) => prompt.replaceAll(`{{${key}}}`, value),
    DIGITAL_DOWNLOAD_GENERATE_SIX_PROMPT,
  );
}
