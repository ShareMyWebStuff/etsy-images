export type RoomTheme = { name: string; adjective: string };

const ROOM_THEMES: Record<string, RoomTheme> = {
  'dinosaur wall art': { name: 'dinosaurs', adjective: 'dinosaur' },
  'bugs wall art': { name: 'bugs', adjective: 'bug' },
  'farm animal wall art': { name: 'farm animals', adjective: 'farm-animal' },
  'jungle animals wall art': { name: 'jungle animals', adjective: 'jungle-animal' },
  'see creatures wall art': { name: 'sea creatures', adjective: 'sea-creature' },
  'sea creatures wall art': { name: 'sea creatures', adjective: 'sea-creature' },
  'woodland wall art': { name: 'woodland animals', adjective: 'woodland-animal' },
};

export function getRoomThemeForSourceSection(sectionName: string): RoomTheme {
  const normalized = sectionName.trim().toLocaleLowerCase();
  const configured = ROOM_THEMES[normalized];
  if (configured) return configured;
  const name = normalized.replace(/\s+wall art$/, '').trim() || 'animals';
  return { name, adjective: name.replace(/s$/, '').replace(/\s+/g, '-') };
}

export function applyRoomThemeToPrompt(prompt: string, theme: RoomTheme) {
  const capitalizedName = theme.name.charAt(0).toUpperCase() + theme.name.slice(1);
  const capitalizedAdjective = theme.adjective.charAt(0).toUpperCase() + theme.adjective.slice(1);
  return prompt
    .replace(/\bDinosaurs\b/g, capitalizedName)
    .replace(/\bDinosaur\b/g, capitalizedAdjective)
    .replace(/\bdinosaurs\b/g, theme.name)
    .replace(/\bdinosaur\b/g, theme.adjective);
}

