I want to change the structure of the data me hold. Currently we have the following

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

