import { UPDATED_BEDROOM_IMAGE_PROMPT } from '@/lib/prompts/bedroom-image-prompt';
import { UPDATED_PLAYROOM_IMAGE_PROMPT } from '@/lib/prompts/playroom-image-prompt';
import { ASPECT_RATIOS_IMAGE_PROMPT } from '@/lib/prompts/aspect-ratios-image-prompt';

const LISTING_IMAGE_PROMPT = `ROOM_THEME = "{{ROOM_THEME}}"

Use the image attached to this prompt as the source artwork.

Generate one inline ChatGPT image only.

Do not create or attach a downloadable file. Do not return a filename, Markdown link, sandbox link, download link, explanation, or other text. Return only the generated image in the chat image viewer.

Create one premium square Etsy listing image showing the attached artwork as an unframed paper print.

SOURCE ARTWORK

Use the attached image as the artwork only.

Preserve it exactly as supplied:

- Do not redraw, alter, recolour, simplify, enhance, or reinterpret it.
- Do not add text to it.
- Do not remove any existing details.
- Preserve its original aspect ratio.
- Do not stretch, distort, or crop it.
- Ensure the complete artwork remains visible.

SCENE

Display the artwork as a realistic, professionally printed, unframed paper print.

Choose the most visually attractive of these settings:

- Lying flat on a pale wooden desk or table
- Gently leaning against a neutral wall
- Clipped into a simple wooden poster hanger
- Resting on a clean nursery shelf
- Styled beside subtle children’s-room décor

The artwork must be the clear focus of the image.

Match the surrounding décor to this theme:

ROOM_THEME: {{ROOM_THEME}}

Use the room theme only to influence the setting, colours, and small decorative props. Do not alter the source artwork to match the theme.

STYLE

- Clean, calm, premium Etsy product photography
- Soft natural daylight
- Neutral colours, pale wood, and warm-white surfaces
- Minimal, carefully arranged composition
- Gentle, realistic shadows
- Clear paper edges
- Realistic paper thickness and texture
- Generous safe margins around the print

Suitable small props may include:

- A children’s book
- A soft toy
- A small ornament
- A coordinating cushion
- A small plant
- Wooden blocks
- Tasteful nursery décor related to ROOM_THEME

Keep props subtle and do not allow them to obscure or compete with the artwork.

IMPORTANT PRODUCT ACCURACY

This Etsy product is a digital download. The scene is only a lifestyle mockup demonstrating how the downloaded artwork could look when printed.

Do not include packaging, delivery materials, postal items, or anything suggesting that a physical print is supplied.

DO NOT INCLUDE

- A picture frame
- People
- Children or children’s faces
- Pets
- Brand names or logos
- Copyrighted characters
- Additional wall art
- Canvas texture
- Screens or digital devices
- Stickers or murals
- Clutter
- Harsh shadows
- Watermarks
- Labels
- Captions
- Fake or unreadable text

OUTPUT

- One square Etsy listing image
- Target dimensions: 3000 × 3000 pixels
- Minimum dimensions: 2000 × 2000 pixels
- sRGB colour profile
- High-quality JPG or PNG appearance
- Keep the artwork centred and within safe margins so Etsy’s cropping does not cut it off
- Return only the generated image`;

export function buildListingImagePrompt(roomTheme: string) {
  return LISTING_IMAGE_PROMPT.replaceAll('{{ROOM_THEME}}', roomTheme.trim());
}

const BEDROOM_IMAGE_PROMPT = `ROOM_THEME = "{{ROOM_THEME}}"
ANIMAL = "{{ANIMAL}}"
FRAME_COLOUR = "{{FRAME_COLOUR}}"

Use the image attached to this prompt as the source artwork.

Generate one inline ChatGPT image only.

Do not create or attach a downloadable file. Do not return a filename, Markdown link, sandbox link, download link, explanation, or other text. Do not use Python, Code Interpreter, Data Analysis, or file generation.

Return only the generated image in the chat image viewer.

Create one photorealistic square Etsy mockup scene for printable children’s wall art.

SOURCE ARTWORK

Use the attached image as the artwork displayed in the mockup.

Preserve the source artwork exactly as supplied:

- Do not redraw, alter, recolour, simplify, enhance, replace, expand, or reinterpret it.
- Do not add anything inside the artwork.
- Do not remove any existing details.
- Preserve its original aspect ratio.
- Do not stretch, distort, or crop it.
- Ensure the complete artwork remains visible.

ROOM STYLE

Create a calm, premium children’s bedroom in a Scandinavian nursery style.

Use the value of \`ROOM_THEME\` as the main visual theme for the room. Let it influence the room colours, decorative accents, props, textures, and overall atmosphere.

The room must be softly but recognisably inspired by \`ROOM_THEME\`. Do not create a plain, generic nursery with no visible connection to the specified theme.

Use:

- Soft natural daylight
- Warm-white or cream walls
- Pale-oak furniture
- Cream or neutral bedding
- Soft natural fabrics
- Muted, nursery-friendly colours
- Two to four subtle decorative accents connected to \`ROOM_THEME\`

Theme accents may appear in the surrounding room as:

- Small decorative objects
- Nursery accessories
- Soft patterned fabrics
- Shelf decorations
- Natural textures
- Subtle wall decals
- Cushions or rugs
- Small toys or ornaments

Keep the room clean, calm, cosy, realistic, premium, and uncluttered.

ANIMAL GUIDANCE

\`ANIMAL\` identifies the animal featured in the source artwork.

Do not allow \`ANIMAL\` to control the whole room design unless \`ROOM_THEME\` explicitly describes an animal-themed room.

You may include one small supporting accent representing \`ANIMAL\`, but only when it fits naturally with \`ROOM_THEME\`.

If an animal accent is included, it must depict the exact animal specified by \`ANIMAL\`.

Do not include any other animal species, animal toys, animal motifs, or animal icons unless they are:

- Explicitly included in \`ROOM_THEME\`
- Explicitly named in \`ANIMAL\`
- Already visible in the attached source artwork

Do not default to a particular animal or add unrelated animal decorations.

ARTWORK PLACEMENT

Place the attached artwork in a simple \`FRAME_COLOUR\` picture frame above the bed.

The frame must be:

- Straight
- Centred
- Realistic
- Elegant
- Clearly coloured according to \`FRAME_COLOUR\`

Make the framed artwork the primary focus of the image.

Display it at a realistic poster size, approximately A3 or A2 scale.

Preserve the artwork’s original aspect ratio. If its proportions do not match the frame, add a clean white mount or border. Never stretch, crop, or distort the artwork to fit.

Do not add any other pictures, posters, or competing wall art.

CAMERA AND LIGHTING

- Straight-on interior photography
- Slightly wide composition without lens distortion
- No extreme perspective
- No fisheye effect
- Soft daylight from a window
- Gentle, natural shadows
- Photorealistic Etsy product photography
- Calm, cosy, clean, premium appearance

PRODUCT ACCURACY

This Etsy product is a digital download.

The framed artwork is only a lifestyle mockup showing how the downloaded artwork could look when printed and framed.

Do not include anything implying that a physical frame, printed poster, or shipped product is supplied.

DO NOT INCLUDE

- People
- Children or children’s faces
- Pets
- Brand names or logos
- Copyrighted characters
- Additional wall art
- Text or labels
- Watermarks
- Messy clutter
- Dark rooms
- Harsh shadows
- Warped frames
- Cropped or distorted artwork
- Overly bright cartoon colours
- Unrelated decorative details
- Packaging
- Parcels
- Postage labels
- Shipping boxes
- Delivery vehicles
- Wrapped prints
- An animal-only room unless explicitly required by \`ROOM_THEME\`
- Sea, space, farm, jungle, safari, woodland, coastal, underwater, or other themed décor unless explicitly required by \`ROOM_THEME\`, \`ANIMAL\`, or the attached source artwork

OUTPUT

- Create one square Etsy listing image.
- Target dimensions: 3000 × 3000 pixels.
- Minimum dimensions: 2000 × 2000 pixels.
- Use an sRGB colour profile.
- Keep the artwork and all important content centred within generous safe margins so Etsy cropping does not cut anything off.
- Return only the generated image in the chat image viewer.`;

function promptVariable(value: string) {
  return value.trim().replaceAll('\\', '\\\\').replaceAll('"', '\\"');
}

export function buildBedroomImagePrompt(roomTheme: string, listingItem: string) {
  return UPDATED_BEDROOM_IMAGE_PROMPT
    .replaceAll('{{ROOM_THEME}}', promptVariable(roomTheme))
    .replaceAll('{{ANIMAL}}', promptVariable(listingItem))
    .replaceAll('{{FRAME_COLOUR}}', 'Natural Oak')
    .replaceAll('{{PRINT_SIZE}}', 'A3');
}

const PLAYROOM_IMAGE_PROMPT = `ROOM_THEME = "{{ROOM_THEME}}"
ANIMAL = "{{ANIMAL}}"
FRAME_COLOUR = "{{FRAME_COLOUR}}"

Use the image attached to this prompt as the source artwork.

Generate one inline ChatGPT image only.

Do not create or attach a downloadable file. Do not return a filename, Markdown link, sandbox link, download link, explanation, or other text. Do not use Python, Code Interpreter, Data Analysis, or file generation.

Return only the generated image in the chat image viewer.

Create one photorealistic square Etsy mockup scene for printable children’s wall art.

SOURCE ARTWORK

Use the attached image as the artwork displayed in the mockup.

Preserve the source artwork exactly as supplied:

* Do not redraw, alter, recolour, simplify, enhance, replace, expand, or reinterpret it.
* Do not add anything inside the artwork.
* Do not remove any existing details.
* Preserve its original aspect ratio.
* Do not stretch, distort, or crop it.
* Ensure the complete artwork remains visible.

Only apply realistic perspective, lighting, shadow, and scale so that the artwork looks naturally placed in the room.

PLAYROOM STYLE

Create a calm, premium children’s playroom in a Scandinavian-inspired style.

Use \`ROOM_THEME\` as the main visual theme for the room. Let it influence the room colours, decorative accents, props, textures, and overall atmosphere.

The room must be softly but recognisably inspired by the exact value of \`ROOM_THEME\`. Do not create a plain, generic playroom with no visible connection to the specified theme.

Use:

* Soft natural daylight
* Warm-white or pale-neutral walls
* Pale-oak or light-wood furniture
* Tidy toy-storage baskets
* Bookshelves
* Cushions or a small rug
* A small table and chair, toy shelf, or reading corner
* Two to four subtle, nursery-friendly accents that directly match \`ROOM_THEME\`

Theme accents may appear in:

* Furniture
* Toy storage
* Bookshelves
* Cushions or rugs
* Wall decals
* Baskets
* Small toys or ornaments
* Natural textures
* Soft patterned fabrics
* Other tasteful playroom accessories

Do not add theme accents inside the attached source artwork.

Keep the theme accents subtle and balanced. The room must remain calm, clean, premium, child-friendly, aspirational, and uncluttered.

ANIMAL GUIDANCE

\`ANIMAL\` identifies the animal featured in the source artwork.

Do not allow \`ANIMAL\` to control the whole room design unless \`ROOM_THEME\` explicitly describes an animal-themed room.

You may include one small supporting accent representing \`ANIMAL\`, but only when it fits naturally with \`ROOM_THEME\`.

If an animal accent is included, it must depict the exact animal specified by \`ANIMAL\`.

If \`ANIMAL\` is empty, do not add an animal accent unless an animal is explicitly required by \`ROOM_THEME\`.

Do not include other animal species, animal toys, animal motifs, or animal icons unless they are:

* Explicitly included in \`ROOM_THEME\`
* Explicitly named in \`ANIMAL\`
* Already visible in the attached source artwork

Do not default to a particular animal.

SPECIAL GUIDANCE FOR WOODLAND BUGS

If \`ROOM_THEME\` is “Woodland bugs”, create a gentle woodland-bug playroom using a balanced mixture of woodland nature and small, non-scary bug details.

Suitable accents include:

* Soft woodland leaves
* Tiny mushrooms
* Acorns
* Woven baskets
* Natural wood textures
* Warm earthy tones
* Muted sage green, cream, beige, tan, and dark-brown accents
* Small ladybird, beetle, butterfly, bee, moth, or dotted bug-trail motifs

Only use two to four of these accents. Do not use every example.

Do not default to ants unless \`ANIMAL\` is “Ant” or \`ROOM_THEME\` explicitly includes ants.

Do not make the room look like an ant-only room unless \`ROOM_THEME\` explicitly requests an ant theme.

ARTWORK PLACEMENT

Place the attached artwork on the wall above the main play area in a simple \`FRAME_COLOUR\` picture frame.

The frame must be:

* Straight
* Centred
* Realistic
* Elegant
* Clearly coloured according to \`FRAME_COLOUR\`

Make the framed artwork the primary focus of the image.

Display it at a realistic poster size, approximately A3 or A2 scale.

The artwork must look like a real framed paper poster, not a mural, sticker, canvas, television, or digital screen.

Preserve the artwork’s original aspect ratio. If its proportions do not match the frame, add a clean white mount or border. Never stretch, crop, or distort the artwork to fit.

Do not add any other pictures, posters, or competing wall art.

ROOM DETAILS

Use pale-oak furniture, soft natural fabrics, warm neutral colours, tidy storage, and gentle playroom décor.

The room styling should support the artwork without distracting from it.

The scene must look suitable for a premium Etsy printable children’s wall-art listing.

CAMERA AND LIGHTING

* Straight-on interior-photography angle
* Slightly wide composition without lens distortion
* No extreme perspective
* No fisheye effect
* Soft daylight entering from one side
* Gentle, realistic shadows
* Photorealistic Etsy product-photography style
* Clean, calm, cosy, premium finish

PRODUCT ACCURACY

This Etsy product is a digital download.

The framed artwork is only a lifestyle mockup showing how the downloaded artwork could look when printed and framed.

Do not include anything implying that a physical frame, printed poster, packaging, or shipped product is supplied.

DO NOT INCLUDE

* People
* Children or children’s faces
* Pets
* Brand names or logos
* Copyrighted characters
* Additional wall art
* Text or labels
* Watermarks
* Messy clutter
* Harsh shadows
* Cartoonish furniture
* Overly bright cartoon colours
* Distorted or cropped artwork
* Warped frames
* Mural-style artwork
* Sticker-style artwork
* Canvas-style artwork
* Screens or digital devices
* Plain generic playroom styling with no visible connection to \`ROOM_THEME\`
* Animal-only room styling unless explicitly required by \`ROOM_THEME\`
* Ants unless required by \`ANIMAL\` or \`ROOM_THEME\`
* Unrelated decorative themes
* Example theme elements that do not match \`ROOM_THEME\`
* Dinosaurs unless required by \`ROOM_THEME\`, \`ANIMAL\`, or the source artwork
* Safari or jungle animals unless required by \`ROOM_THEME\`, \`ANIMAL\`, or the source artwork
* Sea, ocean, beach, coastal, shell, whale, turtle, coral, wave, or underwater elements unless required by \`ROOM_THEME\`, \`ANIMAL\`, or the source artwork
* Space or farm elements unless required by \`ROOM_THEME\`, \`ANIMAL\`, or the source artwork
* Parcels
* Delivery vehicles
* Postage labels
* Shipping boxes
* Packaging
* Wrapped prints

OUTPUT

* Create one square Etsy listing image.
* Target dimensions: 3000 × 3000 pixels.
* Minimum dimensions: 2000 × 2000 pixels.
* Use an sRGB colour profile.
* Keep the artwork and all important content centred within generous safe margins so Etsy cropping does not cut anything off.
* Return only the generated image in the chat image viewer.`;