const MULTI_BEDROOM_PROMPT = `# PROMPT — All Attached Artworks in a Dinosaur-Themed Child’s Bedroom

Generate one inline ChatGPT image only.

Return only the generated image. Do not create files, links, filenames, or downloads.

## DECLARED VARIABLES

ANIMALS: T-Rex, Triceratops, Stegosaurus, Brachiosaurus, Spinosaurus, Velociraptor
ROOM_THEME: dinosaurs
FRAME_COLOUR: dark brown wood

## IMAGE INPUTS

Use every image attached to this prompt as a separate artwork.

The number of artworks is determined by the number of attached images.

Use each attached image exactly once and preserve the original attachment order from left to right, then top to bottom if multiple rows are needed.

Do not show filenames, file paths, attachment labels, URLs, or variable names.

## TASK

Create one square, photorealistic Etsy mockup of a premium Scandinavian-style young child’s bedroom.

The room must contain one clearly recognisable child-sized single bed.

Use a small single children’s bed, toddler bed, low Montessori bed, or compact child-sized wooden bed.

The bed must:

* be narrow and proportioned for one young child
* have one single pillow
* have a small single mattress
* look noticeably smaller than an adult bed
* leave visible floor space on both sides
* appear approximately 75–90 cm wide in the implied room scale

Do not use:

* a double bed
* a queen-size bed
* a king-size bed
* a full-size adult bed
* a wide hotel-style bed
* two pillows side by side
* oversized adult bedding
* an adult bedroom layout

Place every attached artwork in a matching frame on the wall above the child-sized single bed.

Do not omit, duplicate, replace, merge, swap, or invent any artwork.

## LAYOUT

Arrange the framed artworks in the clearest balanced layout above the bed.

Use one horizontal row when all artworks can remain large and visible.

When there are too many artworks for one row, use neat, symmetrical, evenly aligned rows.

Keep the complete gallery centred above the child-sized bed.

Ensure every frame is:

* fully visible
* equally prominent
* straight and level
* evenly spaced
* consistently aligned
* surrounded by safe margins
* large enough for the artwork to remain recognisable

Do not place frames behind furniture, bedding, plants, toys, lamps, shelves, or other objects.

## FRAMES AND ARTWORKS

Every frame must:

* use dark brown wood
* have an identical style
* have a consistent visual weight
* look premium and realistic
* have minimal glare or reflection

Preserve every attached artwork exactly as supplied.

Do not redraw, recolour, reinterpret, replace, duplicate, merge, stretch, distort, rotate, or heavily crop any artwork.

Preserve each artwork’s original aspect ratio.

Use proportional white mounts or matting where needed.

External frame dimensions may vary only when necessary to preserve the artwork accurately and keep the gallery balanced.

Do not add text, decorations, characters, objects, or other elements inside the supplied artworks.

Do not create additional wall art.

## ROOM STYLE

Use dinosaurs as the main room theme.

Create a premium Scandinavian-style child’s bedroom using:

* warm neutral walls
* pale natural wood furniture
* soft natural fabrics
* child-friendly single-bed bedding
* soft daylight
* gentle realistic shadows
* clean and uncluttered styling

Add two or three subtle dinosaur-themed room details, such as:

* a small dinosaur cushion
* a subtle dinosaur-patterned rug
* a wooden dinosaur toy
* a tasteful dinosaur wall decal away from the framed artworks
* a dinosaur-themed basket or nursery accessory

Animal accents are optional.

When used, only include animals listed in ANIMALS.

Keep dinosaur accents subtle and secondary to the framed artworks.

Do not add unrelated animals or themes.

## CAMERA

Use a straight-on interior photography angle.

Keep the child-sized single bed and complete framed artwork arrangement centred and fully visible.

The bed proportions must clearly show that it is designed for one young child.

Use realistic interior-photography perspective.

Avoid:

* fisheye distortion
* extreme perspective
* tilted walls
* cropped frames
* strong glare
* reflections covering artworks
* objects obscuring artworks

## PRODUCT ACCURACY

This is a digital-download product.

The frames, printed pictures, child’s bed, furniture, bedding, and accessories are mockup examples only.

Do not show:

* packaging
* parcels
* postage labels
* shipping boxes
* mailing tubes
* wrapped prints
* delivery materials
* anything suggesting physical shipment

## AVOID

* double, queen-size, king-size, or adult beds
* wide mattresses
* two pillows beside each other
* oversized adult bedding
* people, children, faces, or pets
* text, captions, labels, logos, or watermarks
* missing, duplicated, invented, or swapped artworks
* altered or distorted artwork
* mismatched, crooked, or uneven frames
* clutter
* dark lighting
* harsh shadows
* excessive dinosaur decorations
* additional wall art

## OUTPUT

Create one square Etsy listing image.

Keep the child-sized single bed and complete framed artwork arrangement centred with safe margins.

Ensure every attached artwork is:

* used exactly once
* fully visible
* clearly recognisable
* correctly ordered
* accurately preserved
* prominently presented

Return only the generated image.`;

export function getMultiBedroomPrompt(names: string[], theme: RoomTheme = ROOM_THEMES['dinosaur wall art']) {
  return applyRoomThemeToPrompt(MULTI_BEDROOM_PROMPT.replace(
    /^ANIMALS:.*$/m,
    `ANIMALS: ${names.join(', ')}`
  ), theme);
}

