const DOWNLOAD_DETAILS_PROMPT = `ETSY LISTING TEXT FILE CREATION TASK — COMBINED RULES ONLY

Use the populated INPUTS in this prompt.

This prompt must create Etsy listing copy for one individual digital nursery wall art printable.

SHOP LINK FOR CROSS-PROMOTION:
https://www.etsy.com/shop/CosyHousePrints

Do not generate images.
Do not edit images.
Do not ask for an image upload.
Do not use REFERENCE_IMAGE for this task.
Do not create folders.
Create the ZIP archive specified below after the three plain text files.
Create exactly three plain text files using a filename-safe version of ANIMAL_NAME.

Derive ANIMAL_FILENAME from ANIMAL_NAME using these rules:
- Convert ANIMAL_NAME to lowercase.
- Replace spaces with hyphens.
- Remove apostrophes and punctuation.
- Remove any character other than lowercase letters, numbers, and hyphens.
- Replace repeated hyphens with one hyphen.
- Remove hyphens from the beginning or end.

Create exactly these files:
{{ANIMAL_FILENAME}}_title.txt
{{ANIMAL_FILENAME}}_desc.txt
{{ANIMAL_FILENAME}}_tags.txt

Example:
If ANIMAL is:
Caterpillar — cute, wiggly, colourful, and playful

Then:
ANIMAL_NAME = Caterpillar
ANIMAL_FILENAME = caterpillar

The files must be:
caterpillar_title.txt
caterpillar_desc.txt
caterpillar_tags.txt

After creating and verifying the three text files, place all three files into one ZIP archive named:
caterpillar_info.zip

For any animal, use this ZIP filename pattern:
{{ANIMAL_FILENAME}}_info.zip

The ZIP archive must contain exactly:
{{ANIMAL_FILENAME}}_title.txt
{{ANIMAL_FILENAME}}_desc.txt
{{ANIMAL_FILENAME}}_tags.txt

Do not include folders inside the ZIP.
Do not include any additional files in the ZIP.
Do not create any other output files.

INPUTS:
ANIMAL: {{ANIMAL}}
ROOM_THEME: {{ROOM_THEME}}
FRAME_COLOUR: {{FRAME_COLOUR}}
ORIENTATION: {{ORIENTATION}}
FILE_TYPE: {{FILE_TYPE}}
FRAME_COLOURS: {{FRAME_COLOURS}}
FILES_INCLUDED: {{FILES_INCLUDED}}
RECOMMENDED_PAPER: {{RECOMMENDED_PAPER}}
LICENCE_TYPE: {{LICENCE_TYPE}}

REQUIRED VARIABLES:
ANIMAL
ROOM_THEME
FRAME_COLOUR
ORIENTATION
FILE_TYPE
FRAME_COLOURS
FILES_INCLUDED
RECOMMENDED_PAPER
LICENCE_TYPE

PREFLIGHT RULE:
Before creating {{ANIMAL_FILENAME}}_title.txt, {{ANIMAL_FILENAME}}_desc.txt, and {{ANIMAL_FILENAME}}_tags.txt, check that all required variables are present, usable, and not unresolved placeholders.
If any required variable is missing, blank, inaccessible, unusable, or still shown as a placeholder such as {{ANIMAL}}, stop immediately and reply only:
ERROR: Required Etsy listing variable missing or unresolved. Run the variable setup prompt first.

VARIABLE RULES:
Use ANIMAL as the single combined animal variable.
ANIMAL must follow this format:
animal name – animal description

Use the first spaced en dash separator, “ – ”, to split ANIMAL into two derived values.
Derive ANIMAL_NAME from the text before the “ – ” separator in ANIMAL.
Derive ANIMAL_DESCRIPTION from the text after the “ – ” separator in ANIMAL.
Derive ANIMAL_FILENAME from ANIMAL_NAME using the filename rules above.
Use ANIMAL_FILENAME only for filenames, not in buyer-facing listing copy.
Use ANIMAL_NAME as the main product subject.
Use ANIMAL_DESCRIPTION as descriptive wording in the listing description where natural.
Use ROOM_THEME when describing the nursery, bedroom, playroom, reading corner, toddler bedroom, or decor theme.
Use FILE_TYPE as the download file type.
Use the uppercase version of FILE_TYPE in buyer-facing text, for example JPEG.
Use RECOMMENDED_PAPER in the printing advice.
Use LICENCE_TYPE in the usage and licence section.
Use FRAME_COLOUR and FRAME_COLOURS only as styling or display suggestions where natural.
Do not suggest or imply that a frame is included.
Do not invent a different animal, room theme, file type, licence type, paper recommendation, or included file set.
Do not introduce unsupported claims about materials, shipping, processing, physical quality, sustainability, or handmade production.
Do not mention REFERENCE_IMAGE.
Do not mention that variables were used.

DERIVED COPYWRITING DETAILS:
Treat ANIMAL_NAME as the product subject/name.
Treat ANIMAL_DESCRIPTION as the source for colour palette, visual details, and gentle descriptive language.
If a colour palette is clearly present in ANIMAL_DESCRIPTION, use it naturally in the title and description.
If a style or aesthetic is clearly present in ANIMAL_DESCRIPTION, use it naturally.
If no formal aesthetic trend is stated, use safe descriptive terms that are directly supported by the variables, such as soft nursery, whimsical nursery, gentle kids room, or playful nursery.
Use relevant gifting angles where natural, such as baby shower gift, new baby gift, toddler birthday gift, animal lover gift, or subject-specific gift terms such as dino lover gift when ROOM_THEME or ANIMAL_NAME supports them.
Do not keyword-stuff.
Do not repeat the same keyword phrase unnaturally.

ROLE:
Act as an expert Etsy SEO copywriter specializing in digital download wall art.
Write highly scannable, conversion-optimized Etsy listing text for premium nursery and kids room printable art.

CREATE THE FOLLOWING ETSY LISTING CONTENT:

1. TITLE
Create a streamlined, human-scannable Etsy product title.
The title must be under 15 words.
The title must be no more than 140 characters.
Front-load ANIMAL_NAME and the strongest style, colour, or nursery placement keyword.
Use vertical bars “|” to separate phrases.
Do not use commas in the title.
The title should include ANIMAL_NAME.
The title should include nursery wall art or nursery print.
The title should include printable if it fits naturally.
Use ROOM_THEME if it fits naturally.
Avoid generic terms like Digital Download in the title unless needed for clarity.
Avoid keyword stuffing.
Do not exceed the title limits.

2. DESCRIPTION
Create a buyer-friendly Etsy description for the product.

The description must start immediately with this exact mobile warning disclosure:
🚨 IMPORTANT: THIS IS A DIGITAL DOWNLOAD ONLY. NO PHYSICAL PRODUCT WILL BE SHIPPED. 🚨

Immediately after the warning, briefly state that frames, mounts, props, and display items are not included.

The description must include these sections in this order:

✨ ABOUT THIS PRINT ✨
Write a smooth, beautifully written 3-sentence hook.
The hook must include ANIMAL_NAME naturally.
The hook must include ANIMAL_DESCRIPTION naturally where it reads well.
The hook must include ROOM_THEME naturally.
The hook should weave in relevant long-tail keywords, gift terms, and room placement phrases such as reading corner, playroom focal piece, toddler bedroom, nursery print, baby shower gift, new baby gift, toddler birthday gift, or animal/subject-specific gift terms.
The hook must feel premium and boutique.
Do not use repetitive keyword stuffing.

📦 WHAT YOU WILL RECEIVE 📦
Paste this exact technical inventory and dual sizing block into the description:

📦 WHAT YOU WILL RECEIVE 📦
After purchase, you will download a PDF containing a secure link to your high-resolution files. You will receive 5 professional-quality JPEG files (300 DPI, RGB profile) perfectly cropped for over 20 standard frame sizes:

📐 SIZES INCLUDED (Print up to these maximum sizes):

• ISO A-Series (7016 x 9933 px)
Fits standard international sizes: A1, A2, A3, A4, A5, and 5x7"

• 2:3 Ratio (7200 x 10800 px)
Inches: 4x6 | 6x9 | 8x12 | 10x15 | 12x18 | 14x21 | 16x24 | 24x36
Centimeters: 10x15 | 15x23 | 20x30 | 25x38 | 30x46 | 36x53 | 41x61 | 61x91 cm

• 3:4 Ratio (5400 x 7200 px)
Inches: 6x8 | 9x12 | 12x16 | 15x20 | 18x24
Centimeters: 15x20 | 22x30 | 30x40 | 38x50 | 45x60 cm

• 4:5 Ratio (4800 x 6000 px)
Inches: 4x5 | 8x10 | 16x20
Centimeters: 10x12 | 20x25 | 40x50 cm

• 11:14 Ratio (6600 x 8400 px)
Inches: 11x14 | 22x28
Centimeters: 28x35 | 55x71 cm

All files are 300 DPI JPEG files.

Do not alter the file pixel sizes.
Do not remove inches.
Do not remove centimeters.
Do not remove the 300 DPI JPEG confirmation.

📥 HOW IT WORKS & INSTANT DOWNLOAD
Explain clearly that this is an instant digital download.
Explain that after purchase, the buyer receives a PDF containing a secure link to the high-resolution files.
Explain that the buyer can download, print, and frame the artwork themselves.
Mention that no physical product will be posted or shipped.
Keep this section simple and practical.

🖨️ RECOMMENDED PAPER & PRINTING TIPS
Recommend RECOMMENDED_PAPER.
Also recommend 80-110 lb / 220-300 gsm heavyweight matte paper or smooth cardstock.
Suggest printing at home, through a local print shop, or through a professional online print service.
Suggest choosing the matching ratio file for the buyer’s preferred frame size.
Do not guarantee exact colour matching.
Do not suggest specialist equipment is required.

🎨 COLOR NOTE & ACCURACY
Write a professional colour variation note.
Explain that colours may vary slightly between screens, printers, inks, and papers.
Keep the note reassuring and buyer-friendly.
Do not blame the buyer.
Do not guarantee exact colour accuracy.

✨ EXPLORE MORE DESIGNS OR CREATE A GALLERY WALL
Include a short cross-promotion block inviting buyers to browse matching nursery prints, kids room designs, and gallery wall ideas.
Include this shop link exactly:
https://www.etsy.com/shop/CosyHousePrints?ref=dashboard-header

⚖️ TERMS OF USE & LICENSE
State that the files are for LICENCE_TYPE.
State that the purchase is for personal home decor or a single personal gift only.
Explicitly prohibit commercial reproduction, digital resale, file sharing, redistribution, uploading for resale, editing for resale, and selling printed versions.
Do not mention specific platform names in the licence restrictions.
Keep the tone professional, clear, and legally protective.


3. TAGS
Create exactly 13 optimized Etsy tags unless fewer than 13 genuinely relevant tags are possible.
Every tag must be strictly under 20 characters including spaces.
Tags must be comma-separated on one line.
Do not use bullet points for tags.
Mix high-traffic terms with specific long-tail modifiers.
Tags should be relevant to ANIMAL_NAME, ROOM_THEME, nursery print, kids room decor, printable art, animal nursery decor, and gifting angles.
Avoid redundant broad category tags such as digital prints or wall decor.
Avoid duplicate tags.
Do not create more than 13 tags.

OUTPUT FILE REQUIREMENTS:
Create exactly these three plain text files:

1. {{ANIMAL_FILENAME}}_title.txt
The file must contain only the finished Etsy title.
Do not include a TITLE: heading.
Do not include quotation marks, markdown, code fences, explanations, labels, or extra blank lines.

2. {{ANIMAL_FILENAME}}_desc.txt
The file must contain only the finished Etsy description.
The first line must be the exact required digital download warning.
Do not include a DESCRIPTION: heading.
Do not include markdown formatting, raw HTML, code fences, explanations, or labels.
The exact technical inventory bullets and section headings required in the description are allowed.

3. {{ANIMAL_FILENAME}}_tags.txt
The file must contain only the finished comma-separated Etsy tags on one line.
Do not include a TAGS: heading.
Do not include bullet points, numbering, quotation marks, markdown, code fences, explanations, labels, or extra blank lines.

Do not create etsy.txt.
Do not create a category file.
Do not include a category in any of the three files.
Do not create folders or any ZIP other than the one specified below.
All three files must be plain text only.

ZIP OUTPUT REQUIREMENTS:
After all three text files pass validation, create:
{{ANIMAL_FILENAME}}_info.zip

The ZIP must contain the three text files at its root level:
{{ANIMAL_FILENAME}}_title.txt
{{ANIMAL_FILENAME}}_desc.txt
{{ANIMAL_FILENAME}}_tags.txt

Do not place the files inside a folder.
Do not include hidden files, metadata files, or any other content.
Keep the three original text files available as separate downloads unless explicitly instructed otherwise.

FINAL CHECK:
Before finishing, open {{ANIMAL_FILENAME}}_title.txt, {{ANIMAL_FILENAME}}_desc.txt, and {{ANIMAL_FILENAME}}_tags.txt and verify:

{{ANIMAL_FILENAME}}_title.txt:
The file exists.
It contains only the title.
It does not contain TITLE: or any other heading.
The title is under 15 words.
The title is 140 characters or fewer.
The title uses vertical bars and does not use commas.
The filenames use ANIMAL_FILENAME derived from ANIMAL_NAME.
The filenames contain only lowercase letters, numbers, hyphens, and the required suffix.
The ZIP file exists and is named {{ANIMAL_FILENAME}}_info.zip.
The ZIP contains exactly the three required text files.
The ZIP contains no folders or additional files.
No unresolved placeholders remain.
No raw HTML or markdown appears.

{{ANIMAL_FILENAME}}_desc.txt:
The file exists.
It contains only the description.
It does not contain DESCRIPTION: or any other output label.
The description starts with the exact digital download warning.
The description says this is a digital download only.
The description says no physical product will be shipped.
The description says frames, mounts, props, and display items are not included.
The description includes the exact file size section.
The description includes both inches and centimeters.
The description says all files are 300 DPI JPEG files.
The description includes HOW IT WORKS & INSTANT DOWNLOAD.
The description includes RECOMMENDED PAPER & PRINTING TIPS.
The description includes COLOR NOTE & ACCURACY.
The description includes the shop cross-promotion link.
The description includes TERMS OF USE & LICENSE.
The licence section uses LICENCE_TYPE and includes the required restrictions.
The filenames use ANIMAL_FILENAME derived from ANIMAL_NAME.
The filenames contain only lowercase letters, numbers, hyphens, and the required suffix.
The ZIP file exists and is named {{ANIMAL_FILENAME}}_info.zip.
The ZIP contains exactly the three required text files.
The ZIP contains no folders or additional files.
No unresolved placeholders remain.
No raw HTML appears.
No markdown syntax appears, except the exact allowed plain text bullets and section headings.
The file is plain text only.

{{ANIMAL_FILENAME}}_tags.txt:
The file exists.
It contains only the tags on one comma-separated line.
It does not contain TAGS: or any other heading.
There are exactly 13 tags unless fewer are genuinely relevant.
Every tag is strictly under 20 characters including spaces.
There are no duplicate tags.
The filenames use ANIMAL_FILENAME derived from ANIMAL_NAME.
The filenames contain only lowercase letters, numbers, hyphens, and the required suffix.
The ZIP file exists and is named {{ANIMAL_FILENAME}}_info.zip.
The ZIP contains exactly the three required text files.
The ZIP contains no folders or additional files.
No unresolved placeholders remain.
No raw HTML or markdown appears.
The file is plain text only.

Also verify:
Exactly three plain text files and one ZIP archive were created: {{ANIMAL_FILENAME}}_title.txt, {{ANIMAL_FILENAME}}_desc.txt, {{ANIMAL_FILENAME}}_tags.txt, and {{ANIMAL_FILENAME}}_info.zip.
etsy.txt was not created.
No category file was created.
No headings such as TITLE:, DESCRIPTION:, TAGS:, or CATEGORY: appear in the output files.

After creating the files, provide separate download links to:
{{ANIMAL_FILENAME}}_title.txt
{{ANIMAL_FILENAME}}_desc.txt
{{ANIMAL_FILENAME}}_tags.txt`;

