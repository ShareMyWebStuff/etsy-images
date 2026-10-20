export type ListingCustomisationSettings = {
  customisePrints: boolean;
  customTop: boolean;
  customBottom: boolean;
};

type OptionalSettings = Partial<ListingCustomisationSettings> | null | undefined;

/**
 * Templates define the maximum personalisation a listing may use. A listing
 * may disable any of those options, but it can never enable an option which
 * its template does not allow.
 */
export function effectiveListingCustomisation(
  template: OptionalSettings,
  listing: OptionalSettings,
): ListingCustomisationSettings {
  const customisePrints = Boolean(template?.customisePrints)
    && (listing?.customisePrints ?? true);
  const customTop = customisePrints
    && Boolean(template?.customTop)
    && (listing?.customTop ?? true);
  const customBottom = customisePrints
    && Boolean(template?.customBottom)
    && (listing?.customBottom ?? true);

  return {
    customisePrints: customisePrints && (customTop || customBottom),
    customTop,
    customBottom,
  };
}