export function buildPlayroomImagePrompt(roomTheme: string, listingItem: string) {
  return UPDATED_PLAYROOM_IMAGE_PROMPT
    .replaceAll('{{ROOM_THEME}}', promptVariable(roomTheme))
    .replaceAll('{{ANIMAL}}', promptVariable(listingItem))
    .replaceAll('{{FRAME_COLOUR}}', 'Natural Oak')
    .replaceAll('{{PRINT_SIZE}}', 'A3');
}

const PERFECT_GIFT_IMAGE_PROMPT = `ROOM_THEME = "{{ROOM_THEME}}"
ANIMAL = "{{ANIMAL}}"
FRAME_COLOUR = "{{FRAME_COLOUR}}"
PRINT_SIZE = "{{PRINT_SIZE}}"

Use the image attached to this prompt as the source artwork.

Generate one inline ChatGPT image only.

Do not create or attach a downloadable file. Do not return a filename, Markdown link, sandbox link, download link, explanation, or other text. Do not use Python, Code Interpreter, Data Analysis, or file generation.

Return only the generated image in the chat image viewer.

Create one photorealistic square Etsy listing image presenting this printable children’s wall art as a perfect gift.

PRINT SIZE AND PROPORTIONS

\`PRINT_SIZE\` controls the physical paper size of the print displayed in the scene, whether framed or unframed.

Allowed values:

* A3 = 297 mm wide × 420 mm high.
* A2 = 420 mm wide × 594 mm high.

If \`PRINT_SIZE\` is omitted, blank, or invalid, use A3.

Use portrait orientation.

The paper must follow ISO A-series portrait proportions:

* Width-to-height ratio approximately 1:1.414.
* Width approximately 70.7% of height.

These proportions apply to the paper itself, not the outside edges of the frame.

If framed:

* Use a frame sized for the selected paper size.
* The visible paper area must retain A-series portrait proportions.
* The outside dimensions will be slightly larger because of the frame moulding.
* Use slim, consistent-width moulding without an additional decorative mount.

If unframed:

* The complete sheet must have the selected A3 or A2 dimensions and A-series portrait proportions.
* Keep all four paper corners visible.

Show the selected size at a believable physical scale relative to furniture, books, greeting cards, and gift props:

* A3 should appear as a modest-sized print.
* A2 should appear larger and more prominent.
* Do not enlarge an A3 print to resemble an oversized poster.
* Make the artwork prominent through camera framing and composition while maintaining realistic physical scale.

Do not substitute a 2:3, 3:4, 4:5, square, or unusually narrow paper format.

The overall Etsy mockup must remain square. Only the print within the scene uses A3 or A2 portrait proportions.

SOURCE ARTWORK

Use the attached image as the artwork displayed in the mockup.

Preserve the source artwork exactly as supplied:

* Do not redraw, alter, recolour, simplify, enhance, replace, expand, or reinterpret it.
* Do not add anything inside the source artwork.
* Do not remove any existing details.
* Preserve its original aspect ratio.
* Do not stretch, distort, or crop it.
* Ensure the complete artwork remains visible.

If the source artwork does not match A-series paper proportions, fit the entire source image proportionally within the selected A3 or A2 paper area.

Centre it and use plain white padding to fill any remaining space. This padding must sit outside the original source image.

Do not change the paper proportions to match the source image.

Only apply realistic perspective, lighting, shadow, and scale so that the artwork looks naturally placed in the scene. Keep perspective minimal so the paper proportions remain clearly recognisable.

GIFT CONCEPT

Create a warm, premium, gift-focused Etsy lifestyle scene.

The image should help buyers understand that the artwork would make a thoughtful gift for:

* A new baby
* Nursery décor
* A child’s bedroom
* A birthday
* A baby shower
* A christening or naming day
* Grandchildren, nieces, or nephews
* Young animal lovers

Display the artwork as a beautiful framed or unframed print styled alongside tasteful gift elements.

The scene may include:

* A softly wrapped gift box
* Natural ribbon
* A small gift tag
* A greeting card
* Children’s books
* Pale-wood furniture
* Soft natural fabrics
* Nursery or playroom décor
* Calm neutral colours
* Muted colours and subtle details matching \`ROOM_THEME\`

Keep gift tags and greeting cards free of readable text.

Gift props are lifestyle styling only. Do not make the gift box, wrapping, frame, or printed poster appear to be included with the purchase.

The artwork must remain the clear focus. Gift styling should support it without obscuring or competing with it.

ROOM AND BACKGROUND

Use a calm, premium children’s bedroom, nursery, or playroom setting.

Use \`ROOM_THEME\` as the main visual theme for both the room and the gift styling. Let it influence the colours, decorative accents, props, textures, wrapping details, and overall atmosphere.

The scene must be softly but recognisably inspired by the exact value of \`ROOM_THEME\`. Do not create a plain, generic nursery with no visible connection to the specified theme.

Include two to four tasteful details that directly match \`ROOM_THEME\`.

Suitable accents may appear in:

* Shelf décor
* Textiles
* Small props or ornaments
* Natural textures
* Subtle wall decals
* Gift wrapping or ribbon
* Gift tags
* Muted colour choices
* Simple decorative motifs
* Small toys

Do not place any theme accents inside the attached source artwork.

Do not use example decorations unless they genuinely match \`ROOM_THEME\`.

Keep the scene warm, premium, clean, balanced, and uncluttered.

ANIMAL GUIDANCE

\`ANIMAL\` identifies the animal featured in the source artwork.

Do not allow \`ANIMAL\` to control the entire room or gift scene unless \`ROOM_THEME\` explicitly describes an animal-themed room.

You may include one small supporting accent representing \`ANIMAL\`, but only when it fits naturally with \`ROOM_THEME\`.

If an animal accent is included, it must depict the exact animal specified by \`ANIMAL\`.

If \`ANIMAL\` is empty, do not add an animal accent unless one is explicitly required by \`ROOM_THEME\`.

Do not include other animal species, animal toys, motifs, or icons unless they are:

* Explicitly included in \`ROOM_THEME\`
* Explicitly named in \`ANIMAL\`
* Already visible in the attached source artwork

Do not default to a particular animal.

COMPOSITION

Choose the most attractive of these arrangements:

1. Display the framed artwork on a wall above a small gift table, nursery shelf, cot, or dresser.
2. Show the framed artwork leaning gently against a wall beside tasteful wrapped gifts.
3. Show the unframed paper print laid neatly beside a wrapped gift and greeting card.

For every arrangement, use the size specified by \`PRINT_SIZE\`.

If the artwork is framed, use a simple \`FRAME_COLOUR\` picture frame.

The frame must be:

* Straight and rectangular
* Realistic
* Elegant
* Clearly coloured according to \`FRAME_COLOUR\`
* Made with slim, consistent-width moulding
* Fully visible, including all four corners

If the artwork is shown unframed, do not include a frame.

For wall-mounted or leaning artwork, use a front-facing camera angle with minimal perspective.

For a print laid flat, use an overhead or near-overhead view so the A-series paper proportions are clearly visible.

Preserve the source artwork’s original aspect ratio within the selected paper size. Use plain white padding where necessary, as specified above. Never stretch, crop, or distort the artwork.

Do not let gift props, ribbon, text, or other objects overlap the print.

Do not add any other pictures, posters, or competing wall art.

TEXT REQUIREMENT

Include the following text exactly as written, preserving all spelling and capitalisation:

Perfect Gift
for Little Animal Lovers

Nursery - Bedroom - Playroom

Place the text prominently in the lower section of the overall square image, similar to a polished Etsy listing layout.

The text is a listing overlay, not part of the source artwork. Do not place it inside the print or frame.

Text styling:

* Large, elegant main headline
* Smaller supporting line underneath
* Refined serif or similarly nursery-friendly font
* Soft, muted colour complementing \`ROOM_THEME\`
* Centred alignment
* Clear contrast against the background
* Neat spacing
* Balanced, premium appearance
* Generous safe margins

Reserve enough uncluttered space below the displayed artwork for the text.

The text must be crisp, readable, correctly spelled, and intentionally positioned. It must not be warped, distorted, duplicated, incomplete, or randomly placed.

If a decorative separator is used, keep it subtle and minimal.

PRODUCT ACCURACY

This Etsy product is a digital download.

The framed or unframed print and all gift styling are lifestyle mockup examples only.

Do not imply that a physical frame, printed poster, wrapping, gift box, packaging, or shipped item is included.

The image should inspire gift-giving without misleading the buyer.

STYLE

* Photorealistic Etsy product photography
* Warm, cosy, premium, and family-friendly
* Soft natural daylight
* Gentle, realistic shadows
* Neutral Scandinavian-inspired interior
* Soft neutral colours
* Subtle but recognisable \`ROOM_THEME\` accents
* Thoughtful, sentimental, giftable mood
* Clean and uncluttered composition

DO NOT INCLUDE

* People
* Children or children’s faces
* Pets
* Brand names or logos
* Copyrighted characters
* Additional wall art
* Watermarks
* Messy clutter
* Harsh shadows
* Distorted artwork
* Distorted or warped frames
* Incorrect paper proportions
* Unrealistically oversized prints
* Size labels, measurement arrows, or dimension annotations
* Overly bright cartoon colours
* Misspelled, warped, duplicated, or unreadable text
* Additional readable text beyond the required listing text and any text already present in the source artwork
* Unrelated decorative details
* Generic nursery styling with no visible connection to \`ROOM_THEME\`
* Animal-only styling unless explicitly required by \`ROOM_THEME\`
* Animals not required by \`ROOM_THEME\`, \`ANIMAL\`, or the source artwork
* Sea, space, farm, jungle, safari, woodland, coastal, underwater, or other themed décor unless required by \`ROOM_THEME\`, \`ANIMAL\`, or the source artwork
* Parcels
* Postage labels
* Delivery boxes or vehicles
* Shipping boxes
* Commercial packaging
* Wrapped parcels that resemble shipping packages

OUTPUT

* Create one square Etsy listing image.
* Target dimensions: 3000 × 3000 pixels.
* Minimum dimensions: 2000 × 2000 pixels.
* Use an sRGB colour profile.
* The framed or unframed print must have A-series portrait proportions and represent the selected \`PRINT_SIZE\`.
* Keep the artwork, gift styling, and text centred within generous safe margins so Etsy cropping does not cut anything off.
* Return only the generated image in the chat image viewer.`;

export function buildPerfectGiftImagePrompt(roomTheme: string, listingItem: string) {
  return PERFECT_GIFT_IMAGE_PROMPT
    .replaceAll('{{ROOM_THEME}}', promptVariable(roomTheme))
    .replaceAll('{{ANIMAL}}', promptVariable(listingItem))
    .replaceAll('{{FRAME_COLOUR}}', 'Natural Oak')
    .replaceAll('{{PRINT_SIZE}}', 'A3');
}

const FRAMES_IMAGE_PROMPT = `PROMPT – Frame examples

Generate this as an inline ChatGPT image only.

Do not create or attach a downloadable file.

Do not return a filename, markdown link, sandbox link, or “Download …jpg” link.

Do not use Python, Code Interpreter, Data Analysis, or file generation.

Return only the generated image in the chat image viewer.

Create one Etsy listing image showing the artwork in different frame colour options.

Inputs:

- ROOM_THEME: {{ROOM_THEME}}
- ANIMAL: {{ANIMAL}}
- FRAME_COLOURS: {{FRAME_COLOURS}}
- SOURCE_IMAGE_FILE: {{REFERENCE_IMAGE}}

Use the uploaded SOURCE_IMAGE_FILE as the artwork only. Do not redraw, alter, recolour, simplify, or reinterpret it.

Create a clean Etsy mockup image showing the same artwork displayed in four different frame colours.

FRAME OPTIONS TO SHOW:

1. Black frame
2. White frame
3. Dark brown frame
4. Natural wood frame

LAYOUT:

Create a tidy 2x2 grid.
Each frame should contain the exact same uploaded artwork.
Use the same print size, same artwork scale, same border width, and same frame style for every option.
The only difference between the four examples should be the frame colour.

The image should look like a premium Etsy product comparison image.
Use a clean, neutral background such as a warm white wall, pale beige wall, or soft studio-style interior background.
Keep the design minimal and uncluttered.

FRAME STYLE:

Use simple, modern, realistic frames.
Frames should be thin or medium-width, not ornate.
Keep the frames straight, evenly aligned, and realistic.
Use a clean white mount or border if needed.
Preserve the artwork’s original aspect ratio.
Do not stretch or crop the artwork.

TEXT LABELS:

Add simple labels beneath each frame if they can be rendered clearly:
Black
White
Dark Brown
Natural Wood

If text rendering may be inaccurate, leave clean blank space underneath each frame so I can add the labels manually later.

IMPORTANT PRODUCT ACCURACY:

This is a digital download product.
Do not imply that frames are included.
The frame colours are styling examples only.
Do not add pricing, discounts, logos, watermarks, or misleading physical product claims.

STYLE:

Photorealistic Etsy product mockup.
Clean, premium, warm, calm, and professional.
Soft natural lighting.
Gentle realistic shadows.
Neutral Scandinavian-inspired styling.
The artwork should remain the hero of the image.

AVOID:

- people
- children’s faces
- pets
- brand logos
- copyrighted characters
- messy clutter
- extra wall art
- distorted artwork
- warped frames
- harsh shadows
- busy backgrounds
- unreadable text
- watermarks
- making the frame colours inconsistent

OUTPUT:

Create one square Etsy listing image.
Target size: 3000 x 3000 px.
Minimum size: 2000 x 2000 px.
sRGB colour profile.
JPG or PNG format.
Keep all four frame examples centred with safe margins so Etsy cropping does not cut them off.

Filename:

frame_colour_options.jpg`;