const MULTI_PLAYROOM_PROMPT = `# PROMPT — All Attached Artworks in a Dinosaur-Themed Child’s Playroom

Generate one inline ChatGPT image only.

Return only the generated image. Do not create files, links, filenames, or downloads.

## DECLARED VARIABLES

ANIMALS: Brachiosaurus, Spinosaurus, Velociraptor
ROOM_THEME: dinosaurs
FRAME_COLOUR: dark brown wood

## IMAGE INPUTS

Use every image attached to this prompt as a separate artwork.

The number of artworks is determined by the number of attached images.

Use each attached image exactly once and preserve the original attachment order from left to right, then top to bottom if multiple rows are needed.

Do not show filenames, file paths, attachment labels, URLs, or variable names.

## TASK

Create one square, photorealistic Etsy mockup of a premium Scandinavian-style young child’s playroom.

The room must contain one clearly recognisable main child-sized play area.

Use a small child-sized table and chair, low toy shelf, compact reading corner, floor-cushion play area, or similar young child’s playroom arrangement.

The main play area must:

* be proportioned for one young child
* use child-sized furniture
* look noticeably smaller than adult furniture
* leave visible floor space around it
* appear suitable for playing, reading, drawing, or quiet activities
* remain visually secondary to the framed artworks

Do not use:

* adult-sized tables or chairs
* office furniture
* a bed
* a sofa as the main focal point
* oversized furniture
* an adult room layout
* a bedroom layout

Place every attached artwork in a matching frame on the wall above the main child-sized play area.

Do not omit, duplicate, replace, merge, swap, or invent any artwork.

## LAYOUT

Arrange the framed artworks in the clearest balanced layout above the main play area.

Use one horizontal row when all artworks can remain large and visible.

When there are too many artworks for one row, use neat, symmetrical, evenly aligned rows.

Keep the complete gallery centred above the main child-sized play area.

Ensure every frame is:

* fully visible
* equally prominent
* straight and level
* evenly spaced
* consistently aligned
* surrounded by safe margins
* large enough for the artwork to remain recognisable

Do not place frames behind furniture, cushions, plants, toys, lamps, shelves, or other objects.

## FRAMES AND ARTWORKS

Every frame must:

* use dark brown wood
* have an identical style
* have a consistent visual weight
* look premium and realistic
* have minimal glare or reflection

Preserve every attached artwork exactly as supplied.

Do not redraw, recolour, reinterpret, replace, duplicate, merge, stretch, distort, rotate, or heavily crop any artwork.

Preserve each artwork’s original aspect ratio.

Use proportional white mounts or matting where needed.

External frame dimensions may vary only when necessary to preserve the artwork accurately and keep the gallery balanced.

Do not add text, decorations, characters, objects, or other elements inside the supplied artworks.

Do not create additional wall art.

## ROOM STYLE

Use dinosaurs as the main room theme.

Create a premium Scandinavian-style child’s playroom using:

* warm neutral walls
* pale natural wood furniture
* soft natural fabrics
* child-sized playroom furniture
* tidy toy storage baskets
* bookshelves or a low toy shelf
* cushions or a small rug
* a small table and chair, reading corner, or floor play area
* soft daylight
* gentle realistic shadows
* clean and uncluttered styling

Add two or three subtle dinosaur-themed room details, such as:

* a small dinosaur cushion
* a subtle dinosaur-patterned rug
* a wooden dinosaur toy
* a tasteful dinosaur wall decal away from the framed artworks
* a dinosaur-themed basket or nursery accessory

Animal accents are optional.

When used, only include animals listed in ANIMALS.

Keep dinosaur accents subtle and secondary to the framed artworks.

Do not add unrelated animals or themes.

## CAMERA

Use a straight-on interior photography angle.

Keep the main child-sized play area and complete framed artwork arrangement centred and fully visible.

The furniture proportions must clearly show that the room is designed for a young child.

Use realistic interior-photography perspective.

Avoid:

* fisheye distortion
* extreme perspective
* tilted walls
* cropped frames
* strong glare
* reflections covering artworks
* objects obscuring artworks

## PRODUCT ACCURACY

This is a digital-download product.

The frames, printed pictures, playroom furniture, toys, storage, cushions, rugs, and accessories are mockup examples only.

Do not show:

* packaging
* parcels
* postage labels
* shipping boxes
* mailing tubes
* wrapped prints
* delivery materials
* anything suggesting physical shipment

## AVOID

* beds or bedroom layouts
* adult-sized tables or chairs
* oversized furniture
* office furniture
* people, children, faces, or pets
* text, captions, labels, logos, or watermarks
* missing, duplicated, invented, or swapped artworks
* altered or distorted artwork
* mismatched, crooked, or uneven frames
* clutter
* dark lighting
* harsh shadows
* excessive dinosaur decorations
* additional wall art

## OUTPUT

Create one square Etsy listing image.

Keep the main child-sized play area and complete framed artwork arrangement centred with safe margins.

Ensure every attached artwork is:

* used exactly once
* fully visible
* clearly recognisable
* correctly ordered
* accurately preserved
* prominently presented

Return only the generated image.`;

export function getMultiPlayroomPrompt(names: string[], theme: RoomTheme = ROOM_THEMES['dinosaur wall art']) {
  return applyRoomThemeToPrompt(MULTI_PLAYROOM_PROMPT.replace(
    /^ANIMALS:.*$/m,
    `ANIMALS: ${names.join(', ')}`
  ), theme);
}
