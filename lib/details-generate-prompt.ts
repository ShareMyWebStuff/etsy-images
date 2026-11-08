import { ETSY_TITLE_RULES } from '@/lib/etsy-listing-title';

export type DetailsGeneratePromptValues = {
  sectionName: string;
  listingName: string;
  animal: string;
  roomTheme: string;
  digitalDownload: boolean;
  paperDetails: string;
  printSizes: string;
  frameColours: string;
  personalisationDetails: string;
  digitalFilesIncluded: string;
};

const PHYSICAL_PRINT_SIZE_LABELS: Record<string, string> = {
  a5: 'A5 — 14.8 × 21 cm',
  a4: 'A4 — 21 × 29.7 cm',
  a3: 'A3 — 29.7 × 42 cm',
  a2: 'A2 — 42 × 59.4 cm',
  a1: 'A1 — 59.4 × 84.1 cm',
  '5x7': '5 × 7 in',
  '6x8': '6 × 8 in',
  '8x10': '8 × 10 in',
  '11x14': '11 × 14 in',
  '12x16': '12 × 16 in',
  '12x18': '12 × 18 in',
  '16x20': '16 × 20 in',
  '16x24': '16 × 24 in',
  '18x24': '18 × 24 in',
  '20x28': '20 × 28 in',
  '20x30': '20 × 30 in',
  '24x36': '24 × 36 in',
  '30x40cm': '30 × 40 cm',
  '50x70cm': '50 × 70 cm',
};

export function formatPhysicalPrintSizesForPrompt(sizes: ReadonlyArray<{ key: string; label: string }>) {
  return sizes.map((size) => PHYSICAL_PRINT_SIZE_LABELS[size.key] ?? size.label).join(', ');
}

