import { buildDetailsGeneratePrompt } from '@/lib/details-generate-prompt';
import { buildDownloadDetailsPrompt } from '@/lib/download-details-prompt';

export type CombinedListingDetailsPromptValues = {
  sectionName: string;
  listingName: string;
  animalName: string;
  animalDescription: string;
  roomTheme: string;
  digitalDownload: boolean;
  paperDetails: string;
  printSizes: string;
  frameColours: string;
  personalisationDetails: string;
  giftMessageEnabled: boolean;
  digitalFilesIncluded: string;
  orientation: string;
  fileType: string;
  recommendedPaper: string;
  licenceType: string;
};

export type GeneratedListingDetails = {
  printTitle: string;
  printDescription: string;
  digitalTitle: string;
  digitalDescription: string;
  tags: string[];
};

export const GIFT_MESSAGE_DESCRIPTION_BLOCK = `🎁 GIFT MESSAGES 🎁

Sending this print as a gift? Add your message using Etsy’s gift-message option at checkout.

Please keep it within 500 characters, including spaces, punctuation and the sender’s name. This message accompanies your gift and is not printed on the artwork.`;

function promptValue(value: string) {
  return JSON.stringify(value.trim());
}

function animalDescriptionWithoutRepeatedName(name: string, suppliedDescription: string) {
  const description = suppliedDescription.trim();
  const leadingName = description.match(/^(.+?)\s+[–—-]\s+(.+)$/);
  return leadingName && leadingName[1].trim().toLocaleLowerCase() === name.trim().toLocaleLowerCase()
    ? leadingName[2].trim()
    : description;
}

export function missingCombinedListingDetailsPromptFields(values: CombinedListingDetailsPromptValues) {
  return ([
    ['Section name', values.sectionName],
    ['Listing name', values.listingName],
    ['Listing item', values.animalName],
    ['Listing description', values.animalDescription],
    ['Room theme', values.roomTheme],
  ] as const)
    .filter(([, value]) => !value.trim())
    .map(([label]) => label);
}

