import type { GeneratedListingDetails } from '@/lib/combined-listing-details-prompt';
import { ETSY_PRIMARY_COLOURS } from '@/lib/etsy-colours';

export type MultipleListingPromptItem = {
  position: number;
  listingName: string;
  itemName: string;
  description: string;
  roomTheme: string;
  orientation: string;
  primaryColour: string;
  secondaryColour: string;
};

export type MultipleListingDetailsPromptValues = {
  sectionName: string;
  listingName: string;
  listingDescription: string;
  templateName: string;
  roomTheme: string;
  itemCount: number;
  items: MultipleListingPromptItem[];
  printSizes: string;
  frameColours: string;
  personalisationDetails: string;
  giftMessageEnabled: boolean;
  digitalDownloadEnabled: boolean;
  digitalFileGuides: string;
  recommendedPaper: string;
  licenceType: string;
};

export type GeneratedMultipleListingDetails = GeneratedListingDetails & {
  primaryColour: string;
  secondaryColour: string;
};

function value(input: string) {
  return JSON.stringify(input.trim());
}

export function buildMultipleListingDetailsPrompt(values: MultipleListingDetailsPromptValues) {
  const allowedColours = ETSY_PRIMARY_COLOURS.map((colour) => colour.value);
  const itemFacts = values.items.map((item) => ({
    position: item.position,
    listingName: item.listingName,
    itemName: item.itemName,
    description: item.description,
    roomTheme: item.roomTheme,
    orientation: item.orientation,
    savedPrimaryColour: item.primaryColour,
    savedSecondaryColour: item.secondaryColour,
  }));

  return `GROUPED ETSY PRINT AND DIGITAL DOWNLOAD LISTING TASK

Create the buyer-facing listing details for one grouped product containing exactly ${values.itemCount} coordinated artworks. This is a genuine set, not one artwork supplied in different sizes.

AUTHORITATIVE GROUP DETAILS
SECTION_NAME = ${value(values.sectionName)}
LISTING_NAME = ${value(values.listingName)}
LISTING_DESCRIPTION = ${value(values.listingDescription)}
TEMPLATE_NAME = ${value(values.templateName)}
ROOM_THEME = ${value(values.roomTheme)}
NUMBER_OF_ARTWORKS = ${values.itemCount}
GROUPED_ARTWORKS_JSON = ${JSON.stringify(itemFacts)}

PRODUCT OPTIONS
PRINT_SIZES = ${value(values.printSizes)}
FRAME_COLOURS = ${value(values.frameColours)}
PERSONALISATION_DETAILS = ${value(values.personalisationDetails)}
GIFT_MESSAGE_ENABLED = ${value(values.giftMessageEnabled ? 'Y' : 'N')}
DIGITAL_DOWNLOAD_ENABLED = ${value(values.digitalDownloadEnabled ? 'Y' : 'N')}
RECOMMENDED_PAPER = ${value(values.recommendedPaper)}
LICENCE_TYPE = ${value(values.licenceType)}

DIGITAL FILE GUIDES
${values.digitalFileGuides}

Use all entries in GROUPED_ARTWORKS_JSON. Name the included subjects naturally and accurately, and use each supplied description to distinguish the artworks. Do not omit an artwork, duplicate one, add another subject, or invent colours, characteristics, sizes, finishes, materials, files, personalisation choices or delivery promises.

Write warm, natural British English. Avoid keyword stuffing, repetitive adjectives, exaggerated claims and repeated product information.

PHYSICAL PRINT LISTING

Write an Etsy title no longer than 140 characters that makes clear this is a set of ${values.itemCount} coordinated prints and identifies the shared subject or room theme.

Write a complete physical description with these exact headings in this order:

✨ ABOUT THIS PRINT SET ✨
🖼️ PRINT OPTIONS AND SIZES 🖼️
🎨 PAPER, FINISH AND FRAMING 🎨
📦 WHAT YOU WILL RECEIVE 📦
🛒 HOW TO ORDER 🛒
🚚 DELIVERY AND ORDER HELP 🚚
💡 GOOD TO KNOW 💡

If DIGITAL_DOWNLOAD_ENABLED is Y, then add:
💻 PREFER A DIGITAL DOWNLOAD? 💻

Finish with:
✨ EXPLORE MORE DESIGNS ✨

Open with a warm sentence explaining that the buyer receives a coordinated set of ${values.itemCount} artworks, available using only the supplied product options. In ABOUT THIS PRINT SET, describe the complete collection and naturally name every included artwork. Mention relevant baby shower, new baby, birthday or Christmas gifting only where appropriate.

Use PRINT_SIZES exactly, preserving its groups, units and availability. Explain that measurements are width × height and refer to each individual print. Never imply the dimensions describe the combined group. If FRAME_COLOURS is non-empty, explain the unframed and framed choices using only those finishes. Describe oak only as a finish. State that framed prints use durable wooden frames, protective shatter-resistant acrylic glazing, arrive fitted and include hanging hardware. If FRAME_COLOURS is empty, do not offer framed choices or invent frame specifications.

Both unframed and framed prints use premium heavyweight matte paper of at least 200gsm. State clearly that the order contains one coordinated set of ${values.itemCount} physical prints; decorative props and other artwork are excluded. A physical order does not include digital files.

Use PERSONALISATION_DETAILS only when it is non-empty. Refer consistently to the listing's personalisation box. Include a gift-message section only when GIFT_MESSAGE_ENABLED is Y. Keep delivery statements general and invite the buyer to contact the shop through Etsy for help. State once that colours may vary slightly between screens and finished prints.

When DIGITAL_DOWNLOAD_ENABLED is Y, keep the digital promotion to two short paragraphs, make clear it is a separate listing and purchase, and do not include its technical file specifications in the physical description.

DIGITAL DOWNLOAD LISTING

Write a separate Etsy title no longer than 140 characters that makes clear this is a digital download bundle containing the same ${values.itemCount} artworks.

Begin the digital description with exactly:
📥 DIGITAL DOWNLOAD ONLY — NO PHYSICAL ITEM WILL BE SENT

Then use these exact headings in this order:

✨ ABOUT THIS ARTWORK SET ✨
🎁 A THOUGHTFUL GIFT TO PRINT AND FRAME 🎁
📦 WHAT YOU WILL RECEIVE 📦
📐 PRINT SIZES AND FILE GUIDE 📐
📥 HOW TO DOWNLOAD AND PRINT 📥
🖨️ PAPER AND PRINTING TIPS 🖨️
🎨 COLOUR NOTE 🎨
💬 NEED HELP? 💬
✨ EXPLORE MORE DESIGNS ✨
📄 PERSONAL USE LICENCE 📄

Explain that printing, frames, mounts and decorative props are not included. Describe all ${values.itemCount} included artworks naturally. Explain that the buyer arranges printing and framing.

The Etsy purchase delivers one PDF containing one clearly labelled Dropbox download link for each of the ${values.itemCount} artworks. Each link gives access to that artwork's JPEG size-format files. Do not claim the links are permanent, secure or unlimited. Do not describe the ${values.itemCount} artworks as merely different size formats of one design.

Reproduce DIGITAL FILE GUIDES accurately. Preserve every supplied size, unit, pixel dimension, orientation and maximum print size. Explain that each artwork is supplied in the listed size formats. Do not invent files or promise a resolution unsupported by the guide.

Recommend ${values.recommendedPaper}. Explain Etsy's normal download route without promising immediate access or claiming downloads work in the Etsy app. Include one concise colour-variation note. Reproduce LICENCE_TYPE accurately without inventing additional restrictions, printing limits, commercial rights or refund policies.

For both descriptions, finish the shop section with this plain URL:
https://www.etsy.com/shop/CosyHousePrints

ETSY TAGS

Return exactly 13 distinct tags shared by the physical and digital versions. Every tag must be 20 characters or fewer, contain no emoji, and be relevant to the complete grouped collection. Cover the subjects, shared theme, children's or nursery décor, print sets, gallery walls, digital printables and appropriate gifting searches. Do not use unsupported colours, styles, materials or personalisation terms.

ETSY COLOURS

Choose the two best representative Etsy colours for the collection as a whole using the artwork descriptions and the saved source colours. Prefer colours that recur across the grouped artworks; do not simply copy the first artwork. The secondary colour must differ from the primary colour.

Both values must be selected exactly from this allowed value list:
${JSON.stringify(allowedColours)}

OUTPUT

Return valid JSON exactly once between these markers, with JSON-escaped newlines inside descriptions:

<ETSY_MULTIPLE_LISTING_DATA>
{"printTitle":"physical set title","printDescription":"complete physical set description","digitalTitle":"digital set title","digitalDescription":"complete digital set description","tags":["tag 1","tag 2","tag 3","tag 4","tag 5","tag 6","tag 7","tag 8","tag 9","tag 10","tag 11","tag 12","tag 13"],"primaryColour":"allowed value","secondaryColour":"different allowed value"}
</ETSY_MULTIPLE_LISTING_DATA>

Do not use Markdown code fences. Do not add commentary before or after the markers.`;
}