export type DownloadDetailsPromptValues = {
  animalName: string;
  animalDescription: string;
  roomTheme: string;
  frameColour: string;
  orientation: string;
  fileType: string;
  frameColours: string;
  filesIncluded: string;
  recommendedPaper: string;
  licenceType: string;
};

function cleanPromptValue(value: string) {
  return value.trim().replace(/\s+/g, ' ');
}

function animalFilename(name: string) {
  return cleanPromptValue(name)
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[’']/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

export function missingDownloadDetailsPromptFields(values: DownloadDetailsPromptValues) {
  return ([
    ['Listing item', values.animalName],
    ['Listing description', values.animalDescription],
    ['Room theme', values.roomTheme],
    ['Digital Downloads files', values.filesIncluded],
  ] as const)
    .filter(([, value]) => !cleanPromptValue(value))
    .map(([label]) => label);
}

export function buildDownloadDetailsPrompt(values: DownloadDetailsPromptValues) {
  const name = cleanPromptValue(values.animalName);
  const suppliedDescription = cleanPromptValue(values.animalDescription);
  const leadingAnimalName = suppliedDescription.match(/^(.+?)\s+[–—]\s+(.+)$/);
  const description = leadingAnimalName && leadingAnimalName[1].toLocaleLowerCase() === name.toLocaleLowerCase()
    ? leadingAnimalName[2]
    : suppliedDescription;
  const replacements: Record<string, string> = {
    ANIMAL_FILENAME: animalFilename(name),
    ANIMAL: `${name} – ${description}`,
    ROOM_THEME: cleanPromptValue(values.roomTheme),
    FRAME_COLOUR: cleanPromptValue(values.frameColour),
    ORIENTATION: cleanPromptValue(values.orientation),
    FILE_TYPE: cleanPromptValue(values.fileType),
    FRAME_COLOURS: cleanPromptValue(values.frameColours),
    FILES_INCLUDED: cleanPromptValue(values.filesIncluded),
    RECOMMENDED_PAPER: cleanPromptValue(values.recommendedPaper),
    LICENCE_TYPE: cleanPromptValue(values.licenceType),
  };

  return DOWNLOAD_DETAILS_PROMPT.replace(/\{\{([A-Z_]+)\}\}/g, (placeholder, key: string) => replacements[key] ?? placeholder);
}