export function buildCombinedListingDetailsPrompt(values: CombinedListingDetailsPromptValues) {
  const description = animalDescriptionWithoutRepeatedName(values.animalName, values.animalDescription);
  const animal = description ? `${values.animalName.trim()} – ${description}` : values.animalName.trim();
  const printPrompt = buildDetailsGeneratePrompt({
    sectionName: values.sectionName,
    listingName: values.listingName,
    animal,
    roomTheme: values.roomTheme,
    digitalDownload: values.digitalDownload,
    paperDetails: values.paperDetails,
    printSizes: values.printSizes,
    frameColours: values.frameColours,
    personalisationDetails: values.personalisationDetails,
    digitalFilesIncluded: values.digitalFilesIncluded,
  });
  const downloadPrompt = buildDownloadDetailsPrompt({
    animalName: values.animalName,
    animalDescription: description,
    roomTheme: values.roomTheme,
    frameColour: values.frameColours.split(',').map((value) => value.trim()).find(Boolean) ?? '',
    orientation: values.orientation,
    fileType: values.fileType,
    frameColours: values.frameColours,
    filesIncluded: values.digitalFilesIncluded,
    recommendedPaper: values.recommendedPaper,
    licenceType: values.licenceType,
  });
  const giftMessageInstruction = values.giftMessageEnabled
    ? `Include this exact section in the physical Print Description after HOW TO ORDER and before DELIVERY AND ORDER HELP:\n\n${GIFT_MESSAGE_DESCRIPTION_BLOCK}`
    : 'Do not include a gift-message section in either listing description.';

  return `COMBINED ETSY PRINT AND DIGITAL DOWNLOAD LISTING TASK

AUTHORITATIVE LISTING VARIABLES
SECTION_NAME = ${promptValue(values.sectionName)}
LISTING_NAME = ${promptValue(values.listingName)}
ANIMAL = ${promptValue(animal)}
ROOM_THEME = ${promptValue(values.roomTheme)}
DIGITAL_DOWNLOAD = ${promptValue(values.digitalDownload ? 'Y' : 'N')}
PAPER_DETAILS = ${promptValue(values.paperDetails)}
PRINT_SIZES = ${promptValue(values.printSizes)}
FRAME_COLOURS = ${promptValue(values.frameColours)}
FRAME_COLOUR = ${promptValue(values.frameColours.split(',').map((value) => value.trim()).find(Boolean) ?? '')}
PERSONALISATION_DETAILS = ${promptValue(values.personalisationDetails)}
GIFT_MESSAGE_ENABLED = ${promptValue(values.giftMessageEnabled ? 'Y' : 'N')}
DIGITAL_FILES_INCLUDED = ${promptValue(values.digitalFilesIncluded)}
FILES_INCLUDED = ${promptValue(values.digitalFilesIncluded)}
ORIENTATION = ${promptValue(values.orientation)}
FILE_TYPE = ${promptValue(values.fileType)}
RECOMMENDED_PAPER = ${promptValue(values.recommendedPaper)}
LICENCE_TYPE = ${promptValue(values.licenceType)}

The authoritative variables above apply to both rule sets below and override any repeated input block.
PRINT_SIZES contains only the enabled Etsy Product sizes.
FRAME_COLOURS contains only enabled framed-print colours and never includes the No Frame option.
${giftMessageInstruction}
Never include the gift-message section in the digital-download description.

Create two distinct Etsy listings for the same artwork:
1. A physical print/framed-print listing using PHYSICAL PRINT RULES.
2. A digital-download listing using DIGITAL DOWNLOAD RULES.

Use the complete copywriting, accuracy, title, description and tag rules in both supplied rule sets. The application has one shared Tags tab, so return one set of exactly 13 distinct tags suitable for the artwork and both listing formats. Every tag must be 20 characters or fewer.

PHYSICAL PRINT RULES
====================
${printPrompt}

DIGITAL DOWNLOAD RULES
======================
${downloadPrompt}

APPLICATION OUTPUT REQUIREMENT — THIS OVERRIDES ONLY THE FILE, ZIP, DOWNLOAD-LINK AND FINAL-RESPONSE INSTRUCTIONS ABOVE

Do not create files, ZIP archives, images or download links for this combined run.
Return the completed listing data exactly once between these markers:

<ETSY_LISTING_DATA>
{"printTitle":"physical listing title","printDescription":"complete physical listing description","digitalTitle":"digital listing title","digitalDescription":"complete digital listing description","tags":["tag 1","tag 2","tag 3","tag 4","tag 5","tag 6","tag 7","tag 8","tag 9","tag 10","tag 11","tag 12","tag 13"]}
</ETSY_LISTING_DATA>

Return valid JSON with JSON-escaped newlines inside descriptions. Do not use Markdown or code fences. Do not add text before or after the markers.`;
}