const DETAILS_GENERATE_PROMPT = `SECTION_NAME = "{{SECTION_NAME}}"
LISTING_NAME = "{{LISTING_NAME}}"
ANIMAL = "{{ANIMAL}}"
ROOM_THEME = "{{ROOM_THEME}}"
DIGITAL_DOWNLOAD = "{{DIGITAL_DOWNLOAD}}"

ORIENTATION = "portrait"
PAPER_DETAILS = "{{PAPER_DETAILS}}"
PRINT_SIZES = "{{PRINT_SIZES}}"
FRAME_COLOURS = "{{FRAME_COLOURS}}"
FRAME_DETAILS = "Durable wooden frame with protective, shatter-resistant acrylic glazing; artwork supplied already fitted; hanging hardware included."
BORDER_DETAILS = ""
PERSONALISATION_DETAILS = "{{PERSONALISATION_DETAILS}}"
DELIVERY_DETAILS = ""

DIGITAL_LISTING_URL = ""
DIGITAL_FILES_INCLUDED = "{{DIGITAL_FILES_INCLUDED}}"
DIGITAL_DELIVERY_DETAILS = ""

SHOP_URL = "https://www.etsy.com/shop/CosyHousePrints"

ETSY_TAG = AUTO

ETSY LISTING COPY — PRINTS AND FRAMED PRINTS

Create Etsy listing copy for one individual children’s wall-art design supplied as a physical unframed print or framed print.

Use only the values at the top of this prompt. Do not depend on an earlier variable setup prompt.

This task creates listing copy and text files. Do not generate or edit images, request an image upload, publish listings, or modify an Etsy account.

DEFAULTS AND VALIDATION

Required:

* SECTION_NAME
* LISTING_NAME
* ANIMAL
* ROOM_THEME

Defaults:

* DIGITAL_DOWNLOAD: N
* ORIENTATION: portrait
* PAPER_DETAILS: Heavyweight matte art paper, at least 200gsm
* SHOP_URL: https://www.etsy.com/shop/CosyHousePrints

Optional fields may remain empty. Omit unsupported details rather than inventing them.

Normalise DIGITAL_DOWNLOAD to uppercase. Accept only Y or N. If missing or blank, use N. If another value is supplied, stop and explain that it must be Y or N.

If a required field is missing, blank or unresolved, stop and identify the field that needs completing.

Do not treat an unresolved placeholder as usable product information.

DERIVED VALUES

ANIMAL may contain a name alone or a name followed by a description.

When present, split on the first spaced en dash “ – ” or spaced em dash “ — ”:

* ANIMAL_NAME: text before the separator.
* ANIMAL_DESCRIPTION: text after the separator.

If no separator exists:

* Use ANIMAL as ANIMAL_NAME.
* Leave ANIMAL_DESCRIPTION empty.
* Do not invent visual details.

Do not split ordinary hyphens within animal names.

Use LISTING_NAME as the short product identifier, not the generated SEO title.

Derive LISTING_FILENAME from LISTING_NAME:

* Convert to lowercase.
* Replace whitespace with hyphens.
* Remove apostrophes.
* Remove characters other than a–z, 0–9 and hyphens.
* Collapse repeated hyphens.
* Remove leading and trailing hyphens.
* If the result is empty, stop and request a usable LISTING_NAME.

ETSY_TAG RULES

Set ETSY_TAG automatically using:

NORMALISED_SECTION_NAME_NORMALISED_LISTING_NAME

Normalise each component separately:

* Convert to uppercase.
* Replace spaces and hyphens with underscores.
* Remove apostrophes.
* Replace other punctuation with underscores.
* Keep only A–Z, 0–9 and underscores.
* Collapse repeated underscores.
* Remove leading and trailing underscores.

Join the two components with one underscore.

Example:
SECTION_NAME = "Bugs Wall Art"
LISTING_NAME = "Caterpillar"

ETSY_TAG = "BUGS_WALL_ART_CATERPILLAR"

ETSY_TAG is an internal listing identifier:

* Do not include it in the buyer-facing title or description.
* Do not insert it into the 13 Etsy search tags.
* Do not truncate it to fit a search-tag character limit.
* Do not describe it as a unique SKU for every size and frame variation.
* Save its resolved value in its own text file.

PRODUCT POSITIONING

Lead with the physical artwork we supply.

Clearly distinguish:

* Unframed print: one physical paper print in the selected size, without a frame.
* Framed print: one physical print supplied in the selected frame and size.

A frame is included when the framed option is ordered.

Do not use a blanket “frames not included” statement.

State that decorative props and other artwork shown in styling photographs are not included.

Do not imply that the buyer receives every size, every frame colour or multiple prints.

Do not describe this individual design as a set or bundle.

Use warm, clear British English suitable for nursery, bedroom and playroom décor.

Keep the writing useful, scannable and natural. Avoid keyword stuffing, exaggerated claims and repeated warnings.

PRODUCTION AND MATERIALS

Do not mention supplier names, PrintShrimp, outsourcing, fulfilment routing, home printing, or switching between production methods in the buyer-facing physical-product copy.

Do not falsely claim that every print is handmade, printed in our own studio, inspected personally, or produced in a particular country.

Describe only product characteristics supported by the supplied information.

Use PAPER_DETAILS as the source for paper claims.

Do not invent:

* Exact paper brands
* Ink technology
* Archival or museum-grade certification
* Fade resistance or lifespan
* Sustainability certifications
* Frame wood species
* Solid-wood construction
* Mounts
* Gift wrapping

Use FRAME_DETAILS and BORDER_DETAILS only when supplied.

Do not describe frames as identical to mockups unless that is confirmed.

This task concerns description copy only. It must not change, remove or contradict production-partner disclosures or delivery-origin information elsewhere in the Etsy listing.

PHYSICAL OPTIONS

Mention ORIENTATION only where it reads naturally and adds useful information. Do not imply that landscape or other orientations are available unless supplied.

If PRINT_SIZES contains confirmed sizes:

* List only those sizes.
* Include accurate dimensions where supplied.
* Distinguish paper/print dimensions from external frame dimensions.
* Do not infer external frame dimensions.

If PRINT_SIZES is empty, write:
“Choose your preferred print size from the available listing options.”

If FRAME_COLOURS contains confirmed colours:

* List only those colours.
* Do not imply that every colour is available in every size unless confirmed.

If FRAME_COLOURS is empty, write:
“For framed prints, choose from the frame finishes available in the listing options.”

Do not invent dropdown names or option combinations.

If PERSONALISATION_DETAILS is blank:

* Do not advertise personalisation.
* Do not use personalised-product keywords.

If it contains confirmed instructions:

* Explain the available personalisation and ordering steps.
* Do not invent fees, proofs, turnaround times or unlimited revisions.

DIGITAL_DOWNLOAD SWITCH

When DIGITAL_DOWNLOAD = N:

* Write exclusively about physical prints and framed prints.
* Do not mention digital downloads, JPEGs, PDFs, download links, file ratios, DPI, printing at home or digital licences.
* Do not use “printable,” “instant download,” “digital art file” or similar search terms.
* Do not include a digital-only warning.
* Do not say that no physical item is shipped.

When DIGITAL_DOWNLOAD = Y:

* Keep physical prints and framed prints as the main subject.
* Add one clearly separated digital section near the end.
* Explain that the digital version is a separate purchase and is not automatically included with a physical order.
* Do not assume that a physical listing provides automatic Etsy downloads.
* Do not tell buyers to choose a digital dropdown option unless an actual purchase arrangement has been supplied.

If DIGITAL_LISTING_URL is supplied:

* Include the exact URL as plain text.
* Direct buyers there to purchase the digital version.

If DIGITAL_LISTING_URL is empty:

* Invite buyers to message the shop for the digital listing link.
* Do not invent a listing URL.

Keep the physical listing's digital promotion concise:

* Use no more than two short paragraphs.
* Explain that the digital version is a separate purchase for buyers who want to arrange their own printing.
* State that the digital purchase does not include a physical print or frame.
* Do not include pixel dimensions, ratios, file inventories, DPI, licence terms or detailed digital-delivery instructions.

TITLE

Create one Etsy title:

${ETSY_TITLE_RULES}

* Fewer than 15 words.
* No more than 140 characters.
* Include ANIMAL_NAME or the relevant subject in LISTING_NAME.
* Include “nursery wall art” or “nursery print” where appropriate.
* Make the physical product clear.
* Mention framed and unframed options naturally where space permits.
* Use vertical bars to separate phrases.
* Do not use commas.
* Do not add unsupported style, colour, material or personalisation claims.
* Do not keyword-stuff.
* Do not include emojis.

Keep the title focused on physical prints even when DIGITAL_DOWNLOAD = Y. Mention digital availability in the description instead.

DESCRIPTION FORMATTING AND STYLE

Write approximately 350–550 words. Avoid padding, repetitive adjectives, exaggerated claims and repeated product information.

Write in warm, natural British English. Mention baby-shower, new-baby and children's birthday gifting naturally only when appropriate to the artwork and room theme.

Use only the sizes, frame finishes, personalisation options and product specifications supplied in the variables. Never invent missing details.

Use the exact section headings specified below, including matching emojis on both sides. Place each heading on its own line with a blank line before and after it. Use emojis only in section headings.

Start with one warm, listing-specific sentence before the first heading:

* Lead with ANIMAL_NAME and supported visual details from ANIMAL_DESCRIPTION.
* Connect the design naturally to ROOM_THEME or a suitable child's room.
* State that it is available as an unframed print or a framed print ready to hang.
* Vary the wording naturally between listings rather than reusing a fixed opening sentence.

Then include the following sections in this exact order.

✨ ABOUT THIS PRINT ✨

Write exactly two short paragraphs:

* First paragraph: describe the subject's verified appearance, character or pose from ANIMAL_DESCRIPTION and explain how it suits ROOM_THEME, a nursery, child's bedroom or playroom. Mention complementary décor only when it follows naturally from supplied colours.
* Second paragraph: mention suitable baby-shower, new-baby, birthday or Christmas gifting naturally where appropriate. If PERSONALISATION_DETAILS is supplied, finish by explaining the available name or short-text personalisation. Omit every reference to personalisation when it is blank.

🖼️ PRINT OPTIONS AND SIZES 🖼️

Explain that buyers can choose an unframed print for their own frame or a framed print in one of the finishes supplied by FRAME_COLOURS.

State: “All measurements below are width × height and refer to the print size.”

Group only the supplied PRINT_SIZES beneath these plain-text subheadings, omitting any empty group:

A-SERIES SIZES
SIZES IN INCHES
SIZES IN CENTIMETRES

Formatting rules for sizes:

* Include the supplied metric dimensions beside every A-series size.
* Include an explicit “in” or “cm” unit with every numerical size.
* Use “×” between dimensions.
* Preserve supplied units; never treat similar metric and imperial sizes as interchangeable.
* Use clear bullet points. The inch sizes may be grouped into readable rows of no more than three sizes.
* If framed and unframed size availability differs in the supplied data, show separate lists and never imply every size is available in both formats.
* Do not add, remove, convert or infer sizes.

Tell the buyer to select an available size and print option from the combinations shown in the listing. Explain that the measurements refer to the paper print and a framed print's overall outside dimensions will be larger.

Mention ORIENTATION only where it reads naturally and adds useful information.

🎨 PAPER, FINISH AND FRAMING 🎨

Write exactly two short paragraphs:

* First paragraph: state that both unframed and framed prints are professionally printed on premium heavyweight paper using PAPER_DETAILS, with a smooth matte finish. Relate verified colours or illustrated details from ANIMAL_DESCRIPTION without claiming the finish is reflection-free or perfect in every lighting condition.
* Second paragraph: state that framed prints use a durable wooden frame with protective, shatter-resistant acrylic glazing, arrive with the artwork already fitted, and include hanging hardware.

Describe oak only as a frame finish. Never claim that an oak-finish frame is made from oak or name any frame wood species.

📦 WHAT YOU WILL RECEIVE 📦

Clearly explain using two bullets tailored with ANIMAL_NAME:

* Unframed option: one physical paper print in the selected size, without a frame.
* Framed option: one physical print supplied already fitted in the selected frame and size.

Then state that decorative props and additional artwork shown in styling photographs are not included. Make clear that this is a physical-product listing. When DIGITAL_DOWNLOAD = Y, also clarify that digital files are not included with the physical purchase.

Do not imply that all displayed sizes, frame options or multiple prints are included.

🛒 HOW TO ORDER 🛒

Explain:

1. Choose the available size.
2. Choose the unframed or framed option and applicable frame finish.
3. When PERSONALISATION_DETAILS is supplied, tell the buyer to enter their wording in the listing's personalisation box and clearly identify the top and bottom text that are enabled.
4. Check the selections, personalisation spelling and delivery address before checkout.

Omit the personalisation step when it is not offered and renumber the steps accordingly.

Do not invent variation names, prices or customisation options.

🚚 DELIVERY AND ORDER HELP 🚚

Use DELIVERY_DETAILS when supplied.

Otherwise direct buyers to the delivery information shown on the listing for the current estimated arrival date and applicable charges.

Do not invent:

* Dispatch deadlines
* Guaranteed arrival dates
* Free delivery
* Tracking
* Worldwide availability
* Courier names
* Packaging formats
* Returns exclusions
* Replacement guarantees

Invite buyers to contact the shop through Etsy if they need help with an order or an item arrives damaged.

💡 GOOD TO KNOW 💡

State concisely that colours may vary slightly between screens and the finished print. Mention size or cropping variation only when confirmed. Do not repeat the framing, paper or contents sections.

Do not include a digital-file licence or prohibit resale of the purchased physical object.

💻 PREFER A DIGITAL DOWNLOAD? 💻

Include this section only when DIGITAL_DOWNLOAD = Y.

Write no more than two short paragraphs. Explain that the same design is available through a separate digital listing for buyers arranging their own printing. If DIGITAL_LISTING_URL is empty, invite buyers to message the shop through Etsy for the link.

State that the digital download is purchased separately and does not include a physical print or frame. Do not include pixel dimensions, ratios, files, DPI or licence details here.

When DIGITAL_DOWNLOAD = N, omit this entire section and heading.

✨ EXPLORE MORE DESIGNS ✨

Write one warm sentence inviting buyers to browse coordinating nursery prints, children's room designs or gallery-wall ideas related to ROOM_THEME.

Then write exactly:

Browse CosyHousePrints:
SHOP_URL

ETSY SEARCH TAGS

Create exactly 13 distinct, relevant search tags unless fewer are genuinely relevant.

Preserve the original stricter limit:

* Each tag must contain fewer than 20 characters, including spaces.
* Output one comma-separated line.
* Do not include duplicate tags.
* Do not include ETSY_TAG.
* Do not include emojis.
* Do not use unsupported colours, styles, materials or personalisation terms.
* Focus on the subject, nursery décor, children’s rooms, framed art, art prints, theme and relevant gifting searches.
* Keep search tags focused on the physical listing even when a separate digital version is advertised.

Do not claim that particular tags have proven high search volume without evidence.

OUTPUT FILES

Create four UTF-8 plain-text files:

LISTING_FILENAME_title.txt
LISTING_FILENAME_desc.txt
LISTING_FILENAME_tags.txt
LISTING_FILENAME_etsy_tag.txt

Replace LISTING_FILENAME with its resolved value.

Contents:

* title.txt: only the finished title.
* desc.txt: only the finished description, including its required emoji headings.
* tags.txt: only the comma-separated search tags on one line.
* etsy_tag.txt: only the resolved capitalised ETSY_TAG on one line.

Do not include output labels such as TITLE:, DESCRIPTION:, TAGS: or ETSY_TAG: inside the files.

The specified emoji headings, plain-text bullets and URLs are allowed in the description.

Do not include emojis in the title, search tags, ETSY_TAG or filenames.

Do not include Markdown links, HTML, code fences, unresolved placeholders, competitor references or research notes in any file.

Create one ZIP named:

LISTING_FILENAME_info.zip

The ZIP must contain exactly the four text files directly at its root, without folders or additional files.

Keep the four original text files available as separate downloads.

VALIDATION

Reopen all four saved text files and check:

* The title meets both length limits.
* Physical prints and framed prints are described accurately.
* The copy says a frame is included with the framed option.
* No supplier names or home-production arrangements appear.
* No unsupported materials, sizes, frame features or delivery promises appear.
* Optional blank values have not created invented details.
* DIGITAL_DOWNLOAD = N produces no digital references.
* DIGITAL_DOWNLOAD = Y produces the short separate-purchase digital section without file specifications.
* The digital version is not represented as automatically included with a physical order.
* Every search tag contains fewer than 20 characters.
* Search tags are distinct and relevant.
* ETSY_TAG matches the section and listing names using the required capitalisation and underscores.
* ETSY_TAG does not appear in the description or search tags.
* All filenames use the resolved LISTING_FILENAME.
* No placeholders, HTML or output labels remain.
* UTF-8 encoding preserves all required emojis and punctuation.
* The title, search tags, ETSY_TAG and filenames contain no emojis.

Check that these headings appear exactly, in order:

✨ ABOUT THIS PRINT ✨
🖼️ PRINT OPTIONS AND SIZES 🖼️
🎨 PAPER, FINISH AND FRAMING 🎨
📦 WHAT YOU WILL RECEIVE 📦
🛒 HOW TO ORDER 🛒
🚚 DELIVERY AND ORDER HELP 🚚
💡 GOOD TO KNOW 💡

If DIGITAL_DOWNLOAD = Y, the next heading must be:

💻 PREFER A DIGITAL DOWNLOAD? 💻

The final heading must be:

✨ EXPLORE MORE DESIGNS ✨

Check that every heading has a blank line before and after it.

Reopen the ZIP and verify:

* Exactly four files.
* All files at the root.
* No directories, duplicates or additional files.
* Its contents match the validated original text files.

Correct any failed checks before delivery.

FINAL RESPONSE

Return five download links only:

1. The title text file.
2. The description text file.
3. The search-tags text file.
4. The ETSY_TAG text file.
5. The ZIP containing all four files.

If file creation or validation fails, explain the actual problem rather than claiming successful delivery.`;

