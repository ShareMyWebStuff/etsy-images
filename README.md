I want to change the structure of the data me hold. Currently we have the following

## Our Template Images

Run `npm run db:our-template-images` after updating the application. This repeatable, additive migration creates the saved scene library, template references and local image-generation revisions. Existing template images keep their existing renderer.

Open **Local > Our Template Images**, choose **Create template image**, name the scene and upload its original Canva PNG. Click inside each print opening, then correct its four handles if necessary. **Place four corners manually** handles ambiguous photographs. Select each opening's artwork item, paper ratio and orientation; move or zoom the paper behind the fixed opening. Corners use original image pixels, and each ratio/orientation saves its own paper placement. Perspective proportions are estimated from the frame plane, so the suggested ratio remains manually adjustable.

Corner corrections preserve the paper's relative zoom and pan for every saved ratio and orientation. Near-frontal frames use stable edge proportions instead of estimating perspective from subpixel edge differences. **Paper zoom** displays a percentage: 100% is the smallest paper covering the opening; larger values crop more of the artwork. **Centre and cover opening** or **Fit artwork to openings** restores that minimum size.

Saving keeps the full PNG in S3 and creates a WebP browsing preview at up to 512 pixels on its longest side (quality 78, original proportions, no enlargement). The library and saved-scene chooser load these previews; library thumbnails load as you scroll. Search the library by template name or PNG filename. Editing, corner precision and listing rendering use the full original. Older scenes get a stored preview on first use if one is missing.

Run `npm run db:our-template-image-tags` to add the shared tag catalogue and image/tag links and seed the 35 default tags. This additive migration can be repeated without duplicating or replacing tags. Each scene can have up to 10 tags: type any part of a tag name and press Enter or click a suggestion, or choose **Create tag** to extend the shared catalogue. Remove a selected tag with its cross, then **Save template image** to keep the assignments. Tags are stored separately from rendering settings, so tag changes do not trigger listing-image regeneration.

The library can filter by tags and search names, filenames or tag text. In **Our Templates > Add Our Template Image**, choose **Browse all** for a scrolling thumbnail grid or **Search by tags** to narrow it down. Multiple tag filters require all selected tags to match. Click a thumbnail to select it, then choose **Add scene to template**; clearing or changing filters cannot attach a hidden selection.

Transparent openings preserve the original foreground, including translucent shadows and objects. A flattened PNG replaces all pixels inside each selected opening, including baked-in shadows. To recover those shadows, choose **White / black Canva exports** and provide identical-size exports of the same scene with white and black artwork. **Test** accepts uploads or named listing artwork and uses the same renderer as normal generation. Saved listing crops and paper margins apply when the selected orientation matches; uploads and other orientations use a centred crop. Tests do not change listing files or generation state.

For a flattened PNG with objects crossing the print, choose **Keep in front** above the room image. Paint over the overlapping objects; **Erase**, **Undo**, **Redo** and **Clear mask** correct the selection. Brush size and edge softness control its boundary, and zoom with **Pan** (or hold Space) helps with detailed edges. **Show mask** toggles the coloured overlay. Return to the template editor and choose **Save template image**. The protected original pixels then appear above the artwork in both Test and listing generation. Mask edits flag direct and linked followers for local image regeneration; fitting the paper keeps the foreground mask intact.

**Smart select** uses the original image's colours and edges to suggest a connected foreground area. Click the part of an object overlapping a print opening, adjust **Sensitivity**, check the amber preview, then choose **Apply selection**. The suggestion stays within the configured openings. It can need manual correction where the object and background look similar; **Paint** and **Erase** remain available. **Fill gaps** fills holes enclosed by existing protection. Suggestions are temporary until applied, and the resulting mask is saved with **Save template image**.

In **Our Templates**, use **Add Our Template Image** to attach a saved scene. Render changes mark direct and linked followers for local image regeneration; display renames do not. The listing overview shows the pending state, separate from Etsy sync. It clears only after every remaining template image has generated successfully for the current revision. Deletion confirms dependency counts and removes source and linked references plus their generated images before the next regeneration. Keep at least one image template if the listing is to generate listing photos.

Deleting a saved template image removes its direct and linked template references, generated listing photos, browsing previews and saved source PNGs from S3. Cleanup also checks reserved `template-<ID>.png` files without database rows and rows whose template association was lost. Storage failures are reported so deletion can be retried. On the listing overview, **Generate Images** and **Generate** clear the previous listing photos and their previews before rebuilding the current template list, including when no image templates remain. They also remove untracked generated files in that listing's current folder; artwork thumbnails and digital downloads are preserved. Photos already uploaded to Etsy change through the normal Etsy sync.

