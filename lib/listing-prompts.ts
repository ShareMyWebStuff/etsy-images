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
  return BEDROOM_IMAGE_PROMPT
    .replaceAll('{{ROOM_THEME}}', promptVariable(roomTheme))
    .replaceAll('{{ANIMAL}}', promptVariable(listingItem))
    .replaceAll('{{FRAME_COLOUR}}', 'Natural Oak');
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
  return PLAYROOM_IMAGE_PROMPT
    .replaceAll('{{ROOM_THEME}}', promptVariable(roomTheme))
    .replaceAll('{{ANIMAL}}', promptVariable(listingItem))
    .replaceAll('{{FRAME_COLOUR}}', 'Natural Oak');
}

const PERFECT_GIFT_IMAGE_PROMPT = `ROOM_THEME = "{{ROOM_THEME}}"
ANIMAL = "{{ANIMAL}}"
FRAME_COLOUR = "{{FRAME_COLOUR}}"

Use the image attached to this prompt as the source artwork.

Generate one inline ChatGPT image only.

Do not create or attach a downloadable file. Do not return a filename, Markdown link, sandbox link, download link, explanation, or other text. Do not use Python, Code Interpreter, Data Analysis, or file generation.

Return only the generated image in the chat image viewer.

Create one photorealistic square Etsy listing image presenting this printable children’s wall art as a perfect gift.

SOURCE ARTWORK

Use the attached image as the artwork displayed in the mockup.

Preserve the source artwork exactly as supplied:

* Do not redraw, alter, recolour, simplify, enhance, replace, expand, or reinterpret it.
* Do not add anything inside the artwork.
* Do not remove any existing details.
* Preserve its original aspect ratio.
* Do not stretch, distort, or crop it.
* Ensure the complete artwork remains visible.

Only apply realistic perspective, lighting, shadow, and scale so that the artwork looks naturally placed in the scene.

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

If the artwork is framed, use a simple \`FRAME_COLOUR\` picture frame.

The frame must be:

* Straight
* Realistic
* Elegant
* Clearly coloured according to \`FRAME_COLOUR\`

If the artwork is shown unframed, do not include a frame.

Preserve the artwork’s original aspect ratio. If its proportions do not match the frame, use a clean white mount or border. Never stretch, crop, or distort the artwork.

Do not add any other pictures, posters, or competing wall art.

TEXT REQUIREMENT

Include the following text exactly as written, preserving all spelling and capitalisation:

Perfect Gift
for Little Animal Lovers

Nursery - Bedroom - Playroom

Place the text prominently in the lower section of the image, similar to a polished Etsy listing layout.

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
* Overly bright cartoon colours
* Misspelled, warped, duplicated, or unreadable text
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
* Keep the artwork, gift styling, and text centred within generous safe margins so Etsy cropping does not cut anything off.
* Return only the generated image in the chat image viewer.`;

