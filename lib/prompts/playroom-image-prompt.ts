export const UPDATED_PLAYROOM_IMAGE_PROMPT = `ROOM_THEME = "{{ROOM_THEME}}"
ANIMAL = "{{ANIMAL}}"
FRAME_COLOUR = "{{FRAME_COLOUR}}"
PRINT_SIZE = "{{PRINT_SIZE}}"

Use the image attached to this prompt as the source artwork.

Generate one inline ChatGPT image only.

Do not create or attach a downloadable file. Do not return a filename, Markdown link, sandbox link, download link, explanation, or other text. Do not use Python, Code Interpreter, Data Analysis, or file generation.

Return only the generated image in the chat image viewer.

Create one photorealistic square Etsy mockup scene for printable children’s wall art.

PRINT SIZE AND PROPORTIONS

PRINT_SIZE controls the physical paper size of the print displayed inside the frame.

Allowed values:

* A4 = 210 mm wide × 297 mm high.
* A3 = 297 mm wide × 420 mm high.
* A2 = 420 mm wide × 594 mm high.

If PRINT_SIZE is omitted, blank, or invalid, use A3.

Use portrait orientation for all three sizes.

The paper inside the frame must follow ISO A-series portrait proportions:

* Width-to-height ratio approximately 1:1.414.
* Width approximately 70.7% of height.

The selected dimensions apply to the paper, not the outside of the frame. The frame’s outer dimensions must be slightly larger to accommodate a slim, realistic frame moulding.

Show the selected size at a believable physical scale relative to the playroom furniture:

* A4 should appear as a small framed print.
* A3 should appear as a medium framed print.
* A2 should appear as a larger framed print.

Do not enlarge an A4 or A3 print to resemble an oversized poster simply to fill the wall or image.

Include a low toy-storage unit approximately 80 cm wide beneath the artwork, against the same wall, as a visual scale reference. Before allowing for the frame moulding, the paper width should be approximately:

* A4: 26% of the storage unit’s width.
* A3: 37% of the storage unit’s width.
* A2: 53% of the storage unit’s width.

Keep sufficient furniture visible to communicate scale. Make the artwork prominent through composition, focus, and lighting while preserving its selected physical size.

Do not display measurements, size labels, or dimension arrows in the generated image.

SOURCE ARTWORK

Use the attached image as the artwork displayed in the mockup.

Preserve the source artwork exactly as supplied:

* Do not redraw, alter, recolour, simplify, enhance, replace, expand, or reinterpret it.
* Do not add anything inside the artwork.
* Do not remove any existing details.
* Preserve its original aspect ratio.
* Do not stretch, distort, or crop it.
* Ensure the complete artwork remains visible.

Fit the complete source artwork within the selected A-series paper size. If its aspect ratio differs from the paper’s proportions, use clean white margins within the selected paper dimensions. Do not change the paper size or distort the source artwork to make it fit.

Only apply realistic perspective, lighting, shadow, and scale so that the artwork looks naturally printed and framed in the room.

PLAYROOM STYLE

Create a calm, premium children’s playroom in a Scandinavian-inspired style.

Use ROOM_THEME as the main visual theme for the room. Let it influence the room colours, decorative accents, props, textures, and overall atmosphere.

The room must be softly but recognisably inspired by the exact value of ROOM_THEME. Do not create a plain, generic playroom with no visible connection to the specified theme.

Use:

* Soft natural daylight
* Warm-white or pale-neutral walls
* Pale-oak or light-wood furniture
* Tidy toy-storage baskets
* Bookshelves
* Cushions or a small rug
* A small table and chair, toy shelf, or reading corner
* Two to four subtle, nursery-friendly accents that directly match ROOM_THEME

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

ANIMAL identifies the animal featured in the source artwork.

Do not allow ANIMAL to control the whole room design unless ROOM_THEME explicitly describes an animal-themed room.

You may include one small supporting accent representing ANIMAL, but only when it fits naturally with ROOM_THEME.

If an animal accent is included, it must depict the exact animal specified by ANIMAL.

If ANIMAL is empty, do not add an animal accent unless an animal is explicitly required by ROOM_THEME.

Do not include other animal species, animal toys, animal motifs, or animal icons unless they are:

* Explicitly included in ROOM_THEME
* Explicitly named in ANIMAL
* Already visible in the attached source artwork

Do not default to a particular animal.

SPECIAL GUIDANCE FOR WOODLAND BUGS

If ROOM_THEME is “Woodland bugs”, create a gentle woodland-bug playroom using a balanced mixture of woodland nature and small, non-scary bug details.

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

Do not default to ants unless ANIMAL is “Ant” or ROOM_THEME explicitly includes ants.

Do not make the room look like an ant-only room unless ROOM_THEME explicitly requests an ant theme.

ARTWORK PLACEMENT

Place the attached artwork on the wall above the low toy-storage unit in the main play area, in a simple FRAME_COLOUR picture frame.

The frame must be:

* Straight
* Centred above the storage unit
* Realistic
* Elegant
* Clearly coloured according to FRAME_COLOUR
* Sized to hold the paper dimensions specified by PRINT_SIZE

Make the framed artwork the primary focus of the image.

Use exactly the selected PRINT_SIZE. Do not choose a different size based on what fills the wall best.

The artwork must look like a real framed paper poster, not a mural, sticker, canvas, television, or digital screen.

Preserve the artwork’s original aspect ratio. If its proportions do not match the selected paper, add clean white margins within the paper area. Never stretch, crop, or distort the artwork to fit.

Avoid a large external mount that makes the framed product appear substantially bigger than the selected print size.

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
* Clear visual reference between the framed print and the storage unit so the selected size remains believable

PRODUCT ACCURACY

This Etsy product is a digital download.

The framed artwork is only a lifestyle mockup showing how the downloaded artwork could look when printed at the selected PRINT_SIZE and framed.

Do not include anything implying that a physical frame, printed poster, packaging, or shipped product is supplied.

DO NOT INCLUDE

* People
* Children or children’s faces
* Pets
* Brand names or logos
* Copyrighted characters
* Additional wall art
* Text or labels
* Size labels or dimension arrows
* Watermarks
* Messy clutter
* Harsh shadows
* Cartoonish furniture
* Overly bright cartoon colours
* Distorted or cropped artwork
* Warped frames
* Incorrect A-series paper proportions
* Oversized frames that misrepresent the selected print size
* Mural-style artwork
* Sticker-style artwork
* Canvas-style artwork
* Screens or digital devices
* Plain generic playroom styling with no visible connection to ROOM_THEME
* Animal-only room styling unless explicitly required by ROOM_THEME
* Ants unless required by ANIMAL or ROOM_THEME
* Unrelated decorative themes
* Example theme elements that do not match ROOM_THEME
* Dinosaurs unless required by ROOM_THEME, ANIMAL, or the source artwork
* Safari or jungle animals unless required by ROOM_THEME, ANIMAL, or the source artwork
* Sea, ocean, beach, coastal, shell, whale, turtle, coral, wave, or underwater elements unless required by ROOM_THEME, ANIMAL, or the source artwork
* Space or farm elements unless required by ROOM_THEME, ANIMAL, or the source artwork
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
* The overall mockup must remain square; only the framed paper uses portrait A-series proportions.
* Keep the artwork and all important content centred within generous safe margins so Etsy cropping does not cut anything off.
* Return only the generated image in the chat image viewer.`;
