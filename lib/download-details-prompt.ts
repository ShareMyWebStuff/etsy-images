const DOWNLOAD_DETAILS_PROMPT = `ETSY DIGITAL DOWNLOAD LISTING COPY

AUTHORITATIVE INPUTS
ANIMAL: {{ANIMAL}}
ROOM_THEME: {{ROOM_THEME}}
FRAME_COLOUR: {{FRAME_COLOUR}}
ORIENTATION: {{ORIENTATION}}
FILE_TYPE: {{FILE_TYPE}}
FRAME_COLOURS: {{FRAME_COLOURS}}
RECOMMENDED_PAPER: {{RECOMMENDED_PAPER}}
LICENCE_TYPE: {{LICENCE_TYPE}}

APPLICATION-SUPPLIED FILE AND PRINT GUIDE
{{FILES_INCLUDED}}

TASK

Write the title, complete description and Etsy tags for one individual digital nursery or children's wall-art listing.

Use only the authoritative inputs and file guide above. Do not invent colours, visual details, sizes, ratios, pixel dimensions, delivery promises, licence permissions or product specifications.

Derive ANIMAL_NAME from the text before the first spaced en dash or em dash in ANIMAL. Derive ANIMAL_DESCRIPTION from the text after it. Use ANIMAL_NAME as the subject and ANIMAL_DESCRIPTION only for supported colours, appearance, pose and character.

Write in warm, natural British English. Avoid repetitive adjectives, exaggerated claims, keyword lists and repeated product information.

TITLE

Write a human-readable Etsy title of fewer than 15 words and no more than 140 characters.

* Front-load ANIMAL_NAME and a supported colour, style or nursery-placement phrase where natural.
* Make clear that this is printable nursery wall art.
* Use vertical bars to separate phrases and do not use commas or emojis.
* Use ROOM_THEME naturally without keyword stuffing.

DIGITAL DOWNLOAD DESCRIPTION RULES

* Clearly identify the product as a digital download at the beginning. Never imply that printing, framing, mounts, props, postage or delivery of a physical item is included.
* Explain that the six JPEG files contain different size formats of the same artwork, not six different designs.
* Include a short, natural gift section with occasions appropriate to ANIMAL_NAME and ROOM_THEME, such as a baby shower, new baby celebration, children's birthday, Christmas, christening or naming day. Explain that the buyer arranges printing and framing.
* Group print sizes by the application-supplied file or aspect ratio. Within each group, separate inches and centimetres.
* Write dimensions consistently using “×”, “in” and “cm”. Include the supplied physical dimensions beside every A-series size.
* Preserve every supplied pixel dimension, unit, supported size and maximum print size exactly. Never invent sizes, convert units or treat similar imperial and metric sizes as interchangeable.
* Use the maximum print sizes calculated and supplied by the application. Do not assume that a generic “300 DPI” label guarantees sufficient resolution at every size.
* Describe the actual delivery method: an Etsy PDF containing a link to the JPEG files. Never call the link secure, permanent or unlimited.
* Do not promise that the customer can download, print or frame the artwork within a particular time.
* Recommend exactly the supplied RECOMMENDED_PAPER range and mention home-printer compatibility.
* Use one concise colour-variation note without defensive language or guarantees of perfect matching.
* Reproduce LICENCE_TYPE accurately. Never add gift limits, print limits, commercial rights, refund policies or other restrictions that it does not contain.

DESCRIPTION FORMAT

Use the following headings exactly and in this order. Put every heading on its own line with a blank line before and after it.

📥 DIGITAL DOWNLOAD ONLY — NO PHYSICAL ITEM WILL BE SENT

Begin with one short paragraph explaining that the listing supplies downloadable artwork for the buyer to print. State that printing, frames, mounts and decorative props are not included.

✨ ABOUT THIS ARTWORK ✨

Write one or two warm paragraphs tailored to ANIMAL_NAME, ANIMAL_DESCRIPTION and ROOM_THEME. Describe appropriate nursery, child's bedroom, playroom, reading-corner or gallery-wall uses without inventing visual details. Mention coordinating designs naturally where relevant.

🎁 A THOUGHTFUL GIFT TO PRINT AND FRAME 🎁

Explain that the buyer can create a personal gift by arranging the printing and choosing a frame. Include a concise bullet list of appropriate gifting occasions. Do not force an occasion that is unsuitable for the artwork. Finish by explaining that the buyer chooses the final size and presentation.

📦 WHAT YOU WILL RECEIVE 📦

State that the buyer receives an Etsy-delivered PDF containing a download link to six high-resolution artwork files. Name their format using the uppercase form of FILE_TYPE, for example JPEG.

Explain that every file contains the same ANIMAL_NAME artwork in a different proportion for the supported sizes. Make clear that this is one artwork in six size formats, not six different designs.

📐 PRINT SIZES AND FILE GUIDE 📐

State that all measurements are width × height and that the buyer should choose the file matching the intended print size.

Reproduce every group from APPLICATION-SUPPLIED FILE AND PRINT GUIDE. Use its file name as a subheading, list A-series, inch and centimetre sizes as supplied, and reproduce its pixel dimensions and maximum listed print size exactly. Do not add or omit anything.

After the guide, explain that the files provide approximately 300 pixels per inch at their supplied maximum listed sizes and a higher pixel density when printed smaller. Do not describe this as a blanket 300-DPI guarantee for every possible print size.

📥 HOW TO DOWNLOAD AND PRINT 📥

Give these practical steps clearly:

1. After Etsy confirms payment, download the supplied PDF from Etsy purchases; guest buyers can use the link in their Etsy receipt email.
2. Open the PDF and follow its link to download the JPEG files.
3. Use the size guide to select the correct file.
4. Print at home, through a local print shop or with an online printing service.
5. Place the finished print in the buyer's chosen frame.

State that buyers should use a computer or mobile web browser because Etsy digital downloads are not available through the Etsy app. Do not claim delivery by email except for Etsy's guest receipt.

🖨️ PAPER AND PRINTING TIPS 🖨️

Recommend RECOMMENDED_PAPER. Tell home-printing buyers to check that their printer supports the chosen paper type, weight and size. Advise setting the intended dimensions, checking print preview, and avoiding stretch or crop settings. Suggest a professional printing service for larger sizes without claiming it is required.

🎨 COLOUR NOTE 🎨

Use one concise paragraph explaining that printed colours may vary slightly because screens, printers, inks and papers differ.

💬 NEED HELP? 💬

Invite buyers who have difficulty downloading the files or choosing a size to contact the shop through Etsy.

✨ EXPLORE MORE DESIGNS ✨

Write one warm sentence inviting buyers to browse coordinating designs and children's wall art related to ROOM_THEME.

Then write exactly:

Browse CosyHousePrints:
https://www.etsy.com/shop/CosyHousePrints

📄 PERSONAL USE LICENCE 📄

Express LICENCE_TYPE clearly in short paragraphs. State only its supplied permissions and restrictions. Keep permission to provide a relevant file to a printing service when LICENCE_TYPE supplies it. Do not invent refund terms or additional limits.

TAGS

Return exactly 13 distinct, relevant Etsy tags unless fewer are genuinely relevant. Each tag must be fewer than 20 characters including spaces. Return one comma-separated line without bullets. Use ANIMAL_NAME, ROOM_THEME, nursery printable art, children's rooms and appropriate gifting searches without unsupported details or duplicates.`;

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

function cleanMultilinePromptValue(value: string) {
  return value
    .trim()
    .split(/\r?\n/)
    .map((line) => line.trim().replace(/[ \t]+/g, ' '))
    .join('\n');
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
    ANIMAL: `${name} – ${description}`,
    ROOM_THEME: cleanPromptValue(values.roomTheme),
    FRAME_COLOUR: cleanPromptValue(values.frameColour),
    ORIENTATION: cleanPromptValue(values.orientation),
    FILE_TYPE: cleanPromptValue(values.fileType),
    FRAME_COLOURS: cleanPromptValue(values.frameColours),
    FILES_INCLUDED: cleanMultilinePromptValue(values.filesIncluded),
    RECOMMENDED_PAPER: cleanPromptValue(values.recommendedPaper),
    LICENCE_TYPE: cleanPromptValue(values.licenceType),
  };

  return DOWNLOAD_DETAILS_PROMPT.replace(/\{\{([A-Z_]+)\}\}/g, (placeholder, key: string) => replacements[key] ?? placeholder);
}