In a listing's **Overview > Template Settings**, choose a **Listing template** from the current shop and click **Change template**. The change applies to that listing, removes its previous generated photos and previews, and marks generation pending. Uploaded artwork, manual photos, saved crops and existing download files are kept. Product settings follow the new template while preserving applicable listing overrides and existing product SKUs. A set keeps its selected artworks only when they match the new template's item count and source template; otherwise select its artworks again. Use **Generate Images** to rebuild the mockups, or **Generate** to rebuild the listing content and downloads. If size or personalisation text-area setup is missing, these buttons open the required setup first and continue generation after you save. Cancelling setup does not start generation or clear existing images.

## Browse section images

On a shop section's **Listings** page, the image button between **Generate** and **Edit** opens a scrollable gallery of listing artwork and titles from all subsections in that section. Gallery cards load the saved 512-pixel WebP previews as you scroll. Click an image to open the original in a full-screen view; click again or press Escape to return to the same place in the gallery. Each card's trash button asks for confirmation before deleting the entire local listing and its stored images using the table's existing cleanup process. Listings on Etsy or published listings cannot be deleted here. Listings without artwork show a placeholder. The image button on an individual listing row opens its full artwork preview.

## Import listings from ZIP

Each review entry shows its title and description beside the same Set Size editor used on the listing page. Select a paper ratio and position its crop; black outside the border shows what will be excluded. **Insert** saves the artwork and all six size settings together, so they are ready when the listing is opened. **Skip** ignores the entry, and **Finish** ends the review while retaining listings already inserted. The size editor accepts 2:3 and 4:5 source artwork in portrait or landscape; other dimensions are flagged for skipping. Crops are kept for the original Insert attempt if its result needs to be retried or confirmed.

On a shop section's **Listings** page, choose **Import**, select a template and choose a ZIP archive. Supported browsers start the file chooser in Downloads. Click **Import listings** to review the title, description and artwork for each CSV row. **Insert** creates that one listing in the current shop, section and subsection; **Skip** ignores the row. Progress shows how many entries have been inserted and skipped. Closing the review keeps listings already inserted and leaves the remaining entries unimported. The ZIP must contain one `overview.csv`, either at the archive root or inside an enclosing folder, and its referenced PNG, JPG or WebP artwork. The first CSV record is skipped as a header; the remaining records use these three columns in order:

```csv
title,description,relative filename
Maples at the Temple Gate,"Autumn maples beside a quiet temple gate.",images/maples.png
Morning by the River,"A misty river, with distant hills.",images/river.jpg
```

Image paths are relative to the folder containing `overview.csv`. Quoted commas, quoted line breaks, Windows path separators and CRLF, LF or CR line endings are supported. The title supplies the listing name, the description is saved for Overview and Details, and each image becomes that listing's artwork thumbnail. Orientation is detected after correcting camera rotation. Images use the same safe decoder pixel limit as manual uploads; valid PNGs that need no rotation keep their original bytes and colour profiles after full validation. Imported listings start with a cream background and inherit Print / Frames, Customised Prints and Digital Downloads from the chosen template. Single-item templates are available because each CSV row supplies one artwork; sets still use the grouped-listing workflow.

The archive is checked before review. Row errors, including existing listing names or invalid artwork, are shown on the affected entry so it can be skipped; archive structure errors must be corrected before review starts. Duplicate titles are checked without regard to case against both current listing titles and original listing folder names within the selected shop section, including its subsections. Titles repeated later in the ZIP also remain visible as individual review rows with their artwork and an error. Insert is disabled for these entries; Skip moves to the next item. Matching titles in other sections or shops are allowed. Names are checked again on Insert to avoid overwriting existing listings. Use UTF-8 CSV text, titles of up to 100 characters and descriptions of up to 1,000 characters. Limits are 100 listings, a 500 MB ZIP, 500 MB expanded contents, a 2 MB CSV and 60 MB per inserted source image. Larger images are displayed for review with a warning and Insert disabled; choose Skip to continue to the next item. Review data is held temporarily in server memory and expires after 30 minutes without activity; skipped entries create no database records or S3 files. Refreshing or restarting the application requires choosing the ZIP again. Inserted listings appear in the table immediately and can be opened in the usual listing editor. Publication to Etsy uses the normal sync workflow.

Deleting a local listing removes its S3 artwork thumbnail, generated and uploaded photos, downloads, videos, ZIPs, browsing previews and folder markers before removing the database record. Files reused by a saved scene, template, Pinterest creative or order are preserved. A shared listing folder must be separated before either listing can be deleted. Storage or database failures trigger file restoration and report an error; concurrent uploads are preserved. Unreferenced files are cleaned up so they do not block a later ZIP import with the same titles.

## Publish sections to Etsy