export function buildSetDetailsClipboardPrompt(values: CombinedListingDetailsPromptValues) {
  const description = animalDescriptionWithoutRepeatedName(values.animalName, values.animalDescription);
  const frameColours = values.frameColours.trim() || 'No framed options are enabled';
  const printSizes = values.printSizes.trim() || 'No physical print sizes are enabled';
  const personalisation = values.personalisationDetails.trim() || 'No personalisation is offered';
  const digitalFiles = values.digitalFilesIncluded.trim();
  const giftMessageSection = values.giftMessageEnabled
    ? `\n${GIFT_MESSAGE_DESCRIPTION_BLOCK}\n`
    : '';

  return `CREATE ETSY PRINT AND DIGITAL DOWNLOAD LISTING DETAILS

Use only the authoritative variables below. They are already populated for this individual listing and section.

AUTHORITATIVE VARIABLES
SECTION_NAME = ${promptValue(values.sectionName)}
LISTING_NAME = ${promptValue(values.listingName)}
ANIMAL_NAME = ${promptValue(values.animalName)}
ANIMAL_DESCRIPTION = ${promptValue(description)}
ROOM_THEME = ${promptValue(values.roomTheme)}
ORIENTATION = ${promptValue(values.orientation)}
PAPER_DETAILS = ${promptValue(values.paperDetails)}
PRINT_SIZES = ${promptValue(printSizes)}
FRAME_COLOURS = ${promptValue(frameColours)}
PERSONALISATION_DETAILS = ${promptValue(personalisation)}
GIFT_MESSAGE_ENABLED = ${promptValue(values.giftMessageEnabled ? 'Y' : 'N')}
DIGITAL_FILES_INCLUDED = ${promptValue(digitalFiles)}
DIGITAL_FILE_TYPE = ${promptValue(values.fileType)}
RECOMMENDED_PAPER = ${promptValue(values.recommendedPaper)}
LICENCE_TYPE = ${promptValue(values.licenceType)}
SHOP_URL = "https://www.etsy.com/shop/CosyHousePrints"

TASK

Write complete Etsy listing details for:
1. One physical unframed or framed print listing.
2. One digital-download listing for the same artwork.
3. One shared set of Etsy tags.

Follow the exact output order, headings, emoji style and scannable tone specified below. The supplied Green Sea Turtle example established this format, but all wording and facts must be freshly written for the authoritative variables above. Do not copy turtle, ocean, soft-green or Sea Creatures details unless those facts are present in the variables.

ACCURACY RULES

- Never invent colours, characteristics, products, sizes, frames, files, materials, personalisation choices or delivery promises.
- Use PRINT_SIZES exactly for the physical listing. Do not add sizes that are not enabled.
- Use FRAME_COLOURS exactly and never include “No Frame” as a frame colour.
- Use PERSONALISATION_DETAILS only when personalisation is offered. If it says no personalisation is offered, omit the personalisation ordering step.
- Include the supplied GIFT MESSAGES section in the physical Print Description only when GIFT_MESSAGE_ENABLED is "Y". Never include it in the digital description.
- The digital bundle contains six high-resolution JPEG artwork files represented by DIGITAL_FILES_INCLUDED, plus a separate How_To_Print_Guide.pdf. Do not describe it as seven JPEG files and do not add sizes that are not represented in DIGITAL_FILES_INCLUDED.
- Keep titles at 140 characters or fewer.
- Return exactly 13 distinct Etsy tags. Each tag must be 20 characters or fewer.
- Use natural British English. Avoid keyword stuffing and repeated sentences.
- Return plain text only. Do not use Markdown code fences, JSON, commentary, explanations or downloadable files.

REQUIRED OUTPUT FORMAT

Print Title

[Write an SEO-aware physical listing title naming the artwork and making clear that it is a framed or unframed print.]

Print Description

[Open with one sentence explaining that the artwork is available as an unframed or framed print and that size and finish are selected from the listing options.]

✨ ABOUT THIS PRINT ✨

[Write a warm, specific paragraph using ANIMAL_NAME, ANIMAL_DESCRIPTION and ROOM_THEME. Explain suitable nursery, bedroom, playroom, reading-corner or gift uses only where natural.]

🖼️ CHOOSE YOUR PRINT 🖼️

[Explain the unframed and framed choices and state ORIENTATION.]

Available print sizes:

[List only PRINT_SIZES clearly. Group metric/A-series and inch sizes where useful, without adding options.]

Frame colours: [Use FRAME_COLOURS exactly]. Please check the listing options for available size and finish combinations.

[Explain that sizes refer to the paper print rather than external frame dimensions.]

📦 WHAT YOU WILL RECEIVE 📦

• Unframed option: one physical paper print in the selected size, without a frame.
• Framed option: one physical print supplied in the selected frame and size.

[Clarify that the order contains one print and that styling props or other artwork are not included.]

🎨 PAPER AND FINISH 🎨

[Describe PAPER_DETAILS and relate the verified artwork qualities to an appropriate room without inventing colours.]

🛒 HOW TO ORDER 🛒

1. Choose an available print size.
2. Select an unframed or framed print and the applicable frame finish.
[Add a numbered personalisation instruction only if PERSONALISATION_DETAILS offers personalisation.]
[Finish with a numbered instruction to review selections and the delivery address before checkout.]
${giftMessageSection}

🚚 DELIVERY AND ORDER HELP 🚚

Please see the delivery information on this listing for the current estimated arrival date and applicable charges.

Contact the shop through Etsy if you need help with your order or if your item arrives damaged.

💡 GOOD TO KNOW 💡

[Explain that a frame is included only with the framed option and that colours can vary slightly between screens and the finished print.]

✨ EXPLORE MORE DESIGNS ✨

[Invite the buyer to browse coordinating nursery prints, children’s room designs and gallery-wall ideas.]

https://www.etsy.com/shop/CosyHousePrints

Digital Title

[Write an SEO-aware digital listing title naming the artwork and making clear that it is a printable.]

Digital Description

🚨 IMPORTANT: THIS IS A DIGITAL DOWNLOAD ONLY. NO PHYSICAL PRODUCT WILL BE SHIPPED. 🚨
Frames, mounts, props and display items are not included.

✨ ABOUT THIS PRINT ✨

[Write a fresh paragraph using ANIMAL_NAME, ANIMAL_DESCRIPTION and ROOM_THEME. Describe appropriate rooms and personal gifting without claiming commercial gifting rights.]

📦 WHAT YOU WILL RECEIVE 📦

[Explain that the buyer receives six high-resolution DIGITAL_FILE_TYPE artwork files covering the six entries in DIGITAL_FILES_INCLUDED, plus How_To_Print_Guide.pdf. State ORIENTATION.]

📐 SIZES INCLUDED (Print up to these maximum sizes):

[List every entry in DIGITAL_FILES_INCLUDED clearly and accurately. Do not add a ratio, file, pixel dimension or maximum size that is not supplied.]

[State that artwork files are 300 DPI JPEG files and that the dedicated 5:7 file should be used for a 5 × 7-inch print when that file is included.]

📥 HOW IT WORKS

1. Follow the listing’s digital delivery information to access and download the files.
2. Choose the file matching the intended print size and frame proportions.
3. Print at home or through a preferred print service.
4. Place the finished print in a frame of the buyer’s choice.

No physical product will be posted. Printing and framing costs are not included.

🖨️ RECOMMENDED PAPER & PRINTING TIPS

[Recommend RECOMMENDED_PAPER, explain home/local/online printing choices, and remind the buyer to check dimensions and print preview.]

🎨 COLOUR NOTE & ACCURACY

[Explain that colours may vary between screens, printers, inks and papers. Refer only to colour information actually present in ANIMAL_DESCRIPTION.]

✨ EXPLORE MORE DESIGNS OR CREATE A GALLERY WALL

[Invite the buyer to browse matching nursery prints, children’s room designs and gallery-wall ideas.]

https://www.etsy.com/shop/CosyHousePrints

⚖️ TERMS OF USE & LICENCE

[State LICENCE_TYPE. Permit personal home décor or one personal gift only. Prohibit commercial reproduction, resale, file sharing, redistribution, uploading or editing for resale, and selling printed versions. Tell gift buyers to give the finished print rather than the files.]

Tags

[Return exactly 13 comma-separated Etsy tags derived from ANIMAL_NAME, ROOM_THEME, SECTION_NAME, nursery wall art, relevant rooms and appropriate gifting searches. Each tag must be 20 characters or fewer.]`;
}