export function buildFramesImagePrompt(roomTheme: string, listingItem: string) {
  return FRAMES_IMAGE_PROMPT
    .replaceAll('{{ROOM_THEME}}', promptVariable(roomTheme))
    .replaceAll('{{ANIMAL}}', promptVariable(listingItem))
    .replaceAll('{{FRAME_COLOURS}}', 'Black, White, Dark Brown, Natural Wood')
    .replaceAll('{{REFERENCE_IMAGE}}', 'Copied thumbnail image');
}

const THREE_FRAMES_IMAGE_PROMPT = `PROMPT – Print and Frame Options

Generate this as one inline ChatGPT image only.

Do not create or attach a downloadable file.

Do not return a filename, Markdown link, sandbox link, download link, explanation, or other text.

Do not use Python, Code Interpreter, Data Analysis, or file generation.

Return only the generated image in the chat image viewer.

Create one square Etsy listing image comparing an unframed paper print with the same print displayed in the three frame colours offered by PrintShrimp.

INPUTS

ROOM_THEME = "{{ROOM_THEME}}"
ANIMAL = "{{ANIMAL}}"
FRAME_COLOURS = "{{FRAME_COLOURS}}"
SOURCE_IMAGE_FILE = "{{SOURCE_IMAGE_FILE}}"

SOURCE ARTWORK

Use the uploaded SOURCE_IMAGE_FILE as the artwork in all four examples.

Preserve the source artwork exactly as supplied:

- Do not redraw, alter, recolour, simplify, enhance, replace, expand, or reinterpret it.
- Do not add anything inside the artwork.
- Do not remove any existing details.
- Preserve any existing text exactly, including spelling, punctuation, capitalisation, font appearance, curvature, and placement.
- Preserve the original aspect ratio.
- Do not stretch, distort, or crop the artwork.
- Ensure the complete artwork remains visible in every example.

If the supplied source artwork has transparency:

- Treat transparent areas as empty space rather than as a black background.
- Composite transparent areas onto the clean white paper of each print.
- Do not reproduce a black attachment-preview background inside the print.
- Do not add a black, dark or coloured rectangle behind the artwork.
- Preserve every visible non-transparent part of the source artwork exactly.

FOUR PRODUCT OPTIONS

Show exactly these four options:

1. Unframed Print
2. Black Frame
3. White Frame
4. Natural Wood Frame

Do not include a dark-brown frame or any additional frame colours.

LAYOUT

Create a clean and evenly balanced 2 × 2 comparison grid:

- Top left: Unframed Print
- Top right: Black Frame
- Bottom left: White Frame
- Bottom right: Natural Wood Frame

Use four equal-sized grid areas with consistent spacing.

Each option must:

- Display the exact same uploaded artwork.
- Use the same portrait orientation.
- Show the same physical print size.
- Use the same visible artwork scale.
- Preserve the same artwork proportions.
- Show the complete artwork.
- Be centred within its grid area.
- Be photographed from the same straight-on angle.
- Receive the same lighting and shadow treatment.

The visible paper area must be identical in size across all four examples.

The framed examples will be slightly larger overall because the frames surround the same-sized paper print.

Do not reduce the visible print size inside the frames to make the outside frame dimensions match the unframed example.

UNFRAMED PRINT

Show the first option as a professionally printed, unframed paper print.

The unframed print must:

- Have clearly visible paper edges.
- Have realistic portrait proportions.
- Appear flat and straight.
- Have a subtle natural paper texture.
- Cast a soft, narrow contact shadow.
- Contain no frame.
- Contain no mount or mat board.
- Contain no glass.
- Contain no poster hanger.
- Contain no clips, tape, pins, or visible fixings.
- Not curl, bend, fold, warp, or appear damaged.
- Not appear as a canvas or mounted board.

Present it as a clean paper print placed flat against the neutral background for comparison purposes.

FRAMED OPTIONS

Show the remaining three examples using the same simple, modern frame design.

Only the frame colour or finish may change:

- Black: smooth matte-black finish.
- White: smooth matte-white finish.
- Natural Wood: pale natural-wood finish with subtle realistic grain.

All three frames must have:

- Identical dimensions.
- Identical moulding width.
- Identical moulding profile.
- Identical depth.
- Identical corner joints.
- The same visible print size.
- The same artwork placement.
- The same white border or mount treatment.
- The same glass appearance.
- The same camera angle.
- The same lighting.
- The same soft, narrow contact-shadow treatment.

Use thin or medium-width contemporary frames.

The white frame must remain clearly visible against the background through realistic edges and a soft contact shadow. Do not darken or recolour the white frame merely to improve contrast.

Do not use ornate, distressed, metallic, glossy, brightly coloured, dark-brown, reddish-brown, or decorative frames.

MOUNT AND BORDER

If a white mount or border is needed, use exactly the same border width in all three framed examples.

Do not add a mount to the unframed print unless that white border is already part of the supplied source artwork.

Never crop, stretch, enlarge, or distort the artwork to fit a frame.

BACKGROUND

Use one consistent, plain, pale warm-greige background across the complete 2 × 2 grid.

Use a colour approximately equivalent to \`#DED9D0\`: light enough to complement the black frame, but sufficiently darker than pure white to define the white frame clearly.

The background must:

- Provide clear visual separation around the unframed white paper and white frame.
- Complement the pale natural-wood frame without matching or blending into it.
- Remain lighter and visually quieter than the black frame.
- Have a subtle matte painted-wall or studio-surface texture.
- Use exactly the same colour, brightness and texture across all four grid areas.
- Remain neutral and must not be influenced by ROOM_THEME.
- Contain no colour gradient, vignette, panel divisions or differently coloured grid areas.

Ensure every product has a soft, narrow contact shadow so that the white paper, white frame and pale natural-wood frame remain clearly defined against the background.

Do not use:

- Pure white
- Cream or yellow-toned beige
- A background close to the natural-wood colour
- Dark grey
- Green
- Blue
- Strongly coloured walls
- Different background colours behind different options
- Patterned wallpaper
- Wall decals
- Murals
- Furniture
- Shelves
- Plants
- Toys
- Additional pictures
- Decorative room scenes
- An underwater setting

Keep the background plain, neutral, consistent and visually secondary to the four product options.

ROOM THEME

ROOM_THEME must not change the background colour.

ROOM_THEME may influence only one or two extremely subtle styling details if they are genuinely necessary.

Do not add themed props, decorations, sea-creature ornaments, shells, waves, toys or underwater elements. The artwork itself already conveys the specified room theme.

TEXT LABELS

If accurate text can be rendered, place one simple label beneath each corresponding option:

- Unframed Print
- Black Frame
- White Frame
- Natural Wood Frame

The labels must:

- Use identical font, size, weight, and colour.
- Use a muted dark-grey colour that is clearly readable against the warm-greige background.
- Be horizontally centred beneath the correct option.
- Be spelled exactly as supplied.
- Be clear and easy to read.
- Remain outside the artwork and frames.
- Not overlap any product example or shadow.

Do not abbreviate, reword, misspell, duplicate, or swap the labels.

If accurate text rendering cannot be guaranteed, do not generate substitute or approximate text. Instead, leave equal clean blank space beneath all four options so the labels can be added manually later.

PRODUCT ACCURACY

This comparison shows four different product presentation options:

- One unframed paper print.
- One print in a black frame.
- One print in a white frame.
- One print in a natural-wood frame.

Do not imply that every order includes a frame.

A frame is supplied only when the customer selects a framed product option.

Do not add:

- Prices
- Discounts
- Sale badges
- Delivery claims
- Digital-download badges
- Promotional banners
- Logos
- Watermarks
- Packaging
- Misleading product claims

STYLE

- Photorealistic Etsy product-comparison image.
- Clean, premium, warm, calm, and professional.
- Neutral Scandinavian-inspired presentation.
- Soft, even natural lighting.
- Gentle, realistic shadows.
- Soft, narrow contact shadows around every product.
- Minimal glass reflections.
- Consistent colour balance across all four examples.
- The artwork must remain the main visual focus.
- The black, white and natural-wood frame finishes must all remain clearly distinguishable.

AVOID

- People
- Children or children’s faces
- Pets
- Brand names or logos
- Copyrighted characters
- Additional artwork
- Extra product options
- More than three frames
- Dark-brown frames
- Inconsistent frame styles
- Inconsistent frame thicknesses
- Inconsistent print sizes
- Different artwork scales
- Cropped artwork
- Distorted artwork
- Redrawn artwork
- Black backgrounds caused by source transparency
- Warped frames
- Curled or folded paper
- Canvas prints
- Poster hangers
- Clips or visible fixings
- Messy clutter
- Busy backgrounds
- Harsh shadows
- Strong reflections
- Unreadable or incorrect text
- Watermarks

OUTPUT

- Create one square Etsy listing image.
- Target dimensions: 3000 × 3000 pixels.
- Minimum dimensions: 2000 × 2000 pixels.
- Use an sRGB colour profile.
- Use a clean 2 × 2 grid.
- Show exactly one unframed print and exactly three framed prints.
- Keep all four examples centred within generous safe margins.
- Ensure Etsy cropping does not cut off any print, frame, label, or shadow.
- Keep the uploaded artwork clear and recognisable at Etsy thumbnail size.
- Ensure the pale warm-greige background clearly separates the unframed white paper, white frame, black frame and natural-wood frame.
- Return only the generated image in the chat image viewer.`;

export function buildThreeFramesImagePrompt(roomTheme: string, listingItem: string) {
  return THREE_FRAMES_IMAGE_PROMPT
    .replaceAll('{{ROOM_THEME}}', promptVariable(roomTheme))
    .replaceAll('{{ANIMAL}}', promptVariable(listingItem))
    .replaceAll('{{FRAME_COLOURS}}', 'Black, White, Natural Wood')
    .replaceAll('{{SOURCE_IMAGE_FILE}}', 'Copied thumbnail image');
}

