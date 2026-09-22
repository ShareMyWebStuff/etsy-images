export type EtsySyncVariant = 'print' | 'download';

export type EtsyTaxonomyProperty = {
  property_id?: number | string;
  display_name?: string;
  name?: string;
  possible_values?: Array<{ value_id?: number | string; name?: string }>;
};

export type EtsyListingProperty = {
  property_id?: number | string;
  property_name?: string;
  display_name?: string;
  name?: string;
  value_ids?: Array<number | string>;
  values?: string[];
};

export type PhysicalAttributeName =
  | 'Framing'
  | 'Orientation'
  | 'Frame colour'
  | 'Home style'
  | 'Occasion'
  | 'Celebration'
  | 'Room';

export type PhysicalAttributeLabels = Record<PhysicalAttributeName, string[]>;

export type PhysicalAttributeUpdate = {
  propertyId: string;
  propertyName: PhysicalAttributeName;
  valueIds: string[];
  values: string[];
};

export type PhysicalAttributePlan = {
  updates: PhysicalAttributeUpdate[];
  deletes: Array<{ propertyId: string; propertyName: PhysicalAttributeName }>;
};

export type PhysicalAttributeRequest = (path: string, init: RequestInit) => Promise<unknown>;

const MANAGED_PROPERTY_NAMES: PhysicalAttributeName[] = [
  'Framing',
  'Orientation',
  'Frame colour',
  'Home style',
  'Occasion',
  'Celebration',
  'Room',
];

const FRAME_COLOURS = [
  { key: 'black', label: 'Black' },
  { key: 'white', label: 'White' },
  { key: 'oak', label: 'Natural Oak' },
] as const;

function normalized(value: string) {
  return value
    .trim()
    .toLocaleLowerCase()
    .replace(/\bcolour\b/g, 'color')
    .replace(/\s+/g, ' ');
}

function propertyName(property: EtsyTaxonomyProperty | EtsyListingProperty) {
  if ('property_name' in property && property.property_name) return property.property_name;
  return property.display_name ?? property.name ?? '';
}

function validId(value: number | string | null | undefined) {
  if (value === null || value === undefined) return null;
  const text = String(value).trim();
  return /^\d+$/.test(text) && BigInt(text) > 0n ? text : null;
}

