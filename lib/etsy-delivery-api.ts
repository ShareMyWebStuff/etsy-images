import { getEtsyKeystring, getEtsyOAuthConnectionStatus, getValidEtsyAccessToken } from '@/lib/etsy-oauth';

// Verified against Etsy's official OpenAPI specification on 2026-11-08:
// https://www.etsy.com/openapi/generated/oas/3.0.0.json
export type EtsyDeliveryMoney = { amount: number; divisor: number; currency_code: string };
export type EtsyDeliveryDestination = {
  shipping_profile_destination_id: number | string;
  shipping_profile_id?: number | string;
  origin_country_iso?: string;
  destination_country_iso?: string | null;
  destination_region?: string | null;
  primary_cost: EtsyDeliveryMoney;
  secondary_cost: EtsyDeliveryMoney;
  shipping_carrier_id?: number | string | null;
  mail_class?: string | null;
  min_delivery_days?: number | null;
  max_delivery_days?: number | null;
};
export type EtsyDeliveryProfile = {
  shipping_profile_id: number | string;
  title: string | null;
  origin_country_iso: string;
  origin_postal_code?: string | null;
  is_deleted?: boolean;
  profile_type?: string;
  shipping_profile_destinations: EtsyDeliveryDestination[];
  shipping_profile_upgrades?: unknown[];
  domestic_handling_fee?: number;
  international_handling_fee?: number;
};
export type EtsyDeliveryCarrier = {
  shipping_carrier_id: number | string;
  name: string;
  domestic_classes: { mail_class_key: string; name: string }[];
  international_classes: { mail_class_key: string; name: string }[];
};
export type EtsyDeliveryReadiness = {
  shop_id: number | string;
  readiness_state_id: number | string;
  readiness_state: 'made_to_order' | 'ready_to_ship';
  min_processing_days: number;
  max_processing_days: number;
  processing_days_display_label?: string;
};
export type EtsyDeliveryDestinationValues = {
  countryCode: string;
  primaryCostMinor: number;
  secondaryCostMinor: number;
  minDeliveryDays: number | null;
  maxDeliveryDays: number | null;
  carrierId: string | null;
  mailClass: string | null;
};
export type EtsyDeliveryProfileValues = {
  name: string;
  currencyCode: string;
  originCountryIso: string;
  originPostalCode: string;
  destinations: EtsyDeliveryDestinationValues[];
};
type EtsyPage<T> = { count?: number; results?: T[] };
export type EtsyDeliveryErrorCode = 'validation' | 'authentication' | 'permission' | 'rate_limit' | 'network' | 'api' | 'ambiguous_create' | 'conflict';

export class EtsyDeliveryError extends Error {
  constructor(message: string, public readonly code: EtsyDeliveryErrorCode, public readonly status: number | null = null,
    public readonly retryAfterSeconds: number | null = null, public readonly ambiguous = false) {
    super(message);
    this.name = 'EtsyDeliveryError';
  }
}

export function deliveryCurrencyDivisor(currencyCode: string) {
  try {
    return 10 ** (new Intl.NumberFormat('en', { style: 'currency', currency: currencyCode }).resolvedOptions().maximumFractionDigits ?? 2);
  } catch {
    throw new EtsyDeliveryError('Choose a valid shop currency.', 'validation');
  }
}

const POSTAL_CODE_COUNTRIES = new Set(('AX AL DZ AS AD AR AM AU AT AZ BH BD BB BY BE BM BT BA BR IO VG BN BG KH CA CV KY CL CN CX CC CO CR HR CY CZ DK DO EC EG SV EE ET FK FO FI FR GF PF GE DE GI GR GL GP GU GT GG GN GW HT HM VA HN HU IS IN ID IR IQ IE IM IL IT JP JE JO KZ KE KW KG LA LV LB LS LR LI LT LU MK MG MY MV MT MH MQ MU YT MX FM MD MC MN ME MA MM NP NC NZ NI NE NG NF MP NO OM PK PW PG PY PE PH PL PT PR RE RO RU BL SH MF PM VC SM SA SN RS SG SK SI SO ZA GS KR ES LK SJ SZ SE CH TW TJ TZ TH NL TN TR TM TC UA GB US UM UY VI UZ VE VN WF EH ZM').split(' '));