const SIZES_IMAGE_PROMPT = `ROOM_THEME = "{{ROOM_THEME}}"
ANIMAL = "{{ANIMAL}}"
FRAME_COLOUR = "{{FRAME_COLOUR}}"

Use the image attached to this prompt as the source artwork.

Generate one inline ChatGPT image only.

Do not create or attach a downloadable file. Do not return a filename, Markdown link, sandbox link, download link, explanation, or other text. Do not use Python, Code Interpreter, Data Analysis, or file generation.

Return only the generated image in the chat image viewer.

Create one photorealistic square Etsy listing image showing an accurate print-sizing guide for printable children’s wall art.

SOURCE ARTWORK

Use the attached image as the artwork displayed in every size example.

Preserve the source artwork exactly as supplied:

* Do not redraw, alter, recolour, simplify, enhance, replace, expand, or reinterpret it.
* Do not add anything inside the artwork.
* Do not remove any existing details.
* Preserve its original aspect ratio.
* Do not stretch, distort, or crop it.
* Ensure the complete artwork remains visible.
* Display exactly the same artwork in all five size examples.

Only apply realistic perspective, lighting, shadow, and scale so the artwork looks naturally mounted in the room.

PURPOSE

Show the same artwork displayed on one wall in these five ISO print sizes:

* A5: 148 × 210 mm
* A4: 210 × 297 mm
* A3: 297 × 420 mm
* A2: 420 × 594 mm
* A1: 594 × 841 mm

The image must help buyers understand the genuine difference between the five print sizes and how large each would look in a real room.

ROOM STYLE

Create a calm, realistic children’s bedroom, nursery, or playroom.

Use \`ROOM_THEME\` as the main visual theme. Let it influence the room colours, decorative accents, props, textures, furniture styling, and overall atmosphere.

The room must be softly but recognisably inspired by the exact value of \`ROOM_THEME\`. Do not create a plain, generic nursery with no visible connection to the specified theme.

Include two to four subtle, tasteful details that directly match \`ROOM_THEME\`.

Theme accents may appear in:

* Furniture
* Textiles
* Shelf décor
* Wall colour
* Rugs
* Storage baskets
* Small props or ornaments
* Natural textures
* Subtle wall decals
* Nursery or playroom accessories

Do not place theme accents inside the attached source artwork.

Do not use example theme elements unless they genuinely match \`ROOM_THEME\`.

Keep the room premium, warm, clean, realistic, and uncluttered. The room styling should support the size comparison without distracting from it.

ANIMAL GUIDANCE

\`ANIMAL\` identifies the animal featured in the source artwork.

Do not allow \`ANIMAL\` to control the entire room unless \`ROOM_THEME\` explicitly describes an animal-themed room.

You may include one small supporting accent representing \`ANIMAL\`, but only if it fits naturally with \`ROOM_THEME\`.

If an animal accent is included, it must depict the exact animal specified by \`ANIMAL\`.

If \`ANIMAL\` is empty, do not add an animal accent unless one is explicitly required by \`ROOM_THEME\`.

Do not include other animal species, animal toys, motifs, or icons unless they are:

* Explicitly included in \`ROOM_THEME\`
* Explicitly named in \`ANIMAL\`
* Already visible in the attached source artwork

Do not default to a particular animal.

WALL AND FURNITURE

Use a large, plain wall with enough clear space to display all five sizes accurately.

Arrange the prints in a single left-to-right row:

A5, A4, A3, A2, A1

Place the bottom edge of every frame on the same horizontal baseline so buyers can compare their heights easily.

Include one or two familiar pieces of children’s furniture below or near the prints to provide realistic scale, such as:

* A cot
* A child’s bed
* A low chest of drawers
* A reading chair
* A toy shelf
* A small table and chair
* Storage baskets

Keep the furniture realistically proportioned. Do not allow it to obscure the prints or their labels.

SIZE ACCURACY

The five print sizes must follow the true ISO A-series proportions and relative scale.

All five sizes have the same aspect ratio. Moving from one size to the next increases each linear dimension by approximately √2, or 1.414:

* A4 must be approximately 1.414 times the width and height of A5.
* A3 must be approximately 1.414 times the width and height of A4.
* A2 must be approximately 1.414 times the width and height of A3.
* A1 must be approximately 1.414 times the width and height of A2.

Each successive size has twice the area of the previous size.

Relative to A5:

* A5: width and height scale 1.0
* A4: width and height scale 1.414
* A3: width and height scale 2.0
* A2: width and height scale 2.828
* A1: width and height scale 4.0

A1 must therefore be four times the width and four times the height of A5—not merely slightly larger.

Make A5 visibly small compared with the furniture, while A1 should look like a substantial wall print.

Do not invent arbitrary size differences. Do not make the five prints almost the same size.

Keep all versions portrait-oriented unless the attached source artwork is landscape. If it is landscape, display all five sizes in landscape orientation while preserving the same accurate relative scaling.

FRAMING

Display all five prints in identical, simple \`FRAME_COLOUR\` picture frames.

Every frame must have:

* The same style
* The same proportional frame width
* The same finish
* The same mount or border treatment
* The exact colour specified by \`FRAME_COLOUR\`

Frames must be thin, modern, realistic, straight, and consistently aligned.

Preserve the artwork’s original aspect ratio. If it does not perfectly match the ISO paper ratio, use an identical clean white mount or border for every size.

Never stretch, crop, or distort the artwork.

Do not add any other pictures, posters, or competing wall art.

TEXT LABELS

Add one clear label directly beneath or above each corresponding print.

Render these labels exactly:

A5

A4

A3

A2

A1

Use:

* A simple modern font
* Consistent font size
* Dark neutral text
* Clear contrast
* Centred alignment
* Equal spacing
* A direct visual connection between each label and its print

Do not add measurements or any other text.

The labels must not be misspelled, duplicated, distorted, misplaced, or assigned to the wrong sizes.

If accurate text rendering cannot be guaranteed, omit all five labels and leave equal, clean blank spaces for them to be added manually. Do not include partial or inaccurate labels.

CAMERA AND LIGHTING

* Straight-on interior-photography angle
* Camera positioned centrally in front of the wall
* No extreme perspective
* No angled wall that changes the apparent sizes
* No fisheye effect
* No lens distortion
* Soft natural daylight
* Gentle, realistic shadows
* Clear view of every print and label
* Photorealistic Etsy product-photography style

PRODUCT ACCURACY

This Etsy product is a digital download.

The framed prints are sizing mockup examples only. Physical frames and printed posters are not included.

Do not include anything implying that a physical product is supplied or shipped.

DO NOT INCLUDE

* People
* Children or children’s faces
* Pets
* Brand names or logos
* Copyrighted characters
* Additional wall art
* Messy clutter
* Dark rooms
* Harsh shadows
* Cartoon-style furniture
* Overly bright cartoon colours
* Warped or mismatched frames
* Cropped, altered, or distorted artwork
* Inaccurate print proportions
* Unrealistic size differences
* Prints that appear nearly the same size
* Incorrectly ordered sizes
* Misspelled or unreadable labels
* Watermarks
* Unrelated decorative themes
* Generic room styling with no connection to \`ROOM_THEME\`
* Animal-only styling unless explicitly required by \`ROOM_THEME\`
* Animals not required by \`ROOM_THEME\`, \`ANIMAL\`, or the source artwork
* Parcels
* Delivery vehicles
* Postage labels
* Shipping boxes
* Packaging
* Wrapped prints
* Anything suggesting a physical product is included

OUTPUT

* Create one square Etsy listing image.
* Target dimensions: 3000 × 3000 pixels.
* Minimum dimensions: 2000 × 2000 pixels.
* Use an sRGB colour profile.
* Keep all five prints, furniture, and label areas centred within generous safe margins.
* Ensure Etsy cropping cannot cut off any print or label.
* Return only the generated image in the chat image viewer.`;

export function buildSizesImagePrompt(roomTheme: string, listingItem: string) {
  return SIZES_IMAGE_PROMPT
    .replaceAll('{{ROOM_THEME}}', promptVariable(roomTheme))
    .replaceAll('{{ANIMAL}}', promptVariable(listingItem))
    .replaceAll('{{FRAME_COLOUR}}', 'Natural Oak');
}

export function buildAspectRatiosImagePrompt() {
  return ASPECT_RATIOS_IMAGE_PROMPT;
}

const NO_FRAME_INCLUDED_IMAGE_PROMPT = `ROOM_THEME = "{{ROOM_THEME}}"
ANIMAL = "{{ANIMAL}}"
FRAME_COLOURS = {{FRAME_COLOURS}}

Use the image attached to this prompt as the source artwork.

Generate one inline ChatGPT image only.

Do not create or attach a downloadable file. Do not return a filename, Markdown link, sandbox link, download link, explanation, or other text. Do not use Python, Code Interpreter, Data Analysis, or file generation.

Return only the generated image in the chat image viewer.

Create one premium square Etsy information image clearly explaining that no frame or physical product is included with this digital download.

SOURCE ARTWORK

Use the attached image as a small artwork preview within the information graphic.

Preserve the source artwork exactly as supplied:

* Do not redraw, alter, recolour, simplify, enhance, replace, expand, or reinterpret it.
* Do not add anything inside the artwork.
* Do not remove any existing details.
* Preserve its original aspect ratio.
* Do not stretch, distort, or crop it.
* Ensure the complete artwork remains visible.

The artwork preview must support the information message without overpowering the text.

MAIN MESSAGE

Make it immediately clear that:

* The buyer receives digital files only.
* No physical print is included.
* No frame or mount is included.
* No packaging or shipped item is included.
* Any frame shown is only a styling example.

TEXT REQUIREMENT

Include the following wording exactly, preserving its spelling and capitalisation:

No Frame Included

Digital download only

Frame shown for styling inspiration

No physical item will be shipped

Text hierarchy:

* Make “No Frame Included” the largest and most prominent headline.
* Place “Digital download only” directly beneath it as a clear secondary message.
* Display the remaining two statements in a smaller but still easily readable size.
* Keep all text centred, balanced, and within generous safe margins.

Use a clean, modern, nursery-friendly font with strong contrast against the background.

The text must be crisp, correctly spelled, undistorted, complete, and easy to read. Do not abbreviate, paraphrase, duplicate, or alter any wording.

STYLE

Create a clean, calm, premium Etsy-style information graphic.

Use \`ROOM_THEME\` as the visual theme for the design. Let it influence the colours, decorative accents, background details, icons, textures, and nursery-style atmosphere.

The design must be softly but recognisably connected to the exact value of \`ROOM_THEME\`. Do not create a completely generic information graphic with no visible connection to the specified theme.

Use:

* Soft neutral colours
* Plenty of clean space
* A warm and trustworthy appearance
* A clear information hierarchy
* Subtle nursery-friendly styling
* Two to four tasteful accents directly related to \`ROOM_THEME\`

Theme accents may appear only in:

* The background
* Borders or corners
* Small icons
* Decorative motifs
* Natural textures
* Subtle patterns
* Muted colour choices
* Other small layout details

Do not place theme accents inside the attached source artwork.

Do not use example decorations unless they genuinely match \`ROOM_THEME\`.

Keep all decorative accents subtle. They must support the information without distracting from the text.

ANIMAL GUIDANCE

\`ANIMAL\` identifies the animal featured in the source artwork.

Do not allow \`ANIMAL\` to control the whole design unless \`ROOM_THEME\` explicitly describes an animal-themed design.

You may include one small supporting accent representing \`ANIMAL\`, but only if it fits naturally with \`ROOM_THEME\`.

If an animal accent is included, it must depict the exact animal specified by \`ANIMAL\`.

If \`ANIMAL\` is empty, do not add an animal accent unless one is explicitly required by \`ROOM_THEME\`.

Do not include other animal species, animal toys, motifs, or icons unless they are:

* Explicitly included in \`ROOM_THEME\`
* Explicitly named in \`ANIMAL\`
* Already visible in the attached source artwork

Do not default to a particular animal.

LAYOUT

Use a simple, premium information-card layout.

The text must remain the main focus.

Show the attached artwork as one small preview in a simple frame to demonstrate styling only.

Use one of the colours specified in \`FRAME_COLOURS\` for the preview frame.

Optionally show small frame-colour samples using the colours in \`FRAME_COLOURS\`, but do not add extra labels unless they can be rendered accurately.

Make the frame demonstration clearly secondary to the “No Frame Included” message.

If helpful, include simple, universally recognisable icons for:

* Digital download
* No shipping
* Frame not included
* Print at home

Keep icons small, consistent, and easy to understand. Do not include fake words, letters, or unreadable markings inside icons.

Do not use realistic parcels, shipping boxes, postage labels, or delivery imagery—even when crossed out.

PRODUCT ACCURACY

This product is a digital download only.

The buyer does not receive:

* A printed poster
* A picture frame
* A mount
* Gift wrapping
* Packaging
* A parcel
* Any other physical item

Any framed artwork displayed is only a styling example showing how the downloaded artwork could look after the buyer prints and frames it themselves.

The finished image must reassure buyers without suggesting that anything physical will arrive.

DO NOT INCLUDE

* People
* Children or children’s faces
* Pets
* Brand names or logos
* Copyrighted characters
* Fake Etsy branding
* Watermarks
* Clutter
* Hard-to-read text
* Misspelled or incomplete text
* Warped, distorted, or duplicated lettering
* Altered, cropped, or distorted artwork
* Large decorative elements that compete with the message
* Misleading physical-product imagery
* Unrelated decorative themes
* Generic styling with no connection to \`ROOM_THEME\`
* Animal-only styling unless required by \`ROOM_THEME\`
* Animals not required by \`ROOM_THEME\`, \`ANIMAL\`, or the source artwork
* Commercial packaging
* Parcels
* Postage labels
* Delivery boxes or vehicles
* Shipping boxes
* Wrapped prints
* Anything suggesting shipping or that a physical item is supplied

OUTPUT

* Create one square Etsy listing image.
* Target dimensions: 3000 × 3000 pixels.
* Minimum dimensions: 2000 × 2000 pixels.
* Use an sRGB colour profile.
* Keep all text, icons, frame samples, and the artwork preview centred within generous safe margins.
* Ensure Etsy cropping cannot cut off any text or important content.
* Return only the generated image in the chat image viewer.`;

export function buildNoFrameIncludedImagePrompt(roomTheme: string, listingItem: string) {
  return NO_FRAME_INCLUDED_IMAGE_PROMPT
    .replaceAll('{{ROOM_THEME}}', promptVariable(roomTheme))
    .replaceAll('{{ANIMAL}}', promptVariable(listingItem))
    .replaceAll('{{FRAME_COLOURS}}', '["Black", "White", "Dark Brown", "Natural Wood"]');
}