function distinct(values: string[]) {
  const seen = new Set<string>();
  return values.filter((value) => {
    const key = normalized(value);
    if (!key || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function explicitRoomLabel(context: string) {
  const value = normalized(context);
  if (/\bplay\s*room\b/.test(value)) return 'Playroom';
  if (/\bbed\s*room\b/.test(value)) return 'Bedroom';
  if (/\bnursery\b/.test(value)) return 'Nursery';
  return null;
}

function explicitHomeStyleLabel(context: string) {
  const value = normalized(context);
  return /\b(scandinavian|nordic)\b/.test(value) ? 'Scandinavian' : null;
}

export function resolveArtworkOrientation(
  artwork: Array<{ widthPixels: number | null; heightPixels: number | null }>,
) {
  const dimensions = artwork.find(({ widthPixels, heightPixels }) =>
    Number.isFinite(widthPixels) && Number.isFinite(heightPixels)
      && (widthPixels ?? 0) > 0 && (heightPixels ?? 0) > 0
  );
  // This preserves the listing editor's established fallback: missing and
  // square source artwork is treated as portrait.
  return dimensions && dimensions.widthPixels! > dimensions.heightPixels!
    ? 'Landscape' as const
    : 'Portrait' as const;
}

export function derivePhysicalAttributeLabels(input: {
  frameOptions: Array<{ frameKey: string; enabled: boolean }>;
  artwork: Array<{ widthPixels: number | null; heightPixels: number | null }>;
  roomTheme?: string | null;
  sectionTitle?: string | null;
  listingTitle?: string | null;
  explicitOccasion?: string | null;
  explicitCelebration?: string | null;
}): PhysicalAttributeLabels {
  const enabledFrames = new Set(input.frameOptions.filter(({ enabled }) => enabled).map(({ frameKey }) => frameKey));
  const hasFramed = FRAME_COLOURS.some(({ key }) => enabledFrames.has(key));
  const themeContext = input.roomTheme ?? '';
  const roomContext = [input.roomTheme, input.sectionTitle, input.listingTitle].filter(Boolean).join(' ');
  // All configured room themes currently feed the app's established
  // Scandinavian nursery presentation. Etsy still has the final say: this
  // label is omitted later unless taxonomy 121 exposes it as a real value.
  const homeStyle = explicitHomeStyleLabel(themeContext)
    ?? (input.roomTheme?.trim() ? 'Scandinavian' : null);
  const room = explicitRoomLabel(roomContext);

  return {
    Framing: [hasFramed ? 'Framed' : null, enabledFrames.has('no_frame') ? 'Unframed' : null]
      .filter((value): value is string => value !== null),
    Orientation: [resolveArtworkOrientation(input.artwork)],
    'Frame colour': FRAME_COLOURS.filter(({ key }) => enabledFrames.has(key)).map(({ label }) => label),
    'Home style': homeStyle ? [homeStyle] : [],
    Occasion: input.explicitOccasion?.trim() ? [input.explicitOccasion.trim()] : [],
    Celebration: input.explicitCelebration?.trim() ? [input.explicitCelebration.trim()] : [],
    Room: room ? [room] : [],
  };
}

export function extractTaxonomyProperties(payload: unknown): EtsyTaxonomyProperty[] {
  if (Array.isArray(payload)) return payload as EtsyTaxonomyProperty[];
  if (payload && typeof payload === 'object' && 'results' in payload && Array.isArray(payload.results)) {
    return payload.results as EtsyTaxonomyProperty[];
  }
  return [];
}

export function extractListingProperties(payload: unknown): EtsyListingProperty[] {
  if (Array.isArray(payload)) return payload as EtsyListingProperty[];
  if (payload && typeof payload === 'object' && 'results' in payload && Array.isArray(payload.results)) {
    return payload.results as EtsyListingProperty[];
  }
  return [];
}

function idsMatch(first: string[], second: string[]) {
  return first.length === second.length
    && [...first].sort().every((value, index) => value === [...second].sort()[index]);
}

export function buildPhysicalAttributePlan(
  desired: PhysicalAttributeLabels,
  taxonomyProperties: EtsyTaxonomyProperty[],
  currentProperties: EtsyListingProperty[],
): PhysicalAttributePlan {
  const updates: PhysicalAttributeUpdate[] = [];
  const deletes: PhysicalAttributePlan['deletes'] = [];

  for (const managedName of MANAGED_PROPERTY_NAMES) {
    const expectedName = normalized(managedName);
    const taxonomyProperty = taxonomyProperties.find((property) => normalized(propertyName(property)) === expectedName);
    const taxonomyPropertyId = validId(taxonomyProperty?.property_id);
    const current = currentProperties.find((property) =>
      normalized(propertyName(property)) === expectedName
      || (taxonomyPropertyId !== null && validId(property.property_id) === taxonomyPropertyId)
    );
    const currentPropertyId = validId(current?.property_id);
    const desiredLabels = distinct(desired[managedName]);

    if (!taxonomyPropertyId || !taxonomyProperty) {
      if (desiredLabels.length === 0 && currentPropertyId) {
        deletes.push({ propertyId: currentPropertyId, propertyName: managedName });
      }
      continue;
    }

    const resolved = desiredLabels.flatMap((label) => {
      const possible = taxonomyProperty.possible_values?.find((value) =>
        normalized(value.name ?? '') === normalized(label)
      );
      const valueId = validId(possible?.value_id);
      return possible?.name && valueId ? [{ valueId, value: possible.name }] : [];
    });

    if (resolved.length === 0) {
      if (currentPropertyId) deletes.push({ propertyId: currentPropertyId, propertyName: managedName });
      continue;
    }

    const valueIds = distinct(resolved.map(({ valueId }) => valueId));
    const values = valueIds.map((valueId) => resolved.find((item) => item.valueId === valueId)!.value);
    const currentValueIds = (current?.value_ids ?? []).map(validId).filter((id): id is string => id !== null);
    if (!current || !idsMatch(currentValueIds, valueIds)) {
      updates.push({ propertyId: taxonomyPropertyId, propertyName: managedName, valueIds, values });
    }
  }

  return { updates, deletes };
}

export async function syncEtsyPhysicalListingAttributes(input: {
  variant: EtsySyncVariant;
  shopId: string;
  listingId: string;
  taxonomyId: number;
  labels: PhysicalAttributeLabels;
}, request: PhysicalAttributeRequest) {
  if (input.variant !== 'print') return { updates: 0, deletes: 0 };

  const [taxonomyPayload, currentPayload] = await Promise.all([
    request(`/seller-taxonomy/nodes/${encodeURIComponent(input.taxonomyId)}/properties`, { method: 'GET' }),
    request(`/shops/${encodeURIComponent(input.shopId)}/listings/${encodeURIComponent(input.listingId)}/properties`, { method: 'GET' }),
  ]);
  const plan = buildPhysicalAttributePlan(
    input.labels,
    extractTaxonomyProperties(taxonomyPayload),
    extractListingProperties(currentPayload),
  );
  const basePath = `/shops/${encodeURIComponent(input.shopId)}/listings/${encodeURIComponent(input.listingId)}/properties`;

  for (const property of plan.deletes) {
    await request(`${basePath}/${encodeURIComponent(property.propertyId)}`, { method: 'DELETE' });
  }
  for (const property of plan.updates) {
    const body = new URLSearchParams();
    body.set('value_ids', property.valueIds.join(','));
    body.set('values', property.values.join(','));
    await request(`${basePath}/${encodeURIComponent(property.propertyId)}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body,
    });
  }

  return { updates: plan.updates.length, deletes: plan.deletes.length };
}
