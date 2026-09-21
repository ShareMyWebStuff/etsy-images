export const UPDATED_BEDROOM_IMAGE_PROMPT = `ROOM_THEME = "{{ROOM_THEME}}"
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

Show the selected size at a believable physical scale relative to the bed, furniture, and room:

* A4 should appear as a small framed print.
* A3 should appear as a medium framed print.
* A2 should appear as a larger framed print.

Do not enlarge an A4 or A3 print to resemble an oversized poster simply to fill the wall or image.

Use a realistically proportioned single child’s bed, approximately 90 cm wide, as a scale reference. Before allowing for the frame moulding, the paper width should be approximately:

* A4: 23% of the bed’s width.
* A3: 33% of the bed’s width.
* A2: 47% of the bed’s width.

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

ROOM STYLE

Create a calm, premium children’s bedroom in a Scandinavian nursery style.

Use the value of ROOM_THEME as the main visual theme for the room. Let it influence the room colours, decorative accents, props, textures, and overall atmosphere.

The room must be softly but recognisably inspired by ROOM_THEME. Do not create a plain, generic nursery with no visible connection to the specified theme.

Use:

* Soft natural daylight
* Warm-white or cream walls
* Pale-oak furniture
* Cream or neutral bedding
* Soft natural fabrics
* Muted, nursery-friendly colours
* Two to four subtle decorative accents connected to ROOM_THEME

Theme accents may appear in the surrounding room as:

* Small decorative objects
* Nursery accessories
* Soft patterned fabrics
* Shelf decorations
* Natural textures
* Subtle wall decals
* Cushions or rugs
* Small toys or ornaments

Keep the room clean, calm, cosy, realistic, premium, and uncluttered.

ANIMAL GUIDANCE

ANIMAL identifies the animal featured in the source artwork.

Do not allow ANIMAL to control the whole room design unless ROOM_THEME explicitly describes an animal-themed room.

You may include one small supporting accent representing ANIMAL, but only when it fits naturally with ROOM_THEME.

If an animal accent is included, it must depict the exact animal specified by ANIMAL.

Do not include any other animal species, animal toys, animal motifs, or animal icons unless they are:

* Explicitly included in ROOM_THEME
* Explicitly named in ANIMAL
* Already visible in the attached source artwork

Do not default to a particular animal or add unrelated animal decorations.

ARTWORK PLACEMENT

Place the attached artwork in a simple FRAME_COLOUR picture frame on the wall above the bed.

The frame must be:

* Straight
* Centred above the bed
* Realistic
* Elegant
* Clearly coloured according to FRAME_COLOUR
* Sized to hold the paper dimensions specified by PRINT_SIZE

Make the framed artwork the primary focus of the image.

Use exactly the selected PRINT_SIZE. Do not choose a different size based on what fills the wall best.

Preserve the artwork’s original aspect ratio. If its proportions do not match the selected paper, add clean white margins within the paper area. Never stretch, crop, or distort the artwork to fit.

Avoid a large external mount that makes the framed product appear substantially bigger than the selected print size.

Do not add any other pictures, posters, or competing wall art.

CAMERA AND LIGHTING

* Straight-on interior photography
* Slightly wide composition without lens distortion
* No extreme perspective
* No fisheye effect
* Soft daylight from a window
* Gentle, natural shadows
* Photorealistic Etsy product photography
* Calm, cosy, clean, premium appearance
* Clear visual reference between the framed print and the bed so the selected size remains believable

PRODUCT ACCURACY

This Etsy product is a digital download.

The framed artwork is only a lifestyle mockup showing how the downloaded artwork could look when printed at the selected PRINT_SIZE and framed.

Do not include anything implying that a physical frame, printed poster, or shipped product is supplied.

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
* Dark rooms
* Harsh shadows
* Warped frames
* Cropped or distorted artwork
* Incorrect A-series paper proportions
* Oversized frames that misrepresent the selected print size
* Overly bright cartoon colours
* Unrelated decorative details
* Packaging
* Parcels
* Postage labels
* Shipping boxes
* Delivery vehicles
* Wrapped prints
* An animal-only room unless explicitly required by ROOM_THEME
* Sea, space, farm, jungle, safari, woodland, coastal, underwater, or other themed décor unless explicitly required by ROOM_THEME, ANIMAL, or the attached source artwork

OUTPUT

* Create one square Etsy listing image.
* Target dimensions: 3000 × 3000 pixels.
* Minimum dimensions: 2000 × 2000 pixels.
* Use an sRGB colour profile.
* The overall mockup must remain square; only the framed paper uses portrait A-series proportions.
* Keep the artwork and all important content centred within generous safe margins so Etsy cropping does not cut anything off.
* Return only the generated image in the chat image viewer.`;
