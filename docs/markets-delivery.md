# Markets & Delivery

Markets & Delivery is available under **Etsy → Markets & Delivery** at `/etsy/markets-delivery`. Profiles belong to one Etsy shop. Creating or editing a local profile does not update Etsy.

## Setup

1. Run `npm run db:markets-delivery` against the application's configured database. The additive migration creates the delivery-profile and settings tables and preserves existing listing records. It does not assign any existing listing to a new profile or change live Etsy profiles.
2. Generate the Prisma client with `npm run prisma:generate`, and restart the application after updating its code and schema.
3. Use **Admin → Connect Etsy** to connect or reconnect the shop with `shops_r`, `shops_w` and `listings_w` OAuth scopes. Reading profiles and processing definitions requires shop read access; changing profiles requires shop write access, and assigning profiles or updating descriptions requires listing write access. The management page displays a reconnect message when the required connection or permissions are missing.

Keep Etsy client credentials and access tokens in the existing server-side configuration. No new browser-side credentials are required.

## Import or create a profile

1. Select the shop on **Markets & Delivery**. Its currency is shown beside the shop selector. Currency can be inferred from the application's stored Etsy listing data or refreshed from Etsy metadata during import. If it is unknown, import from Etsy to confirm it before creating or saving charges; the application does not silently assume GBP. If a saved profile uses a different currency, its editor offers an explicit action to use the confirmed shop currency and clear its rates for re-entry. No exchange-rate conversion is assumed.
2. To reuse an existing Etsy profile, choose **Import from Etsy → Import profiles**. Import reads profiles and destinations, creates or refreshes local records, and preserves unsynced local edits. Imported worldwide and regional coverage is displayed explicitly.
3. Alternatively, choose **Create profile**. Enter its name, actual dispatch origin country and postal code where required. No origin, destination, delivery claim or free-delivery option is selected automatically.
4. Select individual countries or use the convenience buttons. The selected European group expands to the countries listed in the form; it is not an implicit Etsy region or worldwide destination. Every country has its own first-item and additional-item charges. Enter zero deliberately, or select **Free delivery** for that destination.
5. Give each destination an Etsy carrier and mail class, or an accepted transit-day range. Processing/readiness is separate: choose an existing Etsy processing-profile ID or load the shop's processing profiles. This page does not create processing definitions or treat processing days as delivery transit days.
6. Optionally enter reusable customer-facing delivery information and enable its default description checkbox. Initial text is empty. Review its preview and use only claims that accurately describe the products.
7. Choose **Save locally**. Money is stored as safe integer minor units, using the selected currency's exponent (for example, 325 means GBP 3.25). Saving leaves changes pending until the relevant explicit Etsy sync succeeds.

Profiles can be duplicated locally or archived. Assigned profiles cannot be archived: choose replacement profiles in the affected listings or templates first. Archiving never deletes the remote Etsy profile.

## Assign and sync

The listing editor's **Overview → Template Settings → Markets & Delivery** controls appear immediately beneath **Top Text** and **Bottom Text**, before **General Listing**. Template defaults use the same delivery settings. Choose the print/frame and customised-print profiles, review their destinations, and set or inherit the delivery wording. Use the reset/default action to return a listing to its template settings.

Wording precedence is the reusable profile default, then a template override, then an explicit listing override. Changing a template marks inheriting listings as pending without replacing explicit listing overrides. The wording is customer-facing description content; it is separate from artwork Top Text and Bottom Text.

For a shared profile, choose **Preview affected listings**, review the physical Etsy listing IDs and complete generated description previews, and acknowledge the changes before saving. After saving:

1. Choose the profile's **Sync to Etsy** action on the management page.
2. Review its affected listings and confirm the explicit sync. This updates or creates the mapped Etsy delivery profile and its destinations. Existing remote identifiers are reused.
3. Use the existing **Etsy → Sync to Etsy** listing workflow to apply pending physical listing assignments and generated descriptions. A successful profile sync does not mean every listing assignment has also succeeded; incomplete listing work remains pending and can be retried separately.

The status column distinguishes **Local only**, **Pending changes**, **Synced**, **Conflict** and **Failed**. Successful progress and remote IDs are retained when a later operation fails. A remote-edit conflict offers an explicit choice to replace the local profile with Etsy's version or overwrite the Etsy changes with the saved local version. Import does not silently make that choice. If a create response is ambiguous, remote reconciliation is required before another create attempt; do not create replacement profiles merely to bypass a failed response.

## Description ownership and limits

The application composes a labelled Delivery section from separately stored delivery wording. Repeated generation does not duplicate that managed section. Disabling it removes the application-owned section while retaining unrelated description text, including manually written delivery information. The complete physical description is previewed and validated before listing sync.

When an imported Etsy description differs from the last managed snapshot, the saved base description is retained and that physical product is marked **Conflict**. The listing controls show the remote text beside the local preview. Review both before explicitly choosing **Use saved local description on next sync**; ordinary profile or template saves do not dismiss this conflict. Imports of mapped customised or digital Etsy IDs update their existing artwork record rather than creating another parent listing.

The application uses a 102,400-character description ceiling. Etsy's current OpenAPI description schema does not publish a `maxLength`; this application ceiling is a validation safeguard, not a claim that Etsy guarantees every description of that length will be accepted.

Description wording does not restrict delivery destinations. The actual Etsy delivery profile enforces the enabled markets. Digital products receive neither a physical shipping profile nor physical delivery wording, including when one local artwork also generates physical products.

## Verified integration limits

- Etsy supports one shipping profile per physical Etsy listing. Framed and unframed products in this application are variations of the same physical listing and share its delivery charges. They cannot receive different profiles per variation. Customised physical products can have a different profile when they use a separate actual Etsy listing ID. Templates that combine customised and standard prints into one Etsy listing must use one shared profile. Digital Etsy IDs are excluded.
- Each profile has one dispatch origin. Etsy does not support an origin per destination within that profile. PrintShrimp can fulfil from several locations; the application does not assume every product is dispatched from the UK or invent destination-specific origin support.
- Calculated shipping profiles imported from Etsy remain available for assignment but their rates cannot be edited, duplicated or synced through this API workflow. Manage those rates in Etsy.
- Existing worldwide (`Everywhere Else`) and regional destinations are preserved visibly on import. New country selection creates explicit country destinations and does not add worldwide delivery automatically. Removing broad coverage should be reviewed carefully before syncing the restricted profile.
- Reliable destination-specific PrintShrimp quotes are not available from the existing pricing integration. The management page displays **Cost unavailable**, not zero fulfilment cost or an invented profit estimate. Product prices alone do not establish delivered cost, tax treatment, Etsy fees or guaranteed profit.
- A shared profile can also be used by Etsy listings that have not been imported into this application. The affected-listing preview identifies locally known physical IDs; syncing the shared Etsy profile also changes its delivery settings for other Etsy listings using it.

API operations and constraints were checked against Etsy's [official OpenAPI specification](https://www.etsy.com/openapi/generated/oas/3.0.0.json), [processing-profile migration guide](https://developers.etsy.com/documentation/tutorials/migration/) and [rate-limit guidance](https://developers.etsy.com/documentation/essentials/rate-limits/). The country picker uses explicit ISO codes; the current API does not expose the previously available country lookup endpoint. Readiness responses report normalized processing days separately from transit times.

## Validation

Automated tests use mocked Etsy calls and do not modify live shops or place PrintShrimp orders. Run the relevant Markets & Delivery, delivery API, listing/template, and navigation tests with Vitest, then run `npx tsc --noEmit --incremental false` and `npm run build`.