function requiredText(value: unknown, label: string) {
  if (typeof value !== 'string' || !value.trim()) throw new Error(`ChatGPT did not return ${label}.`);
  return value.trim();
}

function validateGeneratedListingDetails(generated: GeneratedListingDetails) {
  if (generated.printTitle.length > 140 || generated.digitalTitle.length > 140) {
    throw new Error('The Etsy titles must be no longer than 140 characters.');
  }
  if (generated.tags.length === 0 || generated.tags.length > 13) {
    throw new Error('The output must contain between 1 and 13 distinct Etsy tags.');
  }
  const longTag = generated.tags.find((tag) => Array.from(tag).length > 20);
  if (longTag) throw new Error(`The Etsy tag "${longTag}" is longer than 20 characters.`);
  return generated;
}

const SET_DETAILS_HEADINGS = [
  'Print Title',
  'Print Description',
  'Digital Title',
  'Digital Description',
  'Tags',
] as const;

/**
 * Parses the human-readable response copied from the Set Details prompt.
 * A heading is only recognised when it is the complete line, so words such as
 * "tags" within a description do not accidentally split the response.
 */
export function parseSetDetailsOutput(responseText: string): GeneratedListingDetails {
  const normalizedText = responseText.replace(/^\uFEFF/, '').replace(/\r\n?/g, '\n').trim();
  if (!normalizedText) throw new Error('Paste the complete Set Details output first.');

  const headingPattern = /^(Print Title|Print Description|Digital Title|Digital Description|Tags)\s*$/gim;
  const matches = Array.from(normalizedText.matchAll(headingPattern));
  if (matches.length !== SET_DETAILS_HEADINGS.length) {
    throw new Error(`The pasted output must contain these five sections once each: ${SET_DETAILS_HEADINGS.join(', ')}.`);
  }

  const sections = new Map<string, string>();
  matches.forEach((match, index) => {
    const heading = SET_DETAILS_HEADINGS.find((candidate) => candidate.toLocaleLowerCase() === match[1].toLocaleLowerCase());
    if (!heading || sections.has(heading)) {
      throw new Error(`The pasted output must contain each section once: ${SET_DETAILS_HEADINGS.join(', ')}.`);
    }
    if (heading !== SET_DETAILS_HEADINGS[index]) {
      throw new Error(`The pasted sections must be in this order: ${SET_DETAILS_HEADINGS.join(', ')}.`);
    }
    const contentStart = (match.index ?? 0) + match[0].length;
    const contentEnd = matches[index + 1]?.index ?? normalizedText.length;
    const content = normalizedText.slice(contentStart, contentEnd).trim();
    if (!content) throw new Error(`${heading} is empty in the pasted output.`);
    sections.set(heading, content);
  });

  const title = (heading: 'Print Title' | 'Digital Title') => sections.get(heading)!
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
    .join(' ');
  const tags = sections.get('Tags')!
    .split(/[,\n]+/)
    .map((tag) => tag.trim())
    .filter(Boolean)
    .filter((tag, index, all) => all.findIndex((candidate) => candidate.toLocaleLowerCase() === tag.toLocaleLowerCase()) === index);

  return validateGeneratedListingDetails({
    printTitle: title('Print Title'),
    printDescription: sections.get('Print Description')!,
    digitalTitle: title('Digital Title'),
    digitalDescription: sections.get('Digital Description')!,
    tags,
  });
}