const DIGITAL_DOWNLOAD_INCLUDED_IMAGE_PROMPT = `ROOM_THEME = "{{ROOM_THEME}}"
ANIMAL = "{{ANIMAL}}"
FILES_INCLUDED = "{{FILES_INCLUDED}}"

Use the image attached to this prompt as the source artwork.

Generate one inline ChatGPT image only.

Do not create or attach a downloadable file. Do not return a filename, Markdown link, sandbox link, download link, explanation, or other text. Do not use Python, Code Interpreter, Data Analysis, or file generation.

Return only the generated image in the chat image viewer.

Create one premium square Etsy information image clearly explaining that this children’s wall-art product is a digital download.

SOURCE ARTWORK

Use the attached image as a small artwork preview within the information graphic.

Preserve the source artwork exactly as supplied:

* Do not redraw, alter, recolour, simplify, enhance, replace, expand, or reinterpret it.
* Do not add anything inside the artwork.
* Do not remove any existing details.
* Preserve its original aspect ratio.
* Do not stretch, distort, or crop it.
* Ensure the complete artwork remains visible.

The artwork preview must support the information message without overpowering the text.

MAIN MESSAGE

Make it immediately clear that:

* The buyer receives digital files.
* No physical item will be shipped.
* A frame is not included.
* The files can be printed at home, locally, or online.

TEXT REQUIREMENT

Include the following wording exactly, preserving all spelling and capitalisation:

Digital Download

No physical item shipped

Frame not included

Print at home, at a local print shop, or with an online printing service

Files included:

FILES_INCLUDED

Instant access after purchase

Replace \`FILES_INCLUDED\` with its exact value from the variable at the top. Do not display the word \`FILES_INCLUDED\` itself.

Text hierarchy:

* Make “Digital Download” the largest and most prominent headline.
* Display “No physical item shipped” and “Frame not included” as clear secondary messages.
* Place the printing-options sentence beneath them in a smaller but readable size.
* Display “Files included:” followed by the exact \`FILES_INCLUDED\` value.
* Use “Instant access after purchase” as a small footer.
* Keep all wording centred and within generous safe margins.

The text must be crisp, complete, correctly spelled, and easy to read. Do not paraphrase, abbreviate, duplicate, distort, or omit any wording.

STYLE

Create a clean, calm, premium Etsy-style information graphic suitable for printable children’s wall art.

Use \`ROOM_THEME\` as the visual theme. Let it influence the colours, decorative accents, background details, icons, textures, and overall nursery-style atmosphere.

The design must be softly but recognisably connected to the exact value of \`ROOM_THEME\`. Do not create a completely generic information graphic with no visible theme connection.

Use:

* A warm-white, cream, beige, or softly muted background
* Soft neutral colours
* Plenty of clean space
* A simple, trustworthy layout
* Modern, easy-to-read fonts
* Two to four tasteful accents directly related to \`ROOM_THEME\`

Theme accents may appear only in:

* The background
* Borders or corners
* Small icons
* Decorative motifs
* Natural textures
* Subtle patterns
* Muted colour choices
* Other small layout details

Do not place theme accents inside the attached source artwork.

Do not use decorative examples unless they genuinely match \`ROOM_THEME\`.

Keep the design warm, friendly, professional, premium, balanced, and uncluttered.

ANIMAL GUIDANCE

\`ANIMAL\` identifies the animal featured in the source artwork.

Do not allow \`ANIMAL\` to control the entire design unless \`ROOM_THEME\` explicitly describes an animal-themed design.

You may include one small supporting accent representing \`ANIMAL\`, but only if it fits naturally with \`ROOM_THEME\`.

If an animal accent is included, it must depict the exact animal specified by \`ANIMAL\`.

If \`ANIMAL\` is empty, do not add an animal accent unless one is explicitly required by \`ROOM_THEME\`.

Do not include other animal species, animal toys, motifs, or icons unless they are:

* Explicitly included in \`ROOM_THEME\`
* Explicitly named in \`ANIMAL\`
* Already visible in the attached source artwork

Do not default to a particular animal.

LAYOUT

Create a clean square information-card layout.

Include:

* One small preview of the attached artwork as an unframed paper print
* A clear “Digital Download” headline
* Short, well-spaced information sections
* Minimal, consistent icons
* Plenty of white space
* Subtle accents inspired by \`ROOM_THEME\`

Use simple visual cues for:

* Digital download
* Printing at home
* A local print shop
* An online printing service

Suitable icons include:

* A computer or tablet
* A download arrow
* A printer
* A sheet of paper
* A home
* A simple storefront or web-printing symbol

Icons must be minimal, elegant, consistent, and secondary to the written information.

Do not include fake buttons, fake links, brand logos, or unreadable words inside icons.

Do not show multiple frame examples. If a single frame appears as part of a small lifestyle preview, it must remain secondary and clearly function only as styling inspiration.

PRODUCT ACCURACY

This is a digital download product.

The buyer receives the digital files described by \`FILES_INCLUDED\`.

The buyer does not receive:

* A physical print
* A picture frame
* A mount
* Gift wrapping
* Packaging
* A parcel
* Any other physical item

The artwork preview is only an example of how the downloaded artwork may look after the buyer prints it.

Do not show shipping or delivery imagery, even with a crossed-out symbol.

DO NOT INCLUDE

* People
* Children or children’s faces
* Pets
* Brand names or logos
* Copyrighted characters
* Fake Etsy branding
* Fake buttons or links
* Watermarks
* Clutter
* Crowded layouts
* Hard-to-read fonts
* Misspelled, incomplete, warped, or duplicated text
* Altered, cropped, or distorted artwork
* Large decorations that compete with the information
* Bright, harsh, or overly cartoonish colours
* Unrelated decorative themes
* Generic styling with no connection to \`ROOM_THEME\`
* Animal-only styling unless required by \`ROOM_THEME\`
* Animals not required by \`ROOM_THEME\`, \`ANIMAL\`, or the source artwork
* Parcels
* Packaging
* Postage labels
* Shipping boxes
* Delivery vehicles
* Wrapped prints
* Anything suggesting that a physical item will be supplied

OUTPUT

* Create one square Etsy listing image.
* Target dimensions: 3000 × 3000 pixels.
* Minimum dimensions: 2000 × 2000 pixels.
* Use an sRGB colour profile.
* Keep all text, icons, and the artwork preview centred within generous safe margins.
* Ensure Etsy cropping cannot cut off any text or important content.
* Return only the generated image in the chat image viewer.`;

export function buildDigitalDownloadIncludedImagePrompt(roomTheme: string, listingItem: string) {
  return DIGITAL_DOWNLOAD_INCLUDED_IMAGE_PROMPT
    .replaceAll('{{ROOM_THEME}}', promptVariable(roomTheme))
    .replaceAll('{{ANIMAL}}', promptVariable(listingItem))
    .replaceAll('{{FILES_INCLUDED}}', '5 high-resolution JPG files in multiple print ratios');
}

const HOW_TO_PRINT_INCLUDED_IMAGE_PROMPT = `ROOM_THEME = "{{ROOM_THEME}}"
ANIMAL = "{{ANIMAL}}"
FILES_INCLUDED = "{{FILES_INCLUDED}}"
RECOMMENDED_PAPER = "{{RECOMMENDED_PAPER}}"

Use the image attached to this prompt as the source artwork.

Generate one inline ChatGPT image only.

Do not create or attach a downloadable file. Do not return a filename, Markdown link, sandbox link, download link, explanation, or other text. Do not use Python, Code Interpreter, Data Analysis, or file generation.

Return only the generated image in the chat image viewer.

Create one premium square Etsy information image explaining how buyers can print this digital-download wall art.

SOURCE ARTWORK

Use the attached image as a small artwork preview within the information graphic.

Preserve the source artwork exactly as supplied:

* Do not redraw, alter, recolour, simplify, enhance, replace, expand, or reinterpret it.
* Do not add anything inside the artwork.
* Do not remove any existing details.
* Preserve its original aspect ratio.
* Do not stretch, distort, or crop it.
* Ensure the complete artwork remains visible.

The artwork preview must support the instructions without overpowering the text.

MAIN PURPOSE

Make the printing process appear simple, convenient, and reassuring.

Clearly explain that the buyer:

1. Downloads the digital files after purchase.
2. Prints them at home, at a local print shop, or through an online printing service.
3. Frames and displays the finished print themselves.

LAYOUT

Create a clean square information graphic with three clearly separated and numbered steps.

Use this structure:

Step 1: Download
Step 2: Print
Step 3: Frame and display

Arrange the three steps in a clear left-to-right or top-to-bottom sequence.

Include:

* A prominent “How to Print” heading
* Three numbered instruction sections
* Minimal, consistent icons
* One small preview of the attached artwork as a paper print or framed mockup
* Plenty of clean space
* Subtle decorative accents inspired by \`ROOM_THEME\`

Use simple visual cues for:

* Downloading files
* A home printer
* A local print shop
* An online printing service
* Framing and displaying the finished artwork

Suitable icons include:

* A computer or tablet with a download arrow
* A printer and sheet of paper
* A simple storefront
* A browser or online-printing symbol
* A picture frame or wall-display symbol

Icons must be minimal, elegant, consistent, and secondary to the written instructions. Do not place fake words, buttons, branding, or unreadable markings inside them.

TEXT REQUIREMENT

Include the following wording exactly, preserving all spelling, punctuation, and capitalisation:

How to Print

1. Download your files after purchase

2. Print at home, at a local print shop, or with an online printing service

3. Frame and enjoy in your nursery, bedroom, or playroom

Recommended paper:

RECOMMENDED_PAPER

Sizes included:

FILES_INCLUDED

Digital download only — no physical item shipped

Replace \`RECOMMENDED_PAPER\` and \`FILES_INCLUDED\` with their exact values from the variables at the top. Do not display the variable names themselves.

Using the example values above, the finished text should include:

Recommended paper:

Heavyweight matte photo paper, approximately 200–250 gsm

Sizes included:

A5, A4, A3, A2 and A1

TEXT RULES

* Make “How to Print” the largest heading.
* Make each step number and short title visually prominent.
* Keep the longer instructions slightly smaller but easily readable.
* Use a simple, modern font.
* Do not use decorative or hard-to-read fonts.
* Use clear contrast between the text and background.
* Keep text neatly aligned and evenly spaced.
* Do not overcrowd the design.
* Do not paraphrase or alter the required wording.
* Do not misspell, duplicate, omit, warp, or distort any text.
* Keep all wording within generous safe margins.

If accurate text rendering cannot be guaranteed, omit the instructional wording and leave clearly structured blank text areas for it to be added manually. Do not include partial, incorrect, or unreadable text.

VISUAL STYLE

Create a warm, premium, child-friendly Etsy information graphic.

Use:

* A warm-white, cream, beige, or softly muted background
* Plenty of white space
* Soft neutral colours
* A clean and trustworthy layout
* Modern, easy-to-read typography
* Minimal and consistent icons
* Two to four subtle decorative accents directly connected to \`ROOM_THEME\`

The design should feel suitable for children’s nursery, bedroom, or playroom wall art.

ROOM THEME

Use \`ROOM_THEME\` as the visual theme for the information graphic.

Let it influence:

* Accent colours
* Background details
* Borders and corners
* Small icons
* Decorative motifs
* Natural textures
* Subtle patterns

The design must be softly but recognisably connected to the exact value of \`ROOM_THEME\`. Do not create a completely generic information graphic with no visible theme connection.

Theme accents must remain subtle and must not overpower the instructions.

Do not place theme accents inside the attached source artwork.

Do not use decorative examples unless they genuinely match \`ROOM_THEME\`.

ANIMAL GUIDANCE

\`ANIMAL\` identifies the animal featured in the source artwork.

Do not allow \`ANIMAL\` to control the entire design unless \`ROOM_THEME\` explicitly describes an animal-themed design.

You may include one small supporting accent representing \`ANIMAL\`, but only if it fits naturally with \`ROOM_THEME\`.

If an animal accent is included, it must depict the exact animal specified by \`ANIMAL\`.

If \`ANIMAL\` is empty, do not add an animal accent unless one is explicitly required by \`ROOM_THEME\`.

Do not include other animal species, animal toys, motifs, or icons unless they are:

* Explicitly included in \`ROOM_THEME\`
* Explicitly named in \`ANIMAL\`
* Already visible in the attached source artwork

Do not default to a particular animal.

PRODUCT ACCURACY

This is a digital download product.

The buyer receives digital files and arranges printing and framing themselves.

The buyer does not receive:

* A physical print
* Printing services
* A picture frame
* A mount
* Packaging
* A parcel
* Any other physical item

The artwork preview and frame icon are examples only.

Do not include shipping or delivery imagery, even when crossed out.

DO NOT INCLUDE

* People
* Children or children’s faces
* Pets
* Brand names or logos
* Copyrighted characters
* Fake Etsy branding
* Fake buttons or links
* Watermarks
* Messy or crowded layouts
* Hard-to-read fonts
* Misspelled, incomplete, duplicated, or distorted text
* Altered, cropped, or distorted artwork
* Bright, harsh, or overly cartoonish colours
* Decorative elements that compete with the instructions
* Unrelated decorative themes
* Generic styling with no connection to \`ROOM_THEME\`
* Animal-only styling unless required by \`ROOM_THEME\`
* Animals not required by \`ROOM_THEME\`, \`ANIMAL\`, or the source artwork
* Parcels
* Packaging
* Postage labels
* Shipping boxes
* Delivery vehicles
* Wrapped prints
* Anything suggesting that printing, framing, or physical delivery is included

OUTPUT

* Create one square Etsy listing image.
* Target dimensions: 3000 × 3000 pixels.
* Minimum dimensions: 2000 × 2000 pixels.
* Use an sRGB colour profile.
* Keep all instructions, icons, and the artwork preview centred within generous safe margins.
* Ensure Etsy cropping cannot cut off any text or important content.
* Return only the generated image in the chat image viewer.`;

export function buildHowToPrintIncludedImagePrompt(roomTheme: string, listingItem: string) {
  return HOW_TO_PRINT_INCLUDED_IMAGE_PROMPT
    .replaceAll('{{ROOM_THEME}}', promptVariable(roomTheme))
    .replaceAll('{{ANIMAL}}', promptVariable(listingItem))
    .replaceAll('{{FILES_INCLUDED}}', 'A5, A4, A3, A2 and A1')
    .replaceAll('{{RECOMMENDED_PAPER}}', 'Heavyweight matte photo paper, approximately 200–250 gsm');
}