Click a section's **Publish** button and enter the **Number of listings to publish**, from 1 to the number currently available. The popup defaults to 1 and previews the first chosen number of eligible listings in order. Confirm to publish that selection one listing at a time, with progress shown after each success. If availability changes, an amount above the new maximum must be corrected before publishing.

On **Publish to Etsy**, each section header shows a Publish button and vertical Published, Synced and Not Synced counts in both Local View and Etsy View. Counts include each local listing once: Published means all its represented Etsy products are live; Synced means all are live or synced drafts, with at least one draft; Not Synced includes the remaining listings. The button is enabled when the section has complete, enabled, synced drafts without pending changes. Confirm the displayed listings to publish only those draft products, with progress shown as each listing finishes. Readiness is checked again before each request. Existing published products are skipped, including after partial publication, and inactive listings keep their individual Re-activate action. Successful responses update the counts; a failure stops the batch and preserves the completed results.

## Markets & Delivery

Reusable shop delivery profiles, explicit Etsy sync, and inherited listing delivery settings are available under **Etsy → Markets & Delivery**. See [setup, usage and integration limits](docs/markets-delivery.md). Run `npm run db:markets-delivery` after updating the application.

## Pinterest marketing module

Pinterest is available from the main navigation at `/pinterest`. It uses the existing Etsy listings, categories, images, and real Etsy URLs; the migration is additive and does not alter existing Etsy records.

1. Register the callback `http://localhost:3002/api/pinterest/callback` in the Pinterest developer application.
2. Copy the `PINTEREST_*` entries from `.env.example` into `.env.local`. Start with `PINTEREST_ENVIRONMENT="sandbox"`. Use long, different random values for the encryption and cron secrets.
3. Run `npm run db:pinterest` once. This creates only the six Pinterest tables using `CREATE TABLE IF NOT EXISTS`.
4. Start the application and use **Pinterest → Connection → Connect Pinterest**. Tokens are AES-256-GCM encrypted in MySQL and never returned to the browser.
5. Sync or create boards, then save drafts or schedule Pins. A Pin cannot be published until its listing contains a genuine Etsy URL.

The queue worker accepts `GET` or `POST /api/pinterest/queue` with `Authorization: Bearer <PINTEREST_CRON_SECRET>`. Schedule it externally at the desired interval. The unique publication key and stored Pinterest Pin ID prevent a completed Pin from being published twice. Analytics snapshots are cached for six hours. The Trends screen maps an Ireland preference to Great Britain because Pinterest's keyword Trends endpoint currently supports Great Britain, not Ireland.

Run `npm run test:pinterest` for deterministic scheduler, idempotency-key, and encryption checks, and `npm run build` for the full application verification.

Pinterest Pins can have dedicated creatives stored privately, separately from Etsy listing images. Run `npm run db:pinterest-pin-creatives` after updating the application. The additive migration preserves existing Pins. Open **Pinterest → Pins**, expand a board, and use **Review** to see the image, Pin copy and exact Etsy destination. Dedicated images are checked against their saved content hash before preview or publication.

New Pins generate their descriptions with AWS Bedrock using the existing `AWS_REGION` (or `AWS_DEFAULT_REGION`), AWS credentials and `AWS_BEDROCK_MODEL_ID` settings. The default model is `anthropic.claude-sonnet-4-6`. The generator matches the Etsy destination to the physical or digital listing, uses its subject and the board context, and aims for 200–400 characters. Descriptions have a strict 500-character limit, including spaces. Invalid generated text gets one correction attempt; failures leave the Pin unsaved rather than cutting off a sentence or substituting fixed copy. Synced listings use their exact Etsy destination; unsynced drafts use their local product settings. Publishing still requires a genuine Etsy URL.

To change existing copy, open **Pinterest → Pins → board → Review**, then use **Regenerate description** or edit the text and choose **Save description**. Regeneration is a preview until saved. Unpublished draft, paused and failed Pins can be edited; pause a scheduled Pin before editing. Published Pins are read-only here. Saving preserves the Pin’s image, destination, campaign and schedule. Publishing and queue processing use the saved text without generating it again. Existing descriptions are not automatically rewritten, and description generation does not change Etsy listings.

Changing `PINTEREST_ENVIRONMENT` requires reconnecting Pinterest for that environment. The app rejects credentials from a different environment, clears old refresh credentials when the account or environment changes, and prevents a stale refresh from overwriting a newer connection. Remote edits first check that the board is available through the current connection. The queue claims only due scheduled Pins; a Pin paused before that claim is skipped. Manual publication remains an explicit action. Keep old test schedules paused during a production switch and verify board availability before resuming them.