function promptVariable(value: string) {
  return value.trim().replaceAll('\\', '\\\\').replaceAll('"', '\\"');
}

export function buildDetailsGeneratePrompt(values: DetailsGeneratePromptValues) {
  return DETAILS_GENERATE_PROMPT
    .replaceAll('{{SECTION_NAME}}', promptVariable(values.sectionName))
    .replaceAll('{{LISTING_NAME}}', promptVariable(values.listingName))
    .replaceAll('{{ANIMAL}}', promptVariable(values.animal))
    .replaceAll('{{ROOM_THEME}}', promptVariable(values.roomTheme))
    .replaceAll('{{DIGITAL_DOWNLOAD}}', values.digitalDownload ? 'Y' : 'N')
    .replaceAll('{{PAPER_DETAILS}}', promptVariable(values.paperDetails || 'Heavyweight matte art paper, at least 200gsm'))
    .replaceAll('{{PRINT_SIZES}}', promptVariable(values.printSizes))
    .replaceAll('{{FRAME_COLOURS}}', promptVariable(values.frameColours))
    .replaceAll('{{PERSONALISATION_DETAILS}}', promptVariable(values.personalisationDetails))
    .replaceAll('{{DIGITAL_FILES_INCLUDED}}', promptVariable(values.digitalFilesIncluded));
}