const PERSONAL_USE_INCLUDED_IMAGE_PROMPT = `ROOM_THEME = "{{ROOM_THEME}}"
ANIMAL = "{{ANIMAL}}"

Use the image attached to this prompt as the source artwork.

Generate one inline ChatGPT image only.

Do not create or attach a downloadable file. Do not return a filename, Markdown link, sandbox link, download link, explanation, or other text. Do not use Python, Code Interpreter, Data Analysis, or file generation.

Return only the generated image in the chat image viewer.

Create one premium square Etsy information image explaining the personal-use licence for this digital-download children’s wall art.

SOURCE ARTWORK

Use the attached image as a small artwork preview within the information graphic.

Preserve the source artwork exactly as supplied:

* Do not redraw, alter, recolour, simplify, enhance, replace, expand, or reinterpret it.
* Do not add anything inside the artwork.
* Do not remove any existing details.
* Preserve its original aspect ratio.
* Do not stretch, distort, or crop it.
* Ensure the complete artwork remains visible.

The artwork preview must support the licence information without overpowering the text.

MAIN PURPOSE

Make it clear that the artwork is licensed for personal use only.

The buyer may print and use the artwork personally, including giving a finished physical print as a gift.

The buyer may not:

* Resell the digital files
* Share or redistribute the files
* Use the artwork commercially
* Upload the artwork to print-on-demand marketplaces

Keep the message friendly, clear, reassuring, and easy to understand. Do not make it look like a threatening legal warning.

LAYOUT

Create a clean square information graphic with:

* A prominent title at the top
* A small preview of the attached artwork
* Two balanced information sections
* Plenty of white space
* Simple, consistent icons
* Subtle accents inspired by \`ROOM_THEME\`

Use these two section headings:

You may:

Please do not:

Use a calm two-column or vertically stacked layout. Give both sections enough room so all wording remains clear and legible.

Use friendly icons if helpful:

* Home icon
* Gift icon
* Print icon
* No-resale icon
* No-sharing icon
* No-commercial-use icon
* No print-on-demand icon

Use a subtle tick symbol for permitted uses and a subtle cross or prohibition symbol for prohibited uses.

Icons must be minimal, tasteful, consistent, and secondary to the text. Do not include fake words, branding, or unreadable markings inside them.

TEXT REQUIREMENT

Include the following wording exactly, preserving all spelling and capitalisation:

Personal Use Only

You may:

Print for your own home

Print as a gift

Use for personal decor

Please do not:

Resell the files

Share or redistribute the files

Use commercially

Upload to print-on-demand sites

Digital download only

TEXT HIERARCHY

* Make “Personal Use Only” the largest and most prominent heading.
* Make “You may:” and “Please do not:” clear section headings.
* Display each permitted and prohibited use as a separate line.
* Use “Digital download only” as a smaller footer.
* Keep all wording within generous safe margins.

TEXT RULES

* Use a simple modern font.
* Do not use decorative or hard-to-read fonts.
* Use strong contrast against the background.
* Keep the text evenly spaced and neatly aligned.
* Do not paraphrase, abbreviate, duplicate, or alter the wording.
* Do not misspell, omit, warp, or distort any text.
* Keep the design uncluttered and easy to scan.

If accurate text rendering cannot be guaranteed, omit the wording and leave clearly structured blank text areas for it to be added manually. Do not include partial, inaccurate, or unreadable text.

VISUAL STYLE

Create a calm, warm, premium Etsy-style information graphic suitable for children’s nursery, bedroom, or playroom wall art.

Use:

* A warm-white, cream, beige, or softly muted background
* Soft neutral colours
* Plenty of white space
* Muted accent colours
* A clean and trustworthy layout
* Two to four subtle decorative accents directly connected to \`ROOM_THEME\`

Use \`ROOM_THEME\` to influence:

* Accent colours
* Background details
* Borders and corners
* Small icons
* Decorative motifs
* Natural textures
* Subtle patterns

The design must be softly but recognisably connected to the exact value of \`ROOM_THEME\`. Do not create a completely generic licence graphic with no visible theme connection.

Theme accents must remain subtle and must not compete with the licence information.

Do not place theme accents inside the attached source artwork.

Do not use decorative examples unless they genuinely match \`ROOM_THEME\`.

ANIMAL GUIDANCE

\`ANIMAL\` identifies the animal featured in the source artwork.

Do not allow \`ANIMAL\` to control the whole design unless \`ROOM_THEME\` explicitly describes an animal-themed design.

You may include one small supporting accent representing \`ANIMAL\`, but only if it fits naturally with \`ROOM_THEME\`.

If an animal accent is included, it must depict the exact animal specified by \`ANIMAL\`.

If \`ANIMAL\` is empty, do not add an animal accent unless one is explicitly required by \`ROOM_THEME\`.

Do not include other animal species, animal toys, motifs, or icons unless they are:

* Explicitly included in \`ROOM_THEME\`
* Explicitly named in \`ANIMAL\`
* Already visible in the attached source artwork

Do not default to a particular animal.

LICENCE ACCURACY

“Print as a gift” means the buyer may give a finished physical print as a personal gift.

It does not mean the buyer may:

* Send or share the digital file
* Sell the physical print
* Produce prints for business use
* Use the artwork for commercial products
* Upload the file to print-on-demand selling platforms

Do not add extra rights or restrictions beyond those stated in this prompt.

PRODUCT ACCURACY

This is a digital download product.

Do not imply that the buyer receives:

* A physical print
* A picture frame
* A mount
* Packaging
* A parcel
* Any other physical item

The artwork preview is only an example of how the buyer might display the artwork after printing it.

Do not include shipping or delivery imagery, even if crossed out.

DO NOT INCLUDE

* People
* Children or children’s faces
* Pets
* Brand names or logos
* Copyrighted characters
* Fake Etsy branding
* Watermarks
* Messy or crowded layouts
* Legal-document styling
* Harsh warning signs
* Aggressive wording
* Decorative or hard-to-read fonts
* Misspelled, incomplete, duplicated, or distorted text
* Altered, cropped, or distorted artwork
* Bright, harsh, or overly cartoonish colours
* Unrelated decorative themes
* Generic styling with no connection to \`ROOM_THEME\`
* Animal-only styling unless required by \`ROOM_THEME\`
* Animals not required by \`ROOM_THEME\`, \`ANIMAL\`, or the source artwork
* Misleading physical-product imagery
* Parcels
* Packaging
* Postage labels
* Shipping boxes
* Delivery vehicles
* Wrapped prints
* Anything suggesting that a physical item is supplied

OUTPUT

* Create one square Etsy listing image.
* Target dimensions: 3000 × 3000 pixels.
* Minimum dimensions: 2000 × 2000 pixels.
* Use an sRGB colour profile.
* Keep all text, icons, and the artwork preview centred within generous safe margins.
* Ensure Etsy cropping cannot cut off any text or important content.
* Return only the generated image in the chat image viewer.`;

export function buildPersonalUseIncludedImagePrompt(roomTheme: string, listingItem: string) {
  return PERSONAL_USE_INCLUDED_IMAGE_PROMPT
    .replaceAll('{{ROOM_THEME}}', promptVariable(roomTheme))
    .replaceAll('{{ANIMAL}}', promptVariable(listingItem));
}

const BEDROOM_DOOR_IMAGE_PROMPT = `ROOM_THEME = "{{ROOM_THEME}}"
ANIMAL = "{{ANIMAL}}"
FRAME_COLOUR = "Black"

Use the image attached to this prompt as the source artwork.

Generate one inline ChatGPT image only.

Do not create or attach a downloadable file. Do not return a filename, Markdown link, sandbox link, download link, explanation, or other text. Do not use Python, Code Interpreter, Data Analysis, or file generation.

Return only the generated image in the chat image viewer.

Create one photorealistic square Etsy mockup showing printable children’s artwork framed and mounted on the outside of a child’s bedroom door, clearly photographed from the hallway.

SOURCE ARTWORK

Use the attached transparent PNG as the artwork displayed in the mockup.

Preserve every visible, non-transparent part of the source artwork exactly as supplied:

* Do not redraw, alter, recolour, simplify, enhance, replace, expand, or reinterpret it.
* Do not add anything inside the artwork.
* Do not remove any existing visible details.
* Preserve all existing text exactly, including spelling, punctuation, capitalisation, font appearance, curvature, colour, and placement.
* Preserve the original aspect ratio.
* Do not stretch, distort, or crop the artwork.
* Ensure the complete artwork remains visible.

TRANSPARENT BACKGROUND HANDLING

The source artwork has a transparent background.

Any black-looking background visible in the attachment preview represents transparent pixels displayed against a black viewer background. It is not part of the artwork.

* Do not reproduce or interpret transparent areas as black.
* Do not place a black rectangle or dark-coloured background behind the artwork.
* Composite the transparent areas naturally onto the clean white paper of the physical print.
* The printed artwork inside the frame must therefore have a clean white background.
* Preserve the turtle, personalised text, colours, positioning, proportions, and every non-transparent pixel exactly.
* Do not show transparency grids, checkerboards, cut-out holes, or transparent paper.
* Do not recolour or modify the white paper.
* Any clean white mount surrounding the print must remain visually distinct from the printed paper using only its physical edges and subtle natural shadows.

ESSENTIAL VIEWPOINT

The photograph must unmistakably be taken from the hallway, looking towards the outside of a child’s closed bedroom door.

Position the camera approximately 1.5 to 2 metres away from the door in the hallway.

Show enough surrounding hallway architecture to establish the viewpoint clearly:

* A visible section of hallway floor extending towards the door
* Hallway skirting boards
* The complete door casing or most of the door casing
* A short section of wall on both sides of the doorway
* A small wall return, corner, or adjoining section of hallway on one side
* Realistic depth between the camera position and the bedroom door

Use a very slight three-quarter hallway angle of approximately 5–10 degrees rather than a perfectly flat studio-style view. The door should still appear nearly front-facing, and the artwork must remain easy to see.

Do not make the scene look like it was photographed from inside the child’s bedroom.

Do not show a bed, bedroom furniture, or the interior of the bedroom. The door must remain closed.

CHILD’S BEDROOM ENTRANCE

Make the entrance feel recognisably like a child’s bedroom while remaining tasteful, calm, and premium.

Use a standard warm-white or soft-cream painted interior door with:

* Realistic residential bedroom-door proportions
* Four or six subtle recessed panels, or a broad flat upper panel
* A visible door frame and architrave
* A simple lever-style door handle at a realistic height
* A small keyhole or plain handle plate if appropriate
* Subtle painted wood grain
* Slightly softened signs of normal family-home use
* Natural contact shadows around the door casing and frame

The door should look like a genuine bedroom door in a well-kept family home, not a front door, cupboard door, hotel door, classroom door, nursery-school door, or freestanding display panel.

Add only two or three understated details outside the bedroom that gently indicate the room belongs to a child. Suitable details include:

* One low child-height wooden wall peg
* A small neutral-coloured child’s backpack hanging from the peg
* A small pair of tidy children’s slippers or soft shoes beside the skirting board
* A narrow pale-oak hallway shelf
* A small woven storage basket
* A soft, child-friendly patterned hallway runner
* One tasteful nursery-style ornament

Use only two or three of these details. Keep them subtle, naturally positioned, and secondary to the framed artwork.

Do not add a separate name plaque, bedroom sign, door number, lettering, or other text.

HALLWAY STYLE

Create a calm, premium Scandinavian-style family hallway.

Use:

* Warm-white or cream hallway walls
* Pale-oak or light natural-wood flooring
* White or cream skirting boards
* Soft woven natural textures
* Muted nursery-friendly colours
* Gentle daylight entering from elsewhere in the hallway
* Clean but lived-in residential styling
* Realistic architectural depth

The hallway must feel warm, cosy, welcoming, and suitable for a family home.

Avoid making it look like a product studio, hotel corridor, office corridor, school corridor, hospital corridor, or empty undecorated passageway.

THEME AND SURROUNDINGS

Use ROOM_THEME as the inspiration for a few subtle decorative accents around the child’s bedroom entrance.

The theme must be recognisable but understated and must not overwhelm the doorway.

For ROOM_THEME = "Sea Creatures", suitable accents include:

* A muted blue-green hallway runner with a subtle wave pattern
* One small wooden or ceramic sea-creature ornament on a narrow shelf
* Two or three very small, tasteful sea-inspired wall decals beside the door
* A soft teal or seafoam child’s backpack
* A small shell-shaped or wave-patterned accessory

Use no more than two or three themed accents in total.

Keep all accents outside the picture frame and away from the artwork, door handle, and door edges.

Do not turn the hallway into an underwater scene. Do not add realistic water, coral reefs, ocean backgrounds, beach scenery, excessive shells, or bright cartoon sea-creature decorations.

ANIMAL GUIDANCE

ANIMAL identifies the animal featured in the source artwork.

Do not allow ANIMAL to control the whole scene design unless ROOM_THEME supports it.

You may include one small supporting accent representing ANIMAL, but only when it fits naturally with ROOM_THEME.

If an animal accent is included, it must depict the exact animal specified by ANIMAL.

Do not include any other animal species, animal toys, animal motifs, or animal icons unless they are:

* Explicitly included in ROOM_THEME
* Explicitly named in ANIMAL
* Already visible in the attached source artwork

ARTWORK PLACEMENT

Place the attached artwork inside a simple, slim FRAME_COLOUR picture frame mounted directly on the outside of the child’s bedroom door.

Position the frame:

* Horizontally centred on the door itself
* On the upper-middle section of the door
* With its centre approximately at adult eye level
* Clearly above the door handle
* With generous space between the frame and the door edges
* In a location that would be practical and believable in a real family home

Use a realistic A4-sized white paper print inside the frame, proportionate to a standard bedroom door.

The source artwork’s transparent areas must show the clean white paper beneath them. They must not appear black, dark, transparent, or cut out.

An A4 frame must look modestly sized relative to the door. It must not occupy most of the door width or resemble an A3, A2, or oversized poster frame.

The frame must be:

* Straight and level
* Realistically proportioned
* Elegant and lightweight in appearance
* Clearly coloured according to FRAME_COLOUR
* Mounted flush against the door
* Supported by a subtle, realistic contact shadow
* Fully visible and unobstructed

Do not show the frame floating, suspended by a ribbon, leaning against the door, attached to the wall, or hanging from the handle.

Make the framed artwork the primary visual focus while retaining enough hallway context to establish the location.

The illustration and all existing personalised text within the source artwork must remain clear and readable.

Preserve the artwork’s original aspect ratio. If its proportions do not match the frame, add a clean white mount around the complete white paper print. Never stretch, crop, or distort the artwork to fit.

Do not add any other pictures, posters, competing wall art, separate name signs, or additional framed images.

CAMERA AND COMPOSITION

* Square composition
* Camera positioned in the hallway approximately 1.5 to 2 metres from the door
* Camera approximately level with the framed artwork
* Slight three-quarter hallway angle of approximately 5–10 degrees
* Door kept almost front-facing
* Hallway floor visible in the foreground
* Door casing and surrounding hallway wall clearly visible
* Realistic depth and perspective
* Vertical architectural lines kept straight
* No extreme perspective
* No close-up crop showing only the middle of the door
* No wide-angle distortion
* No fisheye effect
* No tilted camera
* No dramatic diagonal composition

The door should occupy approximately 60–70% of the image width, leaving enough visible hallway wall and floor to communicate that the photograph was taken from outside the bedroom.

The frame and artwork must remain large enough to be clearly seen in an Etsy listing thumbnail.

LIGHTING

* Soft natural daylight entering from elsewhere in the hallway
* Warm, balanced interior tones
* Gentle natural shadows
* Subtle contact shadows around the door frame and picture frame
* Minimal glass reflections
* No glare across the artwork
* No harsh direct sunlight
* No artificial spotlight focused on the frame
* Photorealistic Etsy lifestyle photography
* Calm, cosy, clean, premium appearance

PRODUCT ACCURACY

This Etsy product is a digital download.

The framed artwork is only a lifestyle mockup showing how the downloaded artwork could look when printed on white paper, framed, and displayed on a child’s bedroom door.

Do not add promotional elements implying that a physical frame, printed poster, or shipped product is supplied.

DO NOT INCLUDE

* A black or dark background inside the printed artwork
* Black filling in any transparent part of the source PNG
* Transparency grids or checkerboard patterns
* People
* Children or children’s faces
* Pets
* An open bedroom door
* A view from inside the bedroom
* Beds or bedroom furniture
* Brand names or logos
* Copyrighted characters
* Additional wall art
* Additional text
* Labels
* Door numbers
* Separate name signs
* Changes to text already present in the source artwork
* Watermarks
* Excessive toys
* Messy clutter
* Dark scenes
* Harsh shadows
* Warped doors or frames
* Cropped or distorted artwork
* Oversized frames that look implausible on the door
* Overly bright cartoon colours
* Unrelated decorative details
* Packaging
* Parcels
* Postage labels
* Shipping boxes
* Delivery vehicles
* Wrapped prints
* A front entrance door
* A hotel, office, school, nursery-school, or hospital corridor
* A studio backdrop pretending to be a hallway
* An underwater environment
* Excessive sea-themed décor
* Any unrelated animal species

OUTPUT

* Create one square Etsy listing image.
* Target dimensions: 3000 × 3000 pixels.
* Minimum dimensions: 2000 × 2000 pixels.
* Use an sRGB colour profile.
* Keep the complete framed artwork within generous safe margins so Etsy cropping does not cut it off.
* Ensure the hallway foreground, door casing, door handle, surrounding walls, and child-friendly entrance details are visible.
* Ensure it is immediately obvious that the viewer is standing in a family hallway looking at the outside of a child’s bedroom door.
* Ensure every transparent area in the source PNG appears as clean white printed paper, never black.
* Return only the generated image in the chat image viewer.`;