export function parseGeneratedListingDetails(responseText: string): GeneratedListingDetails {
  const marked = responseText.match(/<ETSY_LISTING_DATA>\s*([\s\S]*?)\s*<\/ETSY_LISTING_DATA>/i)?.[1];
  if (!marked) throw new Error('ChatGPT did not return the required Etsy listing data markers.');
  const jsonText = marked.trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '');
  let parsed: unknown;
  try {
    parsed = JSON.parse(jsonText);
  } catch {
    throw new Error('ChatGPT returned Etsy listing data that was not valid JSON.');
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error('ChatGPT returned an invalid Etsy listing data object.');
  }
  const record = parsed as Record<string, unknown>;
  const printTitle = requiredText(record.printTitle, 'the Print title');
  const printDescription = requiredText(record.printDescription, 'the Print description');
  const digitalTitle = requiredText(record.digitalTitle, 'the Digital Download title');
  const digitalDescription = requiredText(record.digitalDescription, 'the Digital Download description');
  const rawTags = Array.isArray(record.tags)
    ? record.tags
    : typeof record.tags === 'string'
      ? record.tags.split(',')
      : [];
  const tags = rawTags
    .filter((tag): tag is string => typeof tag === 'string')
    .map((tag) => tag.trim())
    .filter(Boolean)
    .filter((tag, index, all) => all.findIndex((candidate) => candidate.toLocaleLowerCase() === tag.toLocaleLowerCase()) === index);

  return validateGeneratedListingDetails({ printTitle, printDescription, digitalTitle, digitalDescription, tags });
}