The prepared nursery batch is in `output/pinterest/2026-11-nursery/review.html`: three boards, fifteen products and forty-five 1000 × 1500 draft creatives. `copy.json`, `source-manifest.json` and `creative-manifest.json` retain the copy, original asset references and image hashes. `node scripts/prepare-pinterest-creatives.cjs` rebuilds the layouts from unchanged source assets. The draft importer validates the batch without changes by default; its explicit `--apply` mode creates sandbox boards and unscheduled drafts, preserves existing Pins, and never calls Pinterest's Pin-publishing endpoint. Production publishing requires a production connection and board IDs from that account.

## Free Etsy customisation

Customisation has no extra charge. Physical listings that offer customisation send **Font Style (default: Nunito)**, **Top Text**, and **Bottom Text**, in that order, under Etsy personalisation. All three fields are optional; the font dropdown contains only supported fonts. Top and bottom text are limited to 40 characters each and follow the template and listing settings. If a buyer supplies wording without selecting a font, order processing uses Nunito. Leaving both text fields blank adds no wording, regardless of the font selection. Existing border handling is unchanged. Legacy orders with wording and an explicit **No Customisation** selection or an unsupported font still require review. Standard size, frame, and border prices are unchanged.

The sync explicitly clears existing add-on prices, following [Etsy's personalisation pricing guidance](https://developers.etsy.com/documentation/tutorials/personalization-addon-pricing/).

Run `npm run db:etsy-personalisation-sync` after updating the application. This additive, repeatable migration preserves existing Etsy IDs and sync timestamps. Affected existing physical listings show **Needs sync: Personalisation** on **Sync to Etsy** until successfully synced with the new fields. Digital listings and prints without customisation are not marked for this update. Refresh the listings, then sync the affected rows or use **Sync All**; the app updates their existing Etsy listings. This migration does not upload anything automatically.

## Admin Set Prices

The Set Prices screen is available at `/admin/set-prices`. It stores the 23 stable digital, unframed and framed product keys as integer pence in MySQL. Run `npm run db:set-prices` after deployment; the migration is additive and idempotent, and inserts only missing defaults.

Saving prices never changes Etsy automatically. The administrator must select **Apply to Etsy**. Digital listings are mapped by their section's stable download setting (1, 3, 6, 12 or Complete Set). Physical variations require rows in `etsy_listing_price_mappings` containing the stable product key and exact Etsy product/offering IDs. Unsupported provider sizes and missing Etsy variations are skipped. Delivery profiles are inspected only for warnings and are never changed.

Etsy updates use durable database jobs processed one listing at a time from the admin screen. Failed listings remain identifiable and can be retried without repeating successful listings. Run `npm run test:set-prices` for the feature test suite.

shop -> section -> sub sections -> listings

I want to remove the sub sections but do not want to lose any of the listing. The section name will now directly link to the Etsy Shop section. When creating a section you should ask for the section name and the number of downloads like we do on the sub sections. Any existing sections should have the no of downloads set to 1.

I would like the following sections created for the shop CosyHousePrints

- Sets of 3 (no of downloads = 3)
- Sets of 6 (no of downloads = 6)
- Sets of 12 (no of downloads = 12)
- Complete Sets (no of downloads = All)

All the listings in a sub section with no of downloads = 1 should just me moved to the section they are in. 

All the listings in a sub section with no of downloads = 3 should be moved to the section Sets of 3. 

All the listings in a sub section with no of downloads = 6 should be moved to the section Sets of 6. 

All the listings in a sub section with no of downloads = 12 should be moved to the section Sets of 12. 

All the listings in a sub section with no of downloads = All should be moved to the section Complete Sets.


When making these changes it will invlove changing the database records and moving the the files in the directories out of the sub section directory into the section directory. The listings will remain the same, but they will be moved to the appropriate sections based on their number of downloads.

When these changes are made the new sections will need to be added to the Etsy shop section so should show up that they need syncing to Etsy. Once the section name has been created in Etsy the listings will need to be synced to the new sections. The listings will remain the same, but they will be moved to the appropriate sections based on their number of downloads.

On the section page http://localhost:3002/shops?shopId=66615491 I would like the + button to have a No of Downloads dropdown as well as the Setcion Name. Just like the subsection http://localhost:3002/shops/sub-sections?shopId=66615491&sectionId=1 + button. The section will now contain the number of downloads for newly created sections. Existing sections should be set  to 1 for the No Of Downloads. Can you order the sections by the number of downloads, then alphabetically by section name. The sections should be ordered by the number of downloads in ascending order, so 1, 3, 6, 12 and All. Each section should display the total number of downloads for that section as well as the number of listings in the section.

A section cannot be deleted if there are listings in it. The trash icon will only be shown if there are no listings in the section. The view button will show the listings for the section and not the sub sections as it currently does.

Can you remove the import button from the sections page and obsolete code used with this.

Remember I do not want to lose any of the listings data in the database or the files in the directories. I do not want to lose if a listing or section is synced with etsy.