export function buildBedroomDoorImagePrompt(roomTheme: string, listingItem: string) {
  return BEDROOM_DOOR_IMAGE_PROMPT
    .replaceAll('{{ROOM_THEME}}', promptVariable(roomTheme))
    .replaceAll('{{ANIMAL}}', promptVariable(listingItem));
}

const BESIDE_BED_IMAGE_PROMPT = `ROOM_THEME = "{{ROOM_THEME}}"
ANIMAL = "{{ANIMAL}}"
FRAME_COLOUR = "Black"

Use the image attached to this prompt as the source artwork.

Generate one inline ChatGPT image only.

Do not create or attach a downloadable file. Do not return a filename, Markdown link, sandbox link, download link, explanation, or other text. Do not use Python, Code Interpreter, Data Analysis, or file generation.

Return only the generated image in the chat image viewer.

Create one photorealistic square Etsy mockup showing printable children’s artwork framed and hanging on the wall of a child’s bedroom, with a slim display shelf beneath it containing a few tasteful children’s items inspired by ROOM_THEME.

SOURCE ARTWORK

Use the attached image as the artwork displayed in the mockup.

Preserve the source artwork exactly as supplied:

- Do not redraw, alter, recolour, simplify, enhance, replace, expand, or reinterpret it.
- Do not add anything inside the artwork.
- Do not remove any existing details.
- Preserve any existing text exactly, including spelling, punctuation, capitalisation, font appearance, curvature, and placement.
- Preserve its original aspect ratio.
- Do not stretch, distort, or crop it.
- Ensure the complete artwork remains visible.

BEDROOM SETTING

Create a calm, premium Scandinavian-style child’s bedroom.

Show a warm-white or soft-cream painted wall with subtle natural texture. The wall must look like a real interior bedroom wall rather than a studio backdrop.

Include enough surrounding detail to establish that this is a child’s bedroom while keeping the composition clean and uncluttered.

Suitable surrounding details include:

- A small section of pale natural-wood flooring
- White or cream skirting boards
- The edge of a soft nursery rug
- A partial glimpse of a child’s bed or bedside furniture at one edge
- Soft natural textiles
- Pale-oak furniture or decorative details
- Muted, nursery-friendly colours

Do not let furniture or decorations compete with the framed artwork.

THEME

Use ROOM_THEME as the main inspiration for the colours and decorative items.

The theme should be softly but recognisably represented without turning the entire room into a theatrical themed environment.

For ROOM_THEME = "Sea Creatures", use a restrained palette such as:

- Soft seafoam green
- Muted teal
- Dusty blue
- Warm cream
- Pale natural wood

Do not create an underwater scene. The setting must remain a realistic child’s bedroom.

ARTWORK PLACEMENT

Place the attached artwork inside a simple, slim FRAME_COLOUR picture frame hanging directly on the bedroom wall.

Position the frame:

- Horizontally centred within the composition
- On the upper-middle section of the wall
- Directly above the display shelf
- With a believable gap between the bottom of the frame and the shelf
- Straight and level
- Fully visible and unobstructed
- Within generous safe margins

Use a realistic A4-sized print inside the frame.

The framed print must look appropriately sized relative to the shelf and surrounding bedroom furniture. It must not appear oversized.

The frame must be:

- Simple and elegant
- Lightweight in appearance
- Clearly coloured according to FRAME_COLOUR
- Mounted flat against the wall
- Supported by a subtle, realistic contact shadow
- Free from excessive reflections

Do not show the frame floating, leaning on the shelf, suspended by a ribbon, or resting against the wall.

Make the framed artwork the primary focus of the image.

Preserve the artwork’s original aspect ratio. If its proportions do not match the frame, add a clean white mount or border. Never stretch, crop, or distort the artwork to fit.

SHELF BENEATH THE PICTURE

Place one slim pale-oak or warm-white picture ledge directly beneath the framed artwork.

The shelf must:

- Be horizontally centred beneath the frame
- Be slightly wider than the framed artwork
- Be securely mounted to the wall
- Have realistic proportions and depth
- Cast a soft contact shadow against the wall
- Remain visually secondary to the framed artwork
- Not touch, overlap, or obscure the frame

Leave a realistic vertical gap of approximately 15–25 cm between the bottom of the frame and the top of the shelf.

Place only three or four small children’s items on the shelf.

The items must be inspired by ROOM_THEME and arranged naturally with varied but balanced spacing.

For ROOM_THEME = "Sea Creatures", suitable shelf items include:

- One small wooden green sea turtle toy
- One small muted-blue whale or fish ornament
- One short stack of two nursery books in seafoam, cream, or dusty-blue colours
- One small shell-shaped night light
- One small wooden sailing boat
- One small woven basket in a natural colour

Select only three or four items. Do not include every suggested item.

At least one item should look clearly child-friendly, such as a small wooden toy or nursery book.

Keep all shelf items smaller than the framed artwork and positioned below it.

Do not allow any item to overlap, cover, or distract from the artwork.

Do not place text, readable book titles, logos, branding, or character artwork on the shelf items.

ANIMAL GUIDANCE

ANIMAL identifies the animal featured in the source artwork.

You may include one small supporting shelf ornament representing ANIMAL when it fits naturally with ROOM_THEME.

If included, it must depict the exact animal specified by ANIMAL.

Do not include multiple copies of ANIMAL.

Do not include unrelated animal species unless they are naturally part of ROOM_THEME.

Do not add animal toys, motifs, or illustrations elsewhere in the room unless permitted by ROOM_THEME.

COMPOSITION

Create a polished square Etsy listing composition.

The framed artwork must occupy the upper central area, with the shelf and themed children’s items directly beneath it.

Use:

- A mostly straight-on camera angle
- Camera positioned approximately level with the framed artwork
- Wall surface nearly parallel to the camera sensor
- Vertical and horizontal lines kept straight
- Enough surrounding bedroom context to make the scene believable
- A relatively close composition so the illustration and existing personalised text remain easy to see
- Balanced negative space around the frame
- Generous safe margins for Etsy cropping

The framed artwork should remain the largest and clearest decorative element.

The shelf and children’s items should support the presentation without becoming the main subject.

LIGHTING

- Soft natural daylight from a nearby bedroom window
- Gentle, realistic shadows
- Warm, balanced interior tones
- Minimal glass reflections
- No glare across the artwork
- No harsh direct sunlight
- No dramatic spotlighting
- Photorealistic Etsy lifestyle photography
- Calm, cosy, clean, premium appearance

PRODUCT ACCURACY

This Etsy product is a digital download.

The framed artwork, shelf, toys, books, ornaments, and bedroom furnishings are lifestyle staging only. They are not included with the digital download.

Do not add promotional elements suggesting that a physical frame, shelf, printed poster, toy, or shipped product is supplied.

DO NOT INCLUDE

- People
- Children or children’s faces
- Pets
- Brand names or logos
- Copyrighted characters
- Additional framed pictures
- Additional wall art
- Separate name signs
- Additional text or labels
- Readable book titles
- Changes to text already present in the source artwork
- Watermarks
- More than one shelf
- More than four items on the shelf
- Large toys that compete with the artwork
- Items positioned in front of the artwork
- Messy clutter
- Dark scenes
- Harsh shadows
- Warped walls, shelves, or frames
- Cropped or distorted artwork
- Oversized frames
- Overly bright cartoon colours
- Packaging
- Parcels
- Postage labels
- Shipping boxes
- Delivery vehicles
- Wrapped prints
- An underwater environment
- Excessive themed decorations
- Sea, space, farm, jungle, safari, woodland, coastal, or other themed décor unless explicitly required by ROOM_THEME, ANIMAL, or the attached source artwork

OUTPUT

- Create one square Etsy listing image.
- Target dimensions: 3000 × 3000 pixels.
- Minimum dimensions: 2000 × 2000 pixels.
- Use an sRGB colour profile.
- Keep the complete framed artwork centred within generous safe margins.
- Ensure the artwork remains clear and readable at Etsy thumbnail size.
- Ensure the shelf is visibly mounted beneath the picture.
- Include only three or four tasteful children’s items inspired by ROOM_THEME.
- Keep the framed artwork as the unmistakable primary focus.
- Return only the generated image in the chat image viewer.`;

export function buildBesideBedImagePrompt(roomTheme: string, listingItem: string) {
  return BESIDE_BED_IMAGE_PROMPT
    .replaceAll('{{ROOM_THEME}}', promptVariable(roomTheme))
    .replaceAll('{{ANIMAL}}', promptVariable(listingItem));
}