export function buildPerfectGiftImagePrompt(roomTheme: string, listingItem: string) {
  return PERFECT_GIFT_IMAGE_PROMPT
    .replaceAll('{{ROOM_THEME}}', promptVariable(roomTheme))
    .replaceAll('{{ANIMAL}}', promptVariable(listingItem))
    .replaceAll('{{FRAME_COLOUR}}', 'Natural Oak');
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
FRAME_COLOUR = "Natural Oak"

Use the image attached to this prompt as the source artwork.

Generate one inline ChatGPT image only.

Do not create or attach a downloadable file. Do not return a filename, Markdown link, sandbox link, download link, explanation, or other text. Do not use Python, Code Interpreter, Data Analysis, or file generation.

Return only the generated image in the chat image viewer.

Create one photorealistic square Etsy mockup scene showing printable children’s artwork framed and mounted on a child’s bedroom door.

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

SCENE AND DOOR STYLE

Create a calm, premium Scandinavian-style setting focused on the outside of a child’s bedroom door, viewed from the hallway.

Use a closed, warm-white or cream painted wooden door with a broad, flat upper section suitable for mounting the picture frame.

The door must look like a real interior bedroom door:

- Standard, realistic proportions
- Visible door casing and surrounding wall
- A simple, realistically positioned door handle
- Subtle painted wood texture
- Soft natural light
- Gentle contact shadows

Compose the scene so the door occupies most of the image. Include enough of the door edges, casing, and handle to make it immediately clear that the artwork is mounted on a bedroom door.

The entire door does not need to be visible. Prioritise a clear, appealing view of the framed artwork and recognisable door details.

THEME AND SURROUNDINGS

Use the value of ROOM_THEME as the main visual theme for the decorative accents around the bedroom entrance.

The scene must be softly but recognisably inspired by ROOM_THEME without becoming busy.

Use:

- Warm-white or cream walls
- Pale-oak details where appropriate
- Soft natural textures
- Muted, nursery-friendly colours
- Two or three subtle decorative accents connected to ROOM_THEME

Theme accents may appear as:

- Small, understated decals on the wall beside the door
- A small themed ornament on a narrow hallway shelf
- A subtle patterned rug near the doorway
- A small themed accessory hanging from a wall peg beside the door

For a Bugs theme, suitable details include delicate leaf shapes, botanical accents, and a small beetle motif.

Keep decorations away from the frame and do not obscure the artwork, door handle, or door edges.

Keep the scene clean, calm, cosy, realistic, premium, and uncluttered.

ANIMAL GUIDANCE

ANIMAL identifies the animal featured in the source artwork.

Do not allow ANIMAL to control the whole scene design unless ROOM_THEME explicitly describes an animal-themed setting.

You may include one small supporting accent representing ANIMAL, but only when it fits naturally with ROOM_THEME.

If an animal accent is included, it must depict the exact animal specified by ANIMAL.

Do not include any other animal species, animal toys, animal motifs, or animal icons unless they are:

- Explicitly included in ROOM_THEME
- Explicitly named in ANIMAL
- Already visible in the attached source artwork

Do not default to a particular animal or add unrelated animal decorations.

ARTWORK PLACEMENT

Place the attached artwork inside a simple, slim FRAME_COLOUR picture frame mounted directly on the bedroom door.

Position the frame:

- Horizontally centred on the door itself
- On the upper-middle section of the door
- With its centre approximately at adult eye level
- Clearly above the door handle
- With generous space between the frame and the door edges

Use a realistic A4-sized print inside the frame, proportionate to a standard bedroom door.

The frame must be:

- Straight and level
- Realistically proportioned
- Elegant and lightweight in appearance
- Clearly coloured according to FRAME_COLOUR
- Mounted flush against the door with a subtle, realistic contact shadow
- Fully visible and unobstructed

Do not show the frame floating, suspended by a ribbon, leaning against the door, or hanging from the handle.

Make the framed artwork the primary focus of the image. Frame the photograph closely enough that the illustration and any existing personalised text are easy to see.

Preserve the artwork’s original aspect ratio. If its proportions do not match the frame, add a clean white mount or border. Never stretch, crop, or distort the artwork to fit.

Do not add any other pictures, posters, competing wall art, or separate name signs.

CAMERA AND LIGHTING

- Straight-on photography facing the door
- Camera positioned approximately level with the framed artwork
- Door surface parallel to the camera sensor
- Vertical door edges kept straight
- No extreme perspective
- No wide-angle distortion
- No fisheye effect
- Soft natural daylight from a nearby hallway window
- Gentle, natural shadows
- Minimal glass reflections so the artwork remains clearly visible
- Photorealistic Etsy product photography
- Calm, cosy, clean, premium appearance

PRODUCT ACCURACY

This Etsy product is a digital download.

The framed artwork is only a lifestyle mockup showing how the downloaded artwork could look when printed, framed, and displayed on a child’s bedroom door.

Do not add promotional elements implying that a physical frame, printed poster, or shipped product is supplied.

DO NOT INCLUDE

- People
- Children or children’s faces
- Pets
- Brand names or logos
- Copyrighted characters
- Additional wall art
- Additional text, labels, door numbers, or name signs
- Changes to any text already present in the source artwork
- Watermarks
- Messy clutter
- Dark scenes
- Harsh shadows
- Warped doors or frames
- Cropped or distorted artwork
- Oversized frames that look implausible on the door
- Overly bright cartoon colours
- Unrelated decorative details
- Packaging
- Parcels
- Postage labels
- Shipping boxes
- Delivery vehicles
- Wrapped prints
- An animal-only setting unless explicitly required by ROOM_THEME
- Sea, space, farm, jungle, safari, woodland, coastal, underwater, or other themed décor unless explicitly required by ROOM_THEME, ANIMAL, or the attached source artwork

OUTPUT

- Create one square Etsy listing image.
- Target dimensions: 3000 × 3000 pixels.
- Minimum dimensions: 2000 × 2000 pixels.
- Use an sRGB colour profile.
- Keep the complete framed artwork centred within generous safe margins so Etsy cropping does not cut it off.
- Ensure the door remains clearly recognisable as a child’s bedroom door.
- Return only the generated image in the chat image viewer.`;

export function buildBedroomDoorImagePrompt(roomTheme: string, listingItem: string) {
  return BEDROOM_DOOR_IMAGE_PROMPT
    .replaceAll('{{ROOM_THEME}}', promptVariable(roomTheme))
    .replaceAll('{{ANIMAL}}', promptVariable(listingItem));
}
