I want to change the structure of the data me hold. Currently we have the following

## Pinterest marketing module

Pinterest is available from the main navigation at `/pinterest`. It uses the existing Etsy listings, categories, images, and real Etsy URLs; the migration is additive and does not alter existing Etsy records.

1. Register the callback `http://localhost:3002/api/pinterest/callback` in the Pinterest developer application.
2. Copy the `PINTEREST_*` entries from `.env.example` into `.env.local`. Start with `PINTEREST_ENVIRONMENT="sandbox"`. Use long, different random values for the encryption and cron secrets.
3. Run `npm run db:pinterest` once. This creates only the six Pinterest tables using `CREATE TABLE IF NOT EXISTS`.
4. Start the application and use **Pinterest → Connection → Connect Pinterest**. Tokens are AES-256-GCM encrypted in MySQL and never returned to the browser.
5. Sync or create boards, then save drafts or schedule Pins. A Pin cannot be published until its listing contains a genuine Etsy URL.

The queue worker accepts `GET` or `POST /api/pinterest/queue` with `Authorization: Bearer <PINTEREST_CRON_SECRET>`. Schedule it externally at the desired interval. The unique publication key and stored Pinterest Pin ID prevent a completed Pin from being published twice. Analytics snapshots are cached for six hours. The Trends screen maps an Ireland preference to Great Britain because Pinterest's keyword Trends endpoint currently supports Great Britain, not Ireland.

Run `npm run test:pinterest` for deterministic scheduler, idempotency-key, and encryption checks, and `npm run build` for the full application verification.

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