export function validateEtsyDeliveryOrigin(values: Pick<EtsyDeliveryProfileValues, 'name' | 'originCountryIso' | 'originPostalCode'>) {
  if (!values.name.trim()) throw new EtsyDeliveryError('A delivery profile name is required.', 'validation');
  if (!/^[A-Z]{2}$/.test(values.originCountryIso)) throw new EtsyDeliveryError('Choose an explicit two-letter dispatch origin country.', 'validation');
  if (POSTAL_CODE_COUNTRIES.has(values.originCountryIso) && !values.originPostalCode.trim()) {
    throw new EtsyDeliveryError(`A dispatch origin postal code is required for ${values.originCountryIso}.`, 'validation');
  }
}

/** Always supplies an explicit destination. Worldwide coverage is never created by omission. */
export function buildEtsyDeliveryDestinationBody(values: EtsyDeliveryDestinationValues, currencyCode: string, existingImportedCoverage = false) {
  const body = new URLSearchParams();
  if (/^[A-Z]{2}$/.test(values.countryCode)) body.set('destination_country_iso', values.countryCode);
  else if ((values.countryCode === 'region:eu' || values.countryCode === 'region:non_eu') && existingImportedCoverage) body.set('destination_region', values.countryCode.slice(7));
  else if (values.countryCode !== '*' || !existingImportedCoverage) {
    throw new EtsyDeliveryError('Choose an explicit destination country. New worldwide delivery destinations are not supported.', 'validation');
  }
  // For an already imported worldwide row, PUT omits target fields and preserves that row's existing target.
  const divisor = deliveryCurrencyDivisor(currencyCode);
  for (const [key, amount] of [['primary_cost', values.primaryCostMinor], ['secondary_cost', values.secondaryCostMinor]] as const) {
    if (!Number.isSafeInteger(amount) || amount < 0) throw new EtsyDeliveryError('Delivery charges must be non-negative integer minor currency units.', 'validation');
    body.set(key, (amount / divisor).toFixed(Math.log10(divisor)));
  }
  if (values.carrierId !== null || values.mailClass) {
    if (!values.carrierId || !/^\d+$/.test(values.carrierId) || !values.mailClass?.trim()) {
      throw new EtsyDeliveryError('Choose both a shipping carrier and its mail class.', 'validation');
    }
    body.set('shipping_carrier_id', values.carrierId);
    body.set('mail_class', values.mailClass);
  } else {
    if (!Number.isInteger(values.minDeliveryDays) || !Number.isInteger(values.maxDeliveryDays)
      || values.minDeliveryDays! < 1 || values.maxDeliveryDays! > 45 || values.maxDeliveryDays! < values.minDeliveryDays!) {
      throw new EtsyDeliveryError('Transit time must be a minimum and maximum from 1 to 45 business days.', 'validation');
    }
    body.set('min_delivery_days', String(values.minDeliveryDays));
    body.set('max_delivery_days', String(values.maxDeliveryDays));
    // Etsy treats even zero/empty service fields as supplied, so omit them when using transit days.
  }
  return body;
}

export function etsyDeliveryDestinationCountry(destination: EtsyDeliveryDestination) {
  if (destination.destination_country_iso?.trim() && destination.destination_region && destination.destination_region !== 'none') {
    throw new EtsyDeliveryError('Etsy returned both a country and a regional delivery target. Review this destination in Etsy Shop Manager before syncing; its coverage is ambiguous.', 'conflict');
  }
  if (destination.destination_country_iso?.trim()) return destination.destination_country_iso.toUpperCase();
  if (destination.destination_region && destination.destination_region !== 'none') return `region:${destination.destination_region}`;
  return '*';
}

export type EtsyDeliveryApi = {
  listProfiles(shopId: string): Promise<EtsyDeliveryProfile[]>;
  getProfile(shopId: string, profileId: string): Promise<EtsyDeliveryProfile>;
  createProfile(shopId: string, values: EtsyDeliveryProfileValues, firstDestination: EtsyDeliveryDestinationValues): Promise<EtsyDeliveryProfile>;
  updateProfile(shopId: string, profileId: string, values: EtsyDeliveryProfileValues): Promise<EtsyDeliveryProfile>;
  listDestinations(shopId: string, profileId: string): Promise<EtsyDeliveryDestination[]>;
  createDestination(shopId: string, profileId: string, values: EtsyDeliveryDestinationValues, currencyCode: string): Promise<EtsyDeliveryDestination>;
  updateDestination(shopId: string, profileId: string, destinationId: string, values: EtsyDeliveryDestinationValues, currencyCode: string, existingWorldwide?: boolean): Promise<EtsyDeliveryDestination>;
  deleteDestination(shopId: string, profileId: string, destinationId: string): Promise<void>;
  listCarriers(originCountryIso: string): Promise<EtsyDeliveryCarrier[]>;
  listReadiness(shopId: string): Promise<EtsyDeliveryReadiness[]>;
  getShopCurrency(shopId: string): Promise<string>;
};