const CUSTOMISED_PLAYROOM_IMAGE_PROMPT = `ROOM_THEME = "{{ROOM_THEME}}"
ANIMAL = "{{ANIMAL}}"
FRAME_COLOUR = "Black"

Use the image attached to this prompt as the source artwork.

Generate one inline ChatGPT image only.

Do not create or attach a downloadable file. Do not return a filename, Markdown link, sandbox link, download link, explanation, or other text. Do not use Python, Code Interpreter, Data Analysis, or file generation.

Return only the generated image in the chat image viewer.

Create one photorealistic square Etsy mockup showing printable children’s artwork framed and hanging on the wall of a child’s bedroom, with a small children’s play table positioned beneath it and styled according to ROOM_THEME.

SOURCE ARTWORK

Use the attached image as the artwork displayed in the mockup.

Preserve the source artwork exactly as supplied:

- Do not redraw, alter, recolour, simplify, enhance, replace, expand, or reinterpret it.
- Do not add anything inside the artwork.
- Do not remove any existing details.
- Preserve any existing text exactly, including spelling, punctuation, capitalisation, font appearance, curvature, and placement.
- Preserve its original aspect ratio.
- Do not stretch, distort, or crop it.
- Ensure the complete artwork remains visible.

BEDROOM SETTING

Create a calm, premium Scandinavian-style child’s bedroom.

Show a warm-white or soft-cream painted wall with subtle natural texture. The wall must look like a real bedroom wall rather than a studio backdrop.

Include:

- A visible section of pale natural-wood flooring
- White or cream skirting boards
- A soft nursery rug beneath or partly beneath the play table
- Soft natural textures
- Muted, nursery-friendly colours
- Pale-oak furniture details
- A small amount of realistic bedroom context

The room must feel warm, cosy, welcoming, well maintained, and genuinely suitable for a young child.

Keep the scene uncluttered. Do not allow surrounding furniture or decorations to compete with the framed artwork.

ROOM THEME

Use ROOM_THEME as the inspiration for the colours, play-table styling, and a few small accessories.

The theme must be softly but recognisably represented without turning the room into a theatrical or fantasy environment.

For ROOM_THEME = "Sea Creatures", use a restrained palette such as:

- Soft seafoam green
- Muted teal
- Dusty blue
- Warm cream
- Pale natural wood

Suitable theme details may include:

- A soft wave-patterned rug
- Muted blue or seafoam table accessories
- One or two small wooden sea-creature toys
- A simple sea-themed activity on the tabletop
- A subtle shell-shaped or wave-shaped accessory

Do not create an underwater room. Do not add realistic water, coral reefs, ocean scenery, beach scenery, or excessive sea-themed decorations.

ARTWORK PLACEMENT

Place the attached artwork inside a simple, slim FRAME_COLOUR picture frame hanging directly on the bedroom wall.

Position the frame:

- Horizontally centred within the composition
- On the upper-middle section of the wall
- Directly above the children’s play table
- Clearly separated from the table and its contents
- Straight and level
- Fully visible and unobstructed
- Within generous safe margins

Use a realistic A4-sized print inside the frame.

The framed print must look appropriately sized in relation to the child-sized table. It must not appear oversized.

The frame must be:

- Simple and elegant
- Lightweight in appearance
- Clearly coloured according to FRAME_COLOUR
- Mounted flat against the wall
- Supported by a subtle, realistic contact shadow
- Free from excessive reflections
- Completely visible

Do not show the frame floating, leaning on the table, suspended by a ribbon, or resting against the wall.

Make the framed artwork the primary focus of the image.

The illustration and any existing personalised text must remain clear and easy to see.

Preserve the artwork’s original aspect ratio. If its proportions do not match the frame, add a clean white mount or border. Never stretch, crop, or distort the artwork to fit.

CHILDREN’S PLAY TABLE

Place one small child-sized play table beneath the framed artwork.

The play table must:

- Be clearly designed for a young child
- Be lower and smaller than an adult table or desk
- Be made from pale oak or warm-white painted wood
- Have softly rounded corners
- Have safe, sturdy legs
- Be centred beneath the framed artwork
- Be positioned against or close to the wall
- Remain fully separate from the frame
- Look realistic and usable
- Fit naturally within a premium Scandinavian-style bedroom

Include one or two small matching child-sized chairs or stools.

Position the chairs naturally beside or partly tucked beneath the table. Do not allow a chair to obscure the table or framed artwork.

The table itself may include subtle colours or decorative details inspired by ROOM_THEME, but it must remain believable as real children’s furniture.

Do not make the table shaped like an animal, boat, shell, or novelty character.

PLAY-TABLE ACTIVITY

Arrange a simple children’s activity on the tabletop inspired by ROOM_THEME.

For ROOM_THEME = "Sea Creatures", suitable activities include:

- A small wooden sea-creature puzzle with only a few pieces
- Two or three wooden sea-creature figures
- A small sheet of paper with a simple childlike ocean drawing
- A few chunky crayons in muted colours
- A small wooden stacking toy in seafoam and blue tones
- A shallow activity tray containing a few sea-themed wooden pieces

Select only one main activity and no more than three or four small tabletop objects.

The tabletop must remain tidy and partly visible.

Do not add readable writing, brand names, logos, copyrighted characters, detailed printed worksheets, or recognisable commercial toys.

ANIMAL GUIDANCE

ANIMAL identifies the animal featured in the source artwork.

You may include one small supporting toy or puzzle piece representing ANIMAL when it fits naturally with ROOM_THEME.

If included, it must depict the exact animal specified by ANIMAL.

Do not include multiple copies of ANIMAL.

Do not include unrelated animal species unless they are naturally permitted by ROOM_THEME.

The supporting animal item must remain small and secondary. It must not compete with the animal shown in the framed artwork.

COMPOSITION

Create a polished square Etsy listing composition.

The framed artwork must occupy the upper central area of the image.

The child-sized play table must sit beneath it and help establish that the artwork is displayed in a real child’s bedroom.

Use:

- A mostly straight-on camera angle
- Camera positioned approximately level with the framed artwork
- Wall surface nearly parallel to the camera sensor
- Vertical and horizontal lines kept straight
- Enough floor visible to show the scale of the play table
- A relatively close composition so the artwork remains easy to see
- Balanced negative space around the frame
- Generous safe margins for Etsy cropping
- Realistic proportions between the artwork, wall, table, chairs, and room

The framed artwork must remain the largest and clearest decorative element.

The play table and activity should provide child-friendly context without becoming the main subject.

Do not let the table, chairs, or objects overlap or cover any part of the frame.

LIGHTING

- Soft natural daylight from a nearby bedroom window
- Gentle, realistic shadows
- Warm, balanced interior tones
- Minimal glass reflections
- No glare across the artwork
- No harsh direct sunlight
- No dramatic spotlighting
- Photorealistic Etsy lifestyle photography
- Calm, cosy, clean, premium appearance

PRODUCT ACCURACY

This Etsy product is a digital download.

The framed artwork, printed poster, frame, play table, chairs, toys, activity items, rug, and bedroom furnishings are lifestyle staging only. They are not included with the digital download.

Do not add promotional elements suggesting that any physical product is supplied.

DO NOT INCLUDE

- People
- Children or children’s faces
- Pets
- Brand names or logos
- Copyrighted characters
- Additional framed pictures
- Additional wall art
- Separate name signs
- Additional text or labels
- Readable book titles
- Changes to text already present in the source artwork
- Watermarks
- Adult-sized desks or chairs
- School classroom furniture
- More than one play table
- More than two chairs
- More than four small tabletop objects
- Large toys that compete with the artwork
- Toys positioned in front of the frame
- Excessive crayons, puzzle pieces, or craft materials
- Food or drinks
- Messy clutter
- Dark scenes
- Harsh shadows
- Warped walls, tables, chairs, or frames
- Cropped or distorted artwork
- Oversized frames
- Overly bright cartoon colours
- Packaging
- Parcels
- Postage labels
- Shipping boxes
- Delivery vehicles
- Wrapped prints
- An underwater environment
- Excessive themed decorations
- Sea, space, farm, jungle, safari, woodland, coastal, or other themed décor unless explicitly required by ROOM_THEME, ANIMAL, or the attached source artwork

OUTPUT

- Create one square Etsy listing image.
- Target dimensions: 3000 × 3000 pixels.
- Minimum dimensions: 2000 × 2000 pixels.
- Use an sRGB colour profile.
- Keep the complete framed artwork centred within generous safe margins.
- Ensure the artwork remains clear and readable at Etsy thumbnail size.
- Ensure the child-sized play table is visibly positioned beneath the picture.
- Style the table and activity according to ROOM_THEME.
- Keep the framed artwork as the unmistakable primary focus.
- Return only the generated image in the chat image viewer.`;

export function buildCustomisedPlayroomImagePrompt(roomTheme: string, listingItem: string) {
  return CUSTOMISED_PLAYROOM_IMAGE_PROMPT
    .replaceAll('{{ROOM_THEME}}', promptVariable(roomTheme))
    .replaceAll('{{ANIMAL}}', promptVariable(listingItem));
}

const CUSTOMISED_SHELVE_IMAGE_PROMPT = `ROOM_THEME = "{{ROOM_THEME}}"
ANIMAL = "{{ANIMAL}}"
FRAME_COLOUR = "Black"

Use the image attached to this prompt as the source artwork.

Generate one inline ChatGPT image only.

Do not create or attach a downloadable file. Do not return a filename, Markdown link, sandbox link, download link, explanation, or other text. Do not use Python, Code Interpreter, Data Analysis, or file generation.

Return only the generated image in the chat image viewer.

Create one photorealistic square Etsy mockup showing printable children’s artwork framed and hanging on a plain wall, with exactly one simple shelf beneath it and exactly two small decorative items inspired by ROOM_THEME.

SOURCE ARTWORK

Use the attached image as the artwork displayed in the mockup.

Preserve the source artwork exactly as supplied:

- Do not redraw, alter, recolour, simplify, enhance, replace, expand, or reinterpret it.
- Do not add anything inside the artwork.
- Do not remove any existing details.
- Preserve any existing text exactly, including spelling, punctuation, capitalisation, font appearance, curvature, and placement.
- Preserve its original aspect ratio.
- Do not stretch, distort, or crop it.
- Ensure the complete artwork remains visible.

PLAIN WALL SETTING

Use one clean, plain interior wall suitable for a premium Scandinavian-style child’s bedroom.

The wall must be:

- Smooth and uncluttered
- Free from patterns, murals, wallpaper, decals, stickers, stripes, panels, or decorative mouldings
- Painted in one soft, muted colour inspired by ROOM_THEME
- Realistic, with only a very subtle painted-wall texture
- Calm, warm, and nursery-friendly

For ROOM_THEME = "Sea Creatures", use a soft muted seafoam, pale blue-green, very light dusty blue, or warm off-white wall.

ROOM_THEME should influence only:

- The subtle wall colour
- The colours of the two shelf items
- The subject or design of the two shelf items

Do not turn the wall or room into a literal themed environment.

Do not create an underwater scene, ocean mural, beach setting, coral reef, fantasy background, or heavily decorated nursery.

ARTWORK PLACEMENT

Place the attached artwork inside a simple, slim FRAME_COLOUR picture frame hanging directly on the wall.

Position the frame:

- Horizontally centred in the composition
- On the upper-middle section of the wall
- Directly above the shelf
- Straight and level
- Fully visible and unobstructed
- Within generous safe margins
- With balanced plain wall space around it

Use a realistic A4-sized print inside the frame.

The framed print must be realistically proportioned and must not appear oversized.

The frame must be:

- Simple and elegant
- Lightweight in appearance
- Clearly coloured according to FRAME_COLOUR
- Mounted flat against the wall
- Supported by a subtle, realistic contact shadow
- Free from excessive reflections
- Completely visible

Do not show the frame floating, leaning on the shelf, suspended by a ribbon, or resting against the wall.

Make the framed artwork the unmistakable primary focus of the image.

The illustration and any existing personalised text must remain clear and easy to see.

Preserve the artwork’s original aspect ratio. If its proportions do not match the frame, add a clean white mount or border. Never stretch, crop, or distort the artwork to fit.

SINGLE SHELF

Place exactly one slim floating shelf directly beneath the framed artwork.

The shelf must:

- Be made from pale natural oak or painted warm white
- Be horizontally centred beneath the frame
- Be slightly wider than the framed artwork
- Have a simple Scandinavian design
- Have realistic thickness and depth
- Be securely mounted to the wall
- Cast a soft, realistic contact shadow
- Remain visually secondary to the framed artwork
- Not touch, overlap, or obscure the frame

Leave a realistic vertical gap of approximately 15–25 cm between the bottom of the frame and the top of the shelf.

Do not include any additional shelves, cabinets, tables, desks, picture ledges, bookcases, or storage units.

SHELF ITEMS

Place exactly two small decorative children’s items on the shelf.

Both items must be tasteful, simple, child-friendly, and inspired by ROOM_THEME.

Suitable item types include:

- One small wooden animal ornament
- One small wooden toy
- One small night light
- One small neutral nursery ornament
- One small theme-inspired decorative object
- One short stack of two closed nursery books treated as a single grouped item

For ROOM_THEME = "Sea Creatures", suitable choices include:

- One small wooden green sea turtle ornament
- One small shell-shaped night light
- One small wooden whale ornament
- One small wooden sailing boat
- One short stack of two muted blue and seafoam nursery books

Choose exactly two of these item types.

Arrange one item towards the left side of the shelf and one towards the right, leaving some empty shelf space between them.

The two objects must:

- Remain smaller than the framed artwork
- Be clearly separate from each other
- Be fully supported by the shelf
- Have muted, coordinated colours
- Look realistic rather than cartoonish
- Remain secondary to the artwork
- Contain no readable text, logos, branding, or copyrighted characters

If one shelf item depicts an animal, it should preferably depict the exact ANIMAL specified.

Do not include unrelated animal species unless they are naturally part of ROOM_THEME.

Do not add plants, flowers, vases, lamps, clocks, bunting, garlands, blocks, baskets, or other filler objects unless they are selected as one of the two permitted items and clearly suit ROOM_THEME.

COMPOSITION

Create a clean, balanced square Etsy listing composition.

Use:

- A straight-on camera angle
- Camera positioned approximately level with the framed artwork
- Wall surface parallel to the camera sensor
- Vertical and horizontal lines kept straight
- The frame in the upper central area
- The single shelf directly beneath it
- Large areas of calm, uncluttered wall space
- A relatively close composition so the artwork remains easy to see
- Generous safe margins for Etsy cropping
- Realistic proportions between the frame, shelf, and decorative objects

The frame and artwork must be the primary visual focus.

The shelf and its two items should provide subtle themed context without becoming the main subject.

Do not include visible flooring, skirting boards, doors, windows, beds, chairs, tables, rugs, or other furniture. The composition should consist only of the plain wall, framed artwork, one shelf, and two shelf items.

LIGHTING

- Soft natural daylight
- Gentle and realistic shadows
- Warm, balanced interior tones
- Minimal glass reflections
- No glare across the artwork
- No harsh direct sunlight
- No dramatic spotlighting
- Photorealistic Etsy product photography
- Calm, clean, cosy, premium appearance

PRODUCT ACCURACY

This Etsy product is a digital download.

The frame, printed poster, shelf, and decorative objects are lifestyle staging only. They are not included with the digital download.

Do not add promotional elements suggesting that any physical product is supplied.

DO NOT INCLUDE

- People
- Children or children’s faces
- Pets
- Furniture
- Visible flooring
- Skirting boards
- Doors or windows
- Plants or flowers
- More than one shelf
- More than two shelf items
- Additional framed pictures
- Additional wall art
- Wall decals
- Wallpaper
- Murals
- Patterned walls
- Separate name signs
- Additional text or labels
- Readable book titles
- Brand names or logos
- Copyrighted characters
- Changes to text already present in the source artwork
- Watermarks
- Messy clutter
- Dark scenes
- Harsh shadows
- Warped walls, shelves, or frames
- Cropped or distorted artwork
- Oversized frames
- Overly bright cartoon colours
- Packaging
- Parcels
- Postage labels
- Shipping boxes
- Delivery vehicles
- Wrapped prints
- A literal underwater, jungle, farm, space, safari, woodland, or fantasy environment
- Unrelated themed objects

OUTPUT

- Create one square Etsy listing image.
- Target dimensions: 3000 × 3000 pixels.
- Minimum dimensions: 2000 × 2000 pixels.
- Use an sRGB colour profile.
- Keep the complete framed artwork within generous safe margins.
- Ensure the artwork remains clear and readable at Etsy thumbnail size.
- Show exactly one shelf beneath the picture.
- Show exactly two small shelf items inspired by ROOM_THEME.
- Keep the wall plain and uncluttered.
- Keep the framed artwork as the unmistakable primary focus.
- Return only the generated image in the chat image viewer.`;

export function buildCustomisedShelveImagePrompt(roomTheme: string, listingItem: string) {
  return CUSTOMISED_SHELVE_IMAGE_PROMPT
    .replaceAll('{{ROOM_THEME}}', promptVariable(roomTheme))
    .replaceAll('{{ANIMAL}}', promptVariable(listingItem));
}
