import { describe, expect, it } from 'vitest';
import { buildDigitalDownloadGeneratePrompt } from '@/lib/digital-download-generate-prompt';
import { buildDetailsGeneratePrompt } from '@/lib/details-generate-prompt';
import { buildAspectRatiosImagePrompt, buildBedroomDoorImagePrompt, buildBedroomImagePrompt, buildBesideBedImagePrompt, buildCustomisedPlayroomImagePrompt, buildCustomisedShelveImagePrompt, buildDigitalDownloadIncludedImagePrompt, buildFramesImagePrompt, buildHowToPrintIncludedImagePrompt, buildListingImagePrompt, buildNoFrameIncludedImagePrompt, buildPerfectGiftImagePrompt, buildPersonalUseIncludedImagePrompt, buildPlayroomImagePrompt, buildSizesImagePrompt, buildThreeFramesImagePrompt } from '@/lib/listing-prompts';

describe('listing prompts', () => {
  it('inserts the effective room theme into both prompt values', () => {
    const prompt = buildListingImagePrompt('  Bugs  ');
    expect(prompt).toContain('ROOM_THEME = "Bugs"');
    expect(prompt).toContain('ROOM_THEME: Bugs');
    expect(prompt).not.toContain('{{ROOM_THEME}}');
  });

  it('preserves the prompt instructions', () => {
    const prompt = buildListingImagePrompt('Ocean nursery');
    expect(prompt).toContain('Use the image attached to this prompt as the source artwork.');
    expect(prompt).toContain('Generate one inline ChatGPT image only.');
    expect(prompt).toContain('Return only the generated image');
  });

  it('builds the bedroom prompt from the effective room theme and listing item', () => {
    const prompt = buildBedroomImagePrompt('  Sea Creatures  ', ' Green Sea Turtle ');
    expect(prompt).toContain('ROOM_THEME = "Sea Creatures"');
    expect(prompt).toContain('ANIMAL = "Green Sea Turtle"');
    expect(prompt).toContain('FRAME_COLOUR = "Natural Oak"');
    expect(prompt).toContain('PRINT_SIZE = "A3"');
    expect(prompt).toContain('A4 = 210 mm wide × 297 mm high.');
    expect(prompt).toContain('A3: 33% of the bed’s width.');
    expect(prompt).toContain('Place the attached artwork in a simple FRAME_COLOUR picture frame on the wall above the bed.');
    expect(prompt).toContain('The overall mockup must remain square; only the framed paper uses portrait A-series proportions.');
    expect(prompt).not.toContain('{{ROOM_THEME}}');
    expect(prompt).not.toContain('{{ANIMAL}}');
    expect(prompt).not.toContain('{{FRAME_COLOUR}}');
    expect(prompt).not.toContain('{{PRINT_SIZE}}');
  });

  it('builds the Bedroom door prompt with listing variables and door-specific instructions', () => {
    const prompt = buildBedroomDoorImagePrompt('  Bugs  ', ' Ant ');
    expect(prompt).toContain('ROOM_THEME = "Bugs"');
    expect(prompt).toContain('ANIMAL = "Ant"');
    expect(prompt).toContain('FRAME_COLOUR = "Black"');
    expect(prompt).toContain('Preserve all existing text exactly, including spelling, punctuation, capitalisation, font appearance, curvature, colour, and placement.');
    expect(prompt).toContain('The source artwork has a transparent background.');
    expect(prompt).toContain('Do not reproduce or interpret transparent areas as black.');
    expect(prompt).toContain('clearly photographed from the hallway');
    expect(prompt).toContain('mounted directly on the outside of the child’s bedroom door');
    expect(prompt).toContain('Use a realistic A4-sized white paper print inside the frame');
    expect(prompt).toContain('The door should occupy approximately 60–70% of the image width');
    expect(prompt).toContain('Ensure it is immediately obvious that the viewer is standing in a family hallway');
    expect(prompt).toContain('Ensure every transparent area in the source PNG appears as clean white printed paper, never black.');
    expect(prompt).toContain('This Etsy product is a digital download.');
    expect(prompt).not.toContain('{{ROOM_THEME}}');
    expect(prompt).not.toContain('{{ANIMAL}}');

    const escaped = buildBedroomDoorImagePrompt('Woodland "bugs"', 'Rory\\Ant');
    expect(escaped).toContain('ROOM_THEME = "Woodland \\"bugs\\""');
    expect(escaped).toContain('ANIMAL = "Rory\\\\Ant"');
  });

  it('builds the Beside bed prompt with listing variables and shelf instructions', () => {
    const prompt = buildBesideBedImagePrompt('Sea Creatures', 'Green Sea Turtle');
    expect(prompt).toContain('ROOM_THEME = "Sea Creatures"');
    expect(prompt).toContain('ANIMAL = "Green Sea Turtle"');
    expect(prompt).toContain('FRAME_COLOUR = "Black"');
    expect(prompt).toContain('SHELF BENEATH THE PICTURE');
    expect(prompt).toContain('Leave a realistic vertical gap of approximately 15–25 cm');
    expect(prompt).toContain('Include only three or four tasteful children’s items inspired by ROOM_THEME.');
    expect(prompt).not.toContain('{{ROOM_THEME}}');
    expect(prompt).not.toContain('{{ANIMAL}}');
  });

  it('builds the Customised playroom prompt with listing variables and play-table instructions', () => {
    const prompt = buildCustomisedPlayroomImagePrompt('Sea Creatures', 'Green Sea Turtle');
    expect(prompt).toContain('ROOM_THEME = "Sea Creatures"');
    expect(prompt).toContain('ANIMAL = "Green Sea Turtle"');
    expect(prompt).toContain('FRAME_COLOUR = "Black"');
    expect(prompt).toContain('CHILDREN’S PLAY TABLE');
    expect(prompt).toContain('PLAY-TABLE ACTIVITY');
    expect(prompt).toContain('no more than three or four small tabletop objects');
    expect(prompt).toContain('Style the table and activity according to ROOM_THEME.');
    expect(prompt).not.toContain('{{ROOM_THEME}}');
    expect(prompt).not.toContain('{{ANIMAL}}');
  });

  it('builds the Customised Shelve Image prompt with exactly one shelf and two items', () => {
    const prompt = buildCustomisedShelveImagePrompt('Sea Creatures', 'Green Sea Turtle');
    expect(prompt).toContain('ROOM_THEME = "Sea Creatures"');
    expect(prompt).toContain('ANIMAL = "Green Sea Turtle"');
    expect(prompt).toContain('FRAME_COLOUR = "Black"');
    expect(prompt).toContain('SINGLE SHELF');
    expect(prompt).toContain('Place exactly two small decorative children’s items on the shelf.');
    expect(prompt).toContain('Show exactly one shelf beneath the picture.');
    expect(prompt).toContain('Show exactly two small shelf items inspired by ROOM_THEME.');
    expect(prompt).not.toContain('{{ROOM_THEME}}');
    expect(prompt).not.toContain('{{ANIMAL}}');
  });

  it('builds the supplied playroom prompt with the same variable substitutions', () => {
    const prompt = buildPlayroomImagePrompt('Sea Creatures', 'Dolphin');
    expect(prompt).toContain('ROOM_THEME = "Sea Creatures"');
    expect(prompt).toContain('ANIMAL = "Dolphin"');
    expect(prompt).toContain('FRAME_COLOUR = "Natural Oak"');
    expect(prompt).toContain('PRINT_SIZE = "A3"');
    expect(prompt).toContain('PLAYROOM STYLE');
    expect(prompt).toContain('A3: 37% of the storage unit’s width.');
    expect(prompt).toContain('above the low toy-storage unit in the main play area');
    expect(prompt).toContain('SPECIAL GUIDANCE FOR WOODLAND BUGS');
    expect(prompt).toContain('The overall mockup must remain square; only the framed paper uses portrait A-series proportions.');
    expect(prompt).not.toContain('{{ROOM_THEME}}');
    expect(prompt).not.toContain('{{ANIMAL}}');
    expect(prompt).not.toContain('{{FRAME_COLOUR}}');
    expect(prompt).not.toContain('{{PRINT_SIZE}}');
  });

  it('builds the Perfect Gift prompt with listing variables and required display text', () => {
    const prompt = buildPerfectGiftImagePrompt('Woodland bugs', 'Ant');
    expect(prompt).toContain('ROOM_THEME = "Woodland bugs"');
    expect(prompt).toContain('ANIMAL = "Ant"');
    expect(prompt).toContain('FRAME_COLOUR = "Natural Oak"');
    expect(prompt).toContain('PRINT_SIZE = "A3"');
    expect(prompt).toContain('PRINT SIZE AND PROPORTIONS');
    expect(prompt).toContain('A3 = 297 mm wide × 420 mm high.');
    expect(prompt).toContain('The overall Etsy mockup must remain square. Only the print within the scene uses A3 or A2 portrait proportions.');
    expect(prompt).toContain('Perfect Gift\nfor Little Animal Lovers');
    expect(prompt).toContain('Nursery - Bedroom - Playroom');
    expect(prompt).toContain('The text is a listing overlay, not part of the source artwork.');
    expect(prompt).not.toContain('{{ROOM_THEME}}');
    expect(prompt).not.toContain('{{PRINT_SIZE}}');
  });

  it('builds the Frames prompt with listing variables and all frame options', () => {
    const prompt = buildFramesImagePrompt('Woodland bugs', 'Ant');
    expect(prompt).toContain('ROOM_THEME: Woodland bugs');
    expect(prompt).toContain('ANIMAL: Ant');
    expect(prompt).toContain('FRAME_COLOURS: Black, White, Dark Brown, Natural Wood');
    expect(prompt).toContain('SOURCE_IMAGE_FILE: Copied thumbnail image');
    expect(prompt).toContain('Create a tidy 2x2 grid.');
    expect(prompt).toContain('frame_colour_options.jpg');
    expect(prompt).not.toContain('{{ROOM_THEME}}');
    expect(prompt).not.toContain('{{ANIMAL}}');
    expect(prompt).not.toContain('{{FRAME_COLOURS}}');
    expect(prompt).not.toContain('{{REFERENCE_IMAGE}}');
  });

  it('builds the 3 Frames comparison prompt with the listing theme and animal', () => {
    const prompt = buildThreeFramesImagePrompt('  Woodland "bugs"  ', ' Rory\\Ant ');
    expect(prompt).toContain('ROOM_THEME = "Woodland \\"bugs\\""');
    expect(prompt).toContain('ANIMAL = "Rory\\\\Ant"');
    expect(prompt).toContain('FRAME_COLOURS = "Black, White, Natural Wood"');
    expect(prompt).toContain('SOURCE_IMAGE_FILE = "Copied thumbnail image"');
    expect(prompt).toContain('1. Unframed Print');
    expect(prompt).toContain('4. Natural Wood Frame');
    expect(prompt).toContain('Treat transparent areas as empty space rather than as a black background.');
    expect(prompt).toContain('Use one consistent, plain, pale warm-greige background across the complete 2 × 2 grid.');
    expect(prompt).toContain('approximately equivalent to `#DED9D0`');
    expect(prompt).toContain('The artwork itself already conveys the specified room theme.');
    expect(prompt).toContain('Show exactly one unframed print and exactly three framed prints.');
    expect(prompt).not.toContain('Dark Brown Frame');
    expect(prompt).not.toContain('Sea Creatures theme');
    expect(prompt).not.toContain('ROOM\\_THEME');
    expect(prompt).not.toContain('FRAME\\_COLOURS');
    expect(prompt).not.toContain('SOURCE\\_IMAGE\\_FILE');
    expect(prompt).not.toContain('{{ROOM_THEME}}');
    expect(prompt).not.toContain('{{ANIMAL}}');
    expect(prompt).not.toContain('{{FRAME_COLOURS}}');
    expect(prompt).not.toContain('{{SOURCE_IMAGE_FILE}}');
  });

  it('builds the Sizes prompt with listing variables and accurate size guidance', () => {
    const prompt = buildSizesImagePrompt('Woodland bugs', 'Ant');
    expect(prompt).toContain('ROOM_THEME = "Woodland bugs"');
    expect(prompt).toContain('ANIMAL = "Ant"');
    expect(prompt).toContain('FRAME_COLOUR = "Natural Oak"');
    expect(prompt).toContain('A5, A4, A3, A2, A1');
    expect(prompt).toContain('A1 must therefore be four times the width and four times the height of A5');
    expect(prompt).not.toContain('{{ROOM_THEME}}');
    expect(prompt).not.toContain('{{ANIMAL}}');
    expect(prompt).not.toContain('{{FRAME_COLOUR}}');
  });

  it('builds the Aspect ratios graphic prompt with the five supplied ratio categories', () => {
    const prompt = buildAspectRatiosImagePrompt();
    expect(prompt).toContain('1. ISO A-SERIES');
    expect(prompt).toContain('2. 2:3 RATIO');
    expect(prompt).toContain('3. 3:4 RATIO');
    expect(prompt).toContain('4. 4:5 RATIO');
    expect(prompt).toContain('5. 11:14 RATIO');
    expect(prompt).toContain('A1 — 594 × 841 mm');
    expect(prompt).toContain('24 × 36"');
    expect(prompt).toContain('NO PHYSICAL ITEM WILL BE SHIPPED');
    expect(prompt).toContain('Do not include 5:7 or any other ratio.');
    expect(prompt).not.toMatch(/\{\{[^}]+\}\}/);
  });

  it('builds the No Frame Included prompt with listing variables and frame colours', () => {
    const prompt = buildNoFrameIncludedImagePrompt('Woodland bugs', 'Ant');
    expect(prompt).toContain('ROOM_THEME = "Woodland bugs"');
    expect(prompt).toContain('ANIMAL = "Ant"');
    expect(prompt).toContain('FRAME_COLOURS = ["Black", "White", "Dark Brown", "Natural Wood"]');
    expect(prompt).toContain('No Frame Included\n\nDigital download only');
    expect(prompt).toContain('No physical item will be shipped');
    expect(prompt).not.toContain('{{ROOM_THEME}}');
    expect(prompt).not.toContain('{{ANIMAL}}');
    expect(prompt).not.toContain('{{FRAME_COLOURS}}');
  });

  it('builds the Digital Download Included prompt with listing variables and file details', () => {
    const prompt = buildDigitalDownloadIncludedImagePrompt('Woodland bugs', 'Ant');
    expect(prompt).toContain('ROOM_THEME = "Woodland bugs"');
    expect(prompt).toContain('ANIMAL = "Ant"');
    expect(prompt).toContain('FILES_INCLUDED = "5 high-resolution JPG files in multiple print ratios"');
    expect(prompt).toContain('Digital Download\n\nNo physical item shipped');
    expect(prompt).toContain('Instant access after purchase');
    expect(prompt).not.toContain('{{ROOM_THEME}}');
    expect(prompt).not.toContain('{{ANIMAL}}');
    expect(prompt).not.toContain('{{FILES_INCLUDED}}');
  });

  it('builds the How to Print Included prompt with listing and printing variables', () => {
    const prompt = buildHowToPrintIncludedImagePrompt('Woodland bugs', 'Ant');
    expect(prompt).toContain('ROOM_THEME = "Woodland bugs"');
    expect(prompt).toContain('ANIMAL = "Ant"');
    expect(prompt).toContain('FILES_INCLUDED = "A5, A4, A3, A2 and A1"');
    expect(prompt).toContain('RECOMMENDED_PAPER = "Heavyweight matte photo paper, approximately 200–250 gsm"');
    expect(prompt).toContain('1. Download your files after purchase');
    expect(prompt).toContain('Digital download only — no physical item shipped');
    expect(prompt).not.toContain('{{ROOM_THEME}}');
    expect(prompt).not.toContain('{{ANIMAL}}');
    expect(prompt).not.toContain('{{FILES_INCLUDED}}');
    expect(prompt).not.toContain('{{RECOMMENDED_PAPER}}');
  });

  it('builds the Personal Use Included prompt with listing variables and licence wording', () => {
    const prompt = buildPersonalUseIncludedImagePrompt('Woodland bugs', 'Ant');
    expect(prompt).toContain('ROOM_THEME = "Woodland bugs"');
    expect(prompt).toContain('ANIMAL = "Ant"');
    expect(prompt).toContain('Personal Use Only\n\nYou may:');
    expect(prompt).toContain('Upload to print-on-demand sites');
    expect(prompt).toContain('Digital download only');
    expect(prompt).not.toContain('{{ROOM_THEME}}');
    expect(prompt).not.toContain('{{ANIMAL}}');
  });

  it('builds the Digital Downloads Generate prompt with a valid animal variable', () => {
    const prompt = buildDigitalDownloadGeneratePrompt('Ant');
    expect(prompt).toContain('ANIMAL = "Ant – the animal featured in the supplied source artwork"');
    expect(prompt).toContain('ORIENTATION = "portrait"');
    expect(prompt).toContain('FILE_TYPE = "jpeg"');
    expect(prompt).toContain('ANIMAL_TITLE_Nursery_Wall_Art_JPEG_Printable_Bundle.zip');
    expect(prompt).toContain('Return only one download link to the completed ZIP file.');
    expect(prompt).not.toContain('{{ANIMAL}}');
  });

  it('builds the Details prompt from the available listing values', () => {
    const prompt = buildDetailsGeneratePrompt({
      sectionName: 'Bugs Wall Art',
      listingName: 'Ant',
      animal: 'Ant',
      roomTheme: 'Woodland bugs',
      digitalDownload: false,
      paperDetails: 'Heavyweight matte art paper, at least 200gsm',
      printSizes: 'A4, A3',
      frameColours: 'Black, Natural Oak',
      personalisationDetails: 'Optional top and bottom text personalisation is available.',
      digitalFilesIncluded: 'Ant_2x3.jpeg, How_To_Print_Guide.txt',
    });
    expect(prompt).toContain('SECTION_NAME = "Bugs Wall Art"');
    expect(prompt).toContain('LISTING_NAME = "Ant"');
    expect(prompt).toContain('ANIMAL = "Ant"');
    expect(prompt).toContain('ROOM_THEME = "Woodland bugs"');
    expect(prompt).toContain('DIGITAL_DOWNLOAD = "N"');
    expect(prompt).toContain('PRINT_SIZES = "A4, A3"');
    expect(prompt).toContain('FRAME_COLOURS = "Black, Natural Oak"');
    expect(prompt).toContain('PERSONALISATION_DETAILS = "Optional top and bottom text personalisation is available."');
    expect(prompt).not.toContain('{{SECTION_NAME}}');
  });
});