export function createEtsyDeliveryApi(deps: {
  fetch?: typeof fetch;
  getAccessToken?: () => Promise<string>;
  getConnectionStatus?: () => Promise<{ connected: boolean; scopes: string[] }>;
  getApiKey?: () => string;
  wait?: (milliseconds: number) => Promise<void>;
} = {}): EtsyDeliveryApi {
  const fetcher = deps.fetch ?? fetch;
  const wait = deps.wait ?? ((milliseconds) => new Promise<void>((resolve) => setTimeout(resolve, milliseconds)));
  const getApiKey = deps.getApiKey ?? (() => {
    if (!process.env.ETSY_SHARED_SECRET) throw new EtsyDeliveryError('Missing ETSY_SHARED_SECRET environment variable.', 'authentication');
    return `${getEtsyKeystring()}:${process.env.ETSY_SHARED_SECRET}`;
  });
  async function request<T>(path: string, method = 'GET', body?: URLSearchParams, scope: string | null = 'shops_r'): Promise<T> {
    if (scope) {
      const status = await (deps.getConnectionStatus ?? getEtsyOAuthConnectionStatus)();
      if (!status.connected || !status.scopes.includes(scope)) {
        throw new EtsyDeliveryError(`Reconnect Etsy and approve ${scope} before using Markets & Delivery.`, 'permission');
      }
    }
    const accessToken = await (deps.getAccessToken ?? getValidEtsyAccessToken)();
    const apiKey = getApiKey();
    for (let attempt = 0; attempt < 3; attempt++) {
      let response: Response;
      let responseText: string;
      try {
        response = await fetcher(`https://openapi.etsy.com/v3/application${path}`, {
          method, signal: AbortSignal.timeout(30_000), cache: 'no-store',
          headers: { Accept: 'application/json', Authorization: `Bearer ${accessToken}`, 'x-api-key': apiKey,
            ...(body ? { 'Content-Type': 'application/x-www-form-urlencoded' } : {}) },
          ...(body ? { body } : {}),
        });
        responseText = await response.text();
      } catch {
        throw new EtsyDeliveryError(method === 'POST'
          ? 'Etsy did not confirm creation. Reconcile the remote profiles before trying to create again.'
          : 'Could not reach Etsy. Saved local delivery changes remain pending; try again when the connection is available.',
        method === 'POST' ? 'ambiguous_create' : 'network', null, null, method === 'POST');
      }
      if (response.ok) {
        if (!responseText) return undefined as T;
        try { return JSON.parse(responseText) as T; } catch {
          throw new EtsyDeliveryError('Etsy returned an unreadable response. Reconcile the remote result before retrying.',
            method === 'POST' ? 'ambiguous_create' : 'api', response.status, null, method === 'POST');
        }
      }
      const retryHeader = response.headers.get('retry-after');
      const seconds = retryHeader === null ? null : Number(retryHeader);
      const retryAfter = seconds !== null && Number.isFinite(seconds) && seconds > 0 ? seconds : null;
      if (response.status === 429 && attempt < 2 && (retryAfter === null || retryAfter <= 30)) {
        await wait((retryAfter ?? 2 ** attempt) * 1_000);
        continue;
      }
      if (response.status === 401 || response.status === 403) {
        throw new EtsyDeliveryError('Etsy access has expired or lacks permission. Reconnect Etsy and approve shop read/write access.',
          response.status === 401 ? 'authentication' : 'permission', response.status);
      }
      if (response.status === 429) throw new EtsyDeliveryError(`Etsy rate limit reached.${retryAfter ? ` Retry after ${retryAfter} seconds.` : ' Wait before trying again.'}`, 'rate_limit', 429, retryAfter);
      if (method === 'POST' && response.status >= 500) throw new EtsyDeliveryError('Etsy could not confirm creation. Reconcile the remote result before retrying.', 'ambiguous_create', response.status, null, true);
      throw new EtsyDeliveryError(`Etsy delivery API returned ${response.status}${responseText ? `: ${responseText.slice(0, 1500)}` : ''}`,
        response.status === 400 ? 'validation' : 'api', response.status);
    }
    throw new EtsyDeliveryError('Etsy rate limit reached. Wait before trying again.', 'rate_limit', 429);
  }
  function id(value: string) {
    if (!/^[1-9]\d*$/.test(value)) throw new EtsyDeliveryError('A valid Etsy shop or profile identifier is required.', 'validation');
    return value;
  }
  const path = (shop: string, profile?: string) => `/shops/${id(shop)}/shipping-profiles${profile ? `/${id(profile)}` : ''}`;
  async function allPages<T>(pagePath: string) {
    const rows: T[] = [];
    for (let offset = 0; ; offset += 100) {
      const page = await request<EtsyPage<T>>(`${pagePath}${pagePath.includes('?') ? '&' : '?'}limit=100&offset=${offset}`);
      if (!Array.isArray(page.results)) throw new EtsyDeliveryError('Etsy returned an invalid delivery list.', 'api');
      rows.push(...page.results);
      if (!page.results.length || (typeof page.count === 'number' ? rows.length >= page.count : page.results.length < 100)) return rows;
      if (offset >= 100_000) throw new EtsyDeliveryError('Etsy returned too many delivery records. Retry the import.', 'api');
    }
  }
  return {
    async listProfiles(shop) {
      const response = await request<EtsyPage<EtsyDeliveryProfile>>(path(shop));
      if (!Array.isArray(response.results)) throw new EtsyDeliveryError('Etsy returned an invalid delivery profile list.', 'api');
      return response.results.filter((profile) => !profile.is_deleted);
    },
    getProfile: (shop, profile) => request(path(shop, profile)),
    createProfile(shop, values, firstDestination) {
      validateEtsyDeliveryOrigin(values);
      const body = buildEtsyDeliveryDestinationBody(firstDestination, values.currencyCode);
      body.set('title', values.name.trim());
      body.set('origin_country_iso', values.originCountryIso);
      body.set('origin_postal_code', values.originPostalCode.trim());
      return request(path(shop), 'POST', body, 'shops_w');
    },
    updateProfile(shop, profile, values) {
      validateEtsyDeliveryOrigin(values);
      return request(path(shop, profile), 'PUT', new URLSearchParams({ title: values.name.trim(), origin_country_iso: values.originCountryIso,
        origin_postal_code: values.originPostalCode.trim() }), 'shops_w');
    },
    listDestinations: (shop, profile) => allPages(`${path(shop, profile)}/destinations`),
    createDestination: (shop, profile, values, currency) => request(`${path(shop, profile)}/destinations`, 'POST', buildEtsyDeliveryDestinationBody(values, currency), 'shops_w'),
    updateDestination: (shop, profile, destination, values, currency, existingWorldwide = false) => request(`${path(shop, profile)}/destinations/${id(destination)}`, 'PUT', buildEtsyDeliveryDestinationBody(values, currency, existingWorldwide), 'shops_w'),
    deleteDestination: (shop, profile, destination) => request(`${path(shop, profile)}/destinations/${id(destination)}`, 'DELETE', undefined, 'shops_w'),
    async listCarriers(origin) {
      if (!/^[A-Z]{2}$/.test(origin)) throw new EtsyDeliveryError('Choose a dispatch origin country before loading services.', 'validation');
      const page = await request<EtsyPage<EtsyDeliveryCarrier>>(`/shipping-carriers?origin_country_iso=${origin}`, 'GET', undefined, null);
      return page.results ?? [];
    },
    listReadiness: (shop) => allPages(`/shops/${id(shop)}/readiness-state-definitions`),
    async getShopCurrency(shop) {
      const remote = await request<{ currency_code?: string }>(`/shops/${id(shop)}`);
      if (!remote.currency_code || !/^[A-Z]{3}$/.test(remote.currency_code)) throw new EtsyDeliveryError('Etsy did not return the shop currency.', 'api');
      return remote.currency_code;
    },
  };
}