function requiredText(value: unknown, label: string) {
  if (typeof value !== 'string' || !value.trim()) throw new Error(`AWS Bedrock did not return ${label}.`);
  return value.trim();
}

export function parseGeneratedMultipleListingDetails(responseText: string): GeneratedMultipleListingDetails {
  const marked = responseText.match(/<ETSY_MULTIPLE_LISTING_DATA>\s*([\s\S]*?)\s*<\/ETSY_MULTIPLE_LISTING_DATA>/i)?.[1];
  if (!marked) throw new Error('AWS Bedrock did not return the required grouped Etsy listing data markers.');
  const jsonText = marked.trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '');
  let parsed: unknown;
  try {
    parsed = JSON.parse(jsonText);
  } catch {
    throw new Error('AWS Bedrock returned grouped Etsy listing data that was not valid JSON.');
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error('AWS Bedrock returned an invalid grouped Etsy listing data object.');
  }

  const record = parsed as Record<string, unknown>;
  const tags = (Array.isArray(record.tags) ? record.tags : typeof record.tags === 'string' ? record.tags.split(',') : [])
    .filter((tag): tag is string => typeof tag === 'string')
    .map((tag) => tag.trim())
    .filter(Boolean)
    .filter((tag, index, all) => all.findIndex((candidate) => candidate.toLocaleLowerCase() === tag.toLocaleLowerCase()) === index);
  if (tags.length !== 13) throw new Error('AWS Bedrock must return exactly 13 distinct Etsy tags for a grouped listing.');
  const longTag = tags.find((tag) => Array.from(tag).length > 20);
  if (longTag) throw new Error(`AWS Bedrock returned an Etsy tag longer than 20 characters: ${longTag}`);

  const printTitle = requiredText(record.printTitle, 'the Print title');
  const digitalTitle = requiredText(record.digitalTitle, 'the Digital Download title');
  if (Array.from(printTitle).length > 140 || Array.from(digitalTitle).length > 140) {
    throw new Error('AWS Bedrock returned an Etsy title longer than 140 characters.');
  }

  const primaryColour = requiredText(record.primaryColour, 'the primary Etsy colour').toLocaleLowerCase();
  const secondaryColour = requiredText(record.secondaryColour, 'the secondary Etsy colour').toLocaleLowerCase();
  const allowedColours = new Set<string>(ETSY_PRIMARY_COLOURS.map((colour) => colour.value));
  if (!allowedColours.has(primaryColour) || !allowedColours.has(secondaryColour)) {
    throw new Error('AWS Bedrock returned a colour that is not an allowed Etsy colour.');
  }
  if (primaryColour === secondaryColour) {
    throw new Error('AWS Bedrock must return different primary and secondary Etsy colours.');
  }

  return {
    printTitle,
    printDescription: requiredText(record.printDescription, 'the Print description'),
    digitalTitle,
    digitalDescription: requiredText(record.digitalDescription, 'the Digital Download description'),
    tags,
    primaryColour,
    secondaryColour,
  };
}
