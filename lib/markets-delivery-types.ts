export type DeliverySyncStatus = 'LOCAL_ONLY' | 'PENDING' | 'SYNCED' | 'CONFLICT' | 'FAILED';

export type DeliveryDestinationInput = {
  /** ISO alpha-2, '*' for worldwide, or region:eu/non_eu for imported coverage. */
  countryCode: string;
  primaryCostMinor: number;
  secondaryCostMinor: number;
  minDeliveryDays: number | null;
  maxDeliveryDays: number | null;
  carrierId: string | null;
  mailClass: string | null;
};

export type DeliveryProfileValues = {
  name: string;
  currencyCode: string;
  originCountryIso: string;
  originPostalCode: string;
  readinessStateId: string | null;
  includeDeliveryInformation: boolean;
  deliveryInformation: string;
  destinations: DeliveryDestinationInput[];
};

export type DeliveryProfile = DeliveryProfileValues & {
  id: string;
  shopId: string;
  etsyShippingProfileId: string | null;
  revision: number;
  syncStatus: DeliverySyncStatus;
  linkedListingCount: number;
  lastSyncedAt: string | null;
  error: string | null;
  archivedAt: string | null;
  updatedAt: string;
  isCalculated: boolean;
};

export type DeliveryAffectedListing = {
  listingId: string;
  listingName: string;
  templateName: string | null;
  variant: 'print' | 'customised';
  etsyListingId: string | null;
  inherited: boolean;
  descriptionPreview: string;
};

export type MarketsDeliveryPageData = {
  shopId: string;
  shops: Array<{ id: string; name: string; currencyCode: string | null }>;
  currencyCode: string | null;
  profiles: DeliveryProfile[];
  connection: { connected: boolean; canRead: boolean; canWrite: boolean; message: string | null };
  pricing: { available: false; message: string };
};

export type DeliverySettingsInput = {
  printProfileId: string | null;
  customisedProfileId: string | null;
  /** null uses the chosen reusable profile's setting. */
  includeDeliveryInformation: boolean | null;
  /** null uses the chosen reusable profile's wording. Empty text explicitly overrides it. */
  deliveryInformation: string | null;
};

export type EffectiveListingDelivery = {
  profileId: string | null;
  shippingProfileId: string | null;
  readinessStateId: string | null;
  includeDeliveryInformation: boolean;
  deliveryInformation: string;
  usesManagedProfile: boolean;
  inherited: boolean;
  pending: boolean;
  profileRevision: number | null;
  profileSyncStatus: DeliverySyncStatus | null;
  /** Requires an explicit review before the app may replace changed Etsy text. */
  descriptionConflict?: string | null;
  remoteDescription?: string | null;
};

export type MarketsDeliverySettingsState = {
  shopId: string;
  profiles: DeliveryProfile[];
  settings: DeliverySettingsInput | null;
  templateSettings: DeliverySettingsInput | null;
  effective: { print: EffectiveListingDelivery; customised: EffectiveListingDelivery };
  isInherited: boolean;
  pending: boolean;
  baseDescription: string;
};

export function currencyMinorDigits(currencyCode: string) {
  return new Intl.NumberFormat('en-GB', { style: 'currency', currency: currencyCode }).resolvedOptions().maximumFractionDigits ?? 2;
}

export function deliveryAmountFromMinor(amount: number, currencyCode: string) {
  return amount / (10 ** currencyMinorDigits(currencyCode));
}
