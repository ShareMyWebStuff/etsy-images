const DIGITAL_DOWNLOAD_GENERATE_PROMPT = `ANIMAL = "{{ANIMAL}}"
ORIENTATION = "portrait"
FILE_TYPE = "jpeg"

Use the image attached to this prompt as the sole source artwork.

CREATE PRINTABLE ARTWORK BUNDLE

Create one downloadable ZIP containing five large-format printable artwork files and one plain-text printing guide.

DEFAULT VALUES

Apply these defaults before validation:

* If \`ORIENTATION\` is blank, missing, or unresolved, use \`portrait\`.
* If \`FILE_TYPE\` is blank, missing, or unresolved, use \`jpeg\`.
* Treat \`jpeg\` and \`jpg\` as JPEG format, but use \`.jpeg\` as the filename extension.
* Use \`portrait\` orientation unless the variable is deliberately changed.

\`ANIMAL\` has no default and must contain a valid value.

PREFLIGHT VALIDATION

Before processing the image, verify:

* \`ANIMAL\` is present and valid.
* \`ANIMAL\` does not contain an unresolved placeholder.
* An image is attached to this prompt.
* The attached image is accessible and can be opened.
* \`ORIENTATION\` resolves to \`portrait\`.
* \`FILE_TYPE\` resolves to a supported image type.

If \`ANIMAL\` is missing, blank, malformed, or unresolved, stop and reply only:

ERROR: ANIMAL is missing or invalid. Set the ANIMAL variable at the top of the prompt.

If the attached image is missing, inaccessible, corrupt, or not a usable image, stop and reply only:

ERROR: The attached source artwork is missing or invalid. Attach the master artwork and run the prompt again.

Do not ask for a different image. Do not search for, generate, assume, or substitute another image.

ANIMAL VARIABLE RULES

\`ANIMAL\` must use this format:

animal name – animal description

Split \`ANIMAL\` using only the first spaced en dash separator: \`–\`

Derive:

* \`ANIMAL_NAME\` from the text before the separator.
* \`ANIMAL_DESCRIPTION\` from the text after the separator.

Do not split using ordinary hyphens inside names such as “saber-toothed tiger.”

Both derived values must contain usable text.

Create \`ANIMAL_TITLE\` from \`ANIMAL_NAME\`:

1. Convert each word to title case.
2. Replace spaces and hyphens with underscores.
3. Remove apostrophes and punctuation.
4. Replace repeated underscores with one underscore.
5. Remove underscores from the beginning and end.

Examples:

* \`saber-toothed tiger\` becomes \`Saber_Toothed_Tiger\`
* \`dodo\` becomes \`Dodo\`
* \`caterpillar\` becomes \`Caterpillar\`

Use \`ANIMAL_TITLE\` only in filenames and the ZIP name.

Use the lowercase \`FILE_TYPE\` value as the extension. With the default value, use \`.jpeg\`.

SOURCE ARTWORK RULES

The image attached to this prompt is the sole master artwork.

Use exactly the same source image for all five printable files.

Preserve:

* The animal’s design
* Pose
* Expression
* Colours
* Proportions
* Composition
* Background style
* Overall visual appearance

Do not:

* Redraw or regenerate the artwork
* Recolour or reinterpret it
* Add or remove illustrated content
* Generate another animal
* Add text
* Use AI outpainting
* Use generative fill
* Create multiple AI variations
* Duplicate, mirror, clone, blur, smear, stretch, or repeat any part of the artwork
* Add a repeated strip at the top, bottom, or sides

FINAL ARTWORK RULES

All five printable images must be clean artwork-only files.

Do not create:

* Room mockups
* Framed mockups
* Unframed product mockups
* Etsy advertising graphics
* Size-guide graphics
* Collages
* Grids
* Contact sheets
* Preview sheets
* PDFs
* Listing title, description, tag, category, or shop-section files

Do not add text, frames, mounts, labels, watermarks, logos, borders, or promotional elements to the printable artwork.

IMAGE-PROCESSING METHOD

Use a real programmatic image-processing and export workflow.

Do not use a generated preview as the final file.

For each required ratio:

1. Open the attached master artwork.
2. Convert it to sRGB.
3. Flatten transparency onto a suitable solid background when exporting JPEG.
4. Resize proportionally using a high-quality resampling method.
5. Crop only safe outer background areas when necessary.
6. Keep the animal centred and fully intact.
7. Preserve the animal’s proportions.
8. Export at the exact required pixel dimensions.
9. Embed 300 DPI metadata.
10. Save at high JPEG quality with no obvious compression artefacts.

CROPPING AND PADDING

Prioritise preserving the complete animal and important artwork.

For taller or narrower ratios:

* Crop only safe left and right background edges.
* Do not crop any part of the animal.
* Do not add extra illustrated content at the bottom.
* Do not duplicate, blur, mirror, or repeat lower artwork.

For wider or shorter ratios:

* Crop safe background from the top or bottom only when doing so does not affect the animal or important details.

If safe cropping cannot achieve the ratio without damaging the subject, use minimal solid-colour padding sampled from a plain outer background area.

Padding may contain only one clean, flat background colour.

Padding must not contain:

* Copied artwork
* Blurred artwork
* Mirrored artwork
* Repeated textures
* Duplicated parts of the animal
* Duplicated scenery or decorative objects

Do not stretch the source artwork.

Do not claim that upscaling creates new detail. Use high-quality resampling while preserving the original artwork faithfully.

EXACT PRINT FILES

Create exactly these five portrait JPEG files:

1. ISO A-Series

Filename:

ANIMAL_TITLE_ISO_A1_7016x9933_300DPI.jpeg

Exact dimensions:

7016 × 9933 pixels

Metadata:

300 DPI, sRGB

2. 2:3 Ratio

Filename:

ANIMAL_TITLE_2x3_24x36_7200x10800_300DPI.jpeg

Exact dimensions:

7200 × 10800 pixels

Metadata:

300 DPI, sRGB

3. 3:4 Ratio

Filename:

ANIMAL_TITLE_3x4_18x24_5400x7200_300DPI.jpeg

Exact dimensions:

5400 × 7200 pixels

Metadata:

300 DPI, sRGB

4. 4:5 Ratio

Filename:

ANIMAL_TITLE_4x5_16x20_4800x6000_300DPI.jpeg

Exact dimensions:

4800 × 6000 pixels

Metadata:

300 DPI, sRGB

5. 11:14 Ratio

Filename:

ANIMAL_TITLE_11x14_22x28_6600x8400_300DPI.jpeg

Exact dimensions:

6600 × 8400 pixels

Metadata:

300 DPI, sRGB

Replace \`ANIMAL_TITLE\` with its derived value. Do not leave variable names or placeholders in any filename.

HOW-TO-PRINT GUIDE

Create one real plain-text file named:

How_To_Print_Guide.txt

Use plain text only. Do not include raw HTML, Markdown tables, unresolved placeholders, or references to PDFs.

Replace every filename placeholder with the actual resolved filename.

The guide must contain:

How to Print Guide

This is a digital download only.

No physical product will be shipped.

Your complete download is supplied as one ZIP file containing five high-resolution JPEG artwork files in popular print ratios.

WHICH FILE SHOULD I USE?

ISO / International A-Series

Use for A1, A2, A3, A4, A5 and other ISO A-series sizes.

JPEG file:
ANIMAL_TITLE_ISO_A1_7016x9933_300DPI.jpeg

2:3 Ratio

Use for 4x6, 6x9, 8x12, 10x15, 12x18, 16x24, 20x30 and 24x36 inches.

JPEG file:
ANIMAL_TITLE_2x3_24x36_7200x10800_300DPI.jpeg

3:4 Ratio

Use for 6x8, 9x12, 12x16, 15x20 and 18x24 inches.

JPEG file:
ANIMAL_TITLE_3x4_18x24_5400x7200_300DPI.jpeg

4:5 Ratio

Use for 4x5, 8x10, 12x15 and 16x20 inches.

JPEG file:
ANIMAL_TITLE_4x5_16x20_4800x6000_300DPI.jpeg

11:14 Ratio

Use for 11x14 and 22x28 inches.

JPEG file:
ANIMAL_TITLE_11x14_22x28_6600x8400_300DPI.jpeg

HOW TO PRINT

• Print at home, at a local print shop, or through an online printing service.

• Use high-quality matte paper or heavyweight archival paper for the best results.

• Choose the JPEG file that matches your frame or paper ratio.

• Print without stretching or distorting the artwork.

• Use fit-to-page or scale-to-fit only when the artwork’s proportions remain unchanged.

• When using a professional printing service, upload the high-resolution JPEG file matching your chosen print size.

COLOUR NOTE

Colours may vary slightly depending on your monitor, printer, ink, paper type and printer settings.

GUIDE VALIDATION

Open \`How_To_Print_Guide.txt\` after saving and verify:

* It opens successfully.
* All text is readable.
* All five resolved JPEG filenames appear in full.
* No unresolved variable names or placeholders remain.
* It says the download is supplied as one ZIP.
* It does not mention multiple ZIP files.
* It contains no PDF references.
* It contains no raw HTML.
* It is plain text only.

ZIP CREATION

Create exactly one ZIP file named:

ANIMAL_TITLE_Nursery_Wall_Art_JPEG_Printable_Bundle.zip

Replace \`ANIMAL_TITLE\` with the derived value.

Place exactly these six files directly in the ZIP root:

1. ANIMAL_TITLE_ISO_A1_7016x9933_300DPI.jpeg
2. ANIMAL_TITLE_2x3_24x36_7200x10800_300DPI.jpeg
3. ANIMAL_TITLE_3x4_18x24_5400x7200_300DPI.jpeg
4. ANIMAL_TITLE_4x5_16x20_4800x6000_300DPI.jpeg
5. ANIMAL_TITLE_11x14_22x28_6600x8400_300DPI.jpeg
6. How_To_Print_Guide.txt

Do not:

* Create folders or subfolders inside the ZIP
* Place the six files inside a bundle folder
* Include the ZIP inside another ZIP
* Create separate ratio ZIP files
* Create another combined ZIP
* Include hidden or metadata files
* Include PDFs
* Include any additional files

FINAL VERIFICATION

Before delivering the ZIP, reopen every exported image and verify:

* The file opens successfully.
* Its filename is correct.
* Its width and height exactly match the required dimensions.
* Its metadata reports 300 DPI; 299.999 is acceptable as metadata rounding.
* It uses sRGB.
* It is a genuine exported large-format image rather than a renamed preview.
* It contains the original artwork and animal.
* The animal is not stretched, distorted, cropped, duplicated, or regenerated.
* It contains no repeated, mirrored, blurred, or cloned areas.
* It contains no mockup, frame, text, label, collage, grid, or advertising content.

Then reopen the ZIP and verify:

* Exactly one ZIP was created.
* The ZIP opens successfully.
* It contains exactly six files.
* All six files are at the ZIP root.
* It contains exactly five JPEG images.
* It contains exactly one \`How_To_Print_Guide.txt\`.
* It contains no folders or subfolders.
* It contains no duplicate or additional files.
* It contains no PDFs.
* No unresolved placeholders remain.

If any check fails, correct the affected file and repeat the verification before delivery.

FINAL RESPONSE

Return only one download link to the completed ZIP file.

Do not return separate links to the individual images or guide.

Do not include explanations, summaries, file lists, validation reports, or any other text.`;

function promptVariable(value: string) {
  return value.trim().replaceAll('\\', '\\\\').replaceAll('"', '\\"');
}

function animalVariable(listingItem: string) {
  const item = listingItem.trim();
  return item.includes(' – ') ? item : `${item} – the animal featured in the supplied source artwork`;
}

export function buildDigitalDownloadGeneratePrompt(listingItem: string) {
  return DIGITAL_DOWNLOAD_GENERATE_PROMPT.replaceAll('{{ANIMAL}}', promptVariable(animalVariable(listingItem)));
}
