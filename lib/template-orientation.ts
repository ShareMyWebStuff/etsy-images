import type { ListingArtworkOrientation } from '@/lib/listing-print-crops';

export type TemplateOrientationFlags = { portraitEnabled?: boolean | number | null; landscapeEnabled?: boolean | number | null };
export type TemplateOrientationVariant = { ourTemplateImageId: string; itemMapping?: Record<string, number> | null };
export type TemplateOrientationVariants = {
  portrait: TemplateOrientationVariant | null;
  landscape: TemplateOrientationVariant | null;
} | null;
export type TemplateSceneOpening = { id?: string; name?: string; imageItemNumber: number; orientation: ListingArtworkOrientation };
export type TemplateSourceOrientations = ReadonlyMap<number, ListingArtworkOrientation> | Readonly<Record<string, ListingArtworkOrientation>>;
export type TemplateOrientationAsset = {
  sceneId: string;
  openings: readonly TemplateSceneOpening[];
  itemMapping: Record<string, number> | null;
  error?: string | null;
  definitionId?: string;
  mode?: 'no-areas' | 'both' | 'combined';
  legacy?: boolean;
  updatedAt?: string;
  definitionUpdatedAt?: string;
  /** Database-computed digest of rendering data, excluding catalogue labels/tags. */
  renderSignature?: string;
};
export type TemplateOrientationSlotPlan = {
  enabled: boolean;
  reason: string | null;
  sceneId: string | null;
  itemMapping: Record<string, number> | null;
  asset: TemplateOrientationAsset | null;
};
export type TemplateOrientationRolePlan = {
  id: number;
  name: string;
  orientationSpecific: boolean;
  error?: string | null;
  portrait: TemplateOrientationSlotPlan;
  landscape: TemplateOrientationSlotPlan;
};
export type TemplateOrientationPlan = {
  categoryId: number;
  portraitEnabled: boolean;
  landscapeEnabled: boolean;
  rows: TemplateOrientationRolePlan[];
};
export type TemplateOrientationRole = {
  id: number;
  name: string;
  /** Legacy uploaded/gridded/static assets adapt to either artwork orientation. */
  neutral: boolean;
  portrait?: TemplateOrientationAsset | null;
  landscape?: TemplateOrientationAsset | null;
  error?: string | null;
};
export type ListingTemplateOrientationRow = {
  id: number;
  name: string;
  enabled: boolean;
  disabledReason: string | null;
  sceneId: string | null;
  itemMapping: Record<string, number> | null;
};
export type ListingTemplateOrientationSelection = {
  rows: ListingTemplateOrientationRow[];
  expectedIds: number[];
  skippedIds: number[];
  warning: string | null;
};

const ORIENTATIONS = ['portrait', 'landscape'] as const;
const orientationName = (value: ListingArtworkOrientation) => value === 'landscape' ? 'landscape' : 'portrait';

export function templateOrientationFlags(value: TemplateOrientationFlags | null | undefined) {
  return {
    portraitEnabled: value?.portraitEnabled !== false && value?.portraitEnabled !== 0,
    landscapeEnabled: value?.landscapeEnabled !== false && value?.landscapeEnabled !== 0,
  };
}

/** Validate the compact stored slot references without importing server modules. */
export function parseTemplateOrientationVariants(value: unknown): TemplateOrientationVariants {
  if (value === null || value === undefined) return null;
  const parsed = typeof value === 'string' ? JSON.parse(value) as unknown : value;
  if (parsed === null) return null;
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('The orientation image slots are invalid.');
  const input = parsed as Record<string, unknown>;
  if (Object.keys(input).some((key) => !ORIENTATIONS.includes(key as ListingArtworkOrientation))) throw new Error('The orientation image slots are invalid.');
  const result: NonNullable<TemplateOrientationVariants> = { portrait: null, landscape: null };
  for (const orientation of ORIENTATIONS) {
    const slot = input[orientation];
    if (slot === null || slot === undefined) continue;
    if (!slot || typeof slot !== 'object' || Array.isArray(slot)) throw new Error('The orientation image slot is invalid.');
    const row = slot as Record<string, unknown>;
    if (typeof row.ourTemplateImageId !== 'string' || !/^[a-f0-9-]{36}$/i.test(row.ourTemplateImageId)) throw new Error('Choose a saved template image for each orientation slot.');
    let itemMapping: Record<string, number> | null = null;
    if (row.itemMapping !== null && row.itemMapping !== undefined) {
      if (!row.itemMapping || typeof row.itemMapping !== 'object' || Array.isArray(row.itemMapping)) throw new Error('The orientation image artwork mapping is invalid.');
      itemMapping = {};
      for (const [key, item] of Object.entries(row.itemMapping)) {
        if (!/^[1-9]\d*$/.test(key) || Number(key) > 100 || !Number.isSafeInteger(item) || Number(item) < 1 || Number(item) > 100) {
          throw new Error('The orientation image artwork mapping is invalid.');
        }
        itemMapping[key] = Number(item);
      }
    }
    result[orientation] = { ourTemplateImageId: row.ourTemplateImageId, itemMapping };
  }
  return result;
}

function sourceOrientation(source: TemplateSourceOrientations | undefined, itemNumber: number, fallback: ListingArtworkOrientation) {
  if (!source) return fallback;
  return typeof (source as ReadonlyMap<number, ListingArtworkOrientation>).get === 'function'
    ? (source as ReadonlyMap<number, ListingArtworkOrientation>).get(itemNumber)
    : (source as Readonly<Record<string, ListingArtworkOrientation>>)[String(itemNumber)];
}

/** Compare paper orientation in the scene, after artwork remapping, with actual source artwork. */
export function getSceneOrientationCompatibility(
  openings: readonly TemplateSceneOpening[],
  orientation: ListingArtworkOrientation,
  sourceOrientations?: TemplateSourceOrientations,
  itemMapping?: Readonly<Record<string, number>> | null,
): { compatible: boolean; reason: string | null } {
  if (!Array.isArray(openings) || openings.length === 0) return { compatible: false, reason: 'The saved scene has no artwork openings.' };
  for (const opening of openings) {
    if (!opening || !Number.isSafeInteger(opening.imageItemNumber) || opening.imageItemNumber < 1
      || !ORIENTATIONS.includes(opening.orientation)) return { compatible: false, reason: 'The saved scene has invalid artwork openings.' };
    const mappedItem = itemMapping?.[String(opening.imageItemNumber)] ?? opening.imageItemNumber;
    if (!Number.isSafeInteger(mappedItem) || mappedItem < 1) return { compatible: false, reason: 'The saved scene has an invalid artwork mapping.' };
    const actual = sourceOrientation(sourceOrientations, mappedItem, orientation);
    if (!actual) return { compatible: false, reason: `Artwork item ${mappedItem} is not available for this saved scene.` };
    if (opening.orientation !== actual) {
      const label = opening.name?.trim() || opening.id || `Artwork item ${mappedItem}`;
      return { compatible: false, reason: `${label} uses ${opening.orientation} paper, but artwork item ${mappedItem} is ${actual}.` };
    }
  }
  return { compatible: true, reason: null };
}

function slotPlan(
  flags: { portraitEnabled: boolean; landscapeEnabled: boolean },
  orientation: ListingArtworkOrientation,
  asset: TemplateOrientationAsset | null,
  sourceOrientations?: TemplateSourceOrientations,
  error?: string | null,
): TemplateOrientationSlotPlan {
  const base = { sceneId: asset?.sceneId ?? null, itemMapping: asset?.itemMapping ?? null, asset };
  if (!flags[`${orientation}Enabled`]) return { ...base, enabled: false, reason: `This template does not support ${orientationName(orientation)} artwork.` };
  if (error || asset?.error) return { ...base, enabled: false, reason: error || asset?.error || 'The saved scene is unavailable.' };
  if (!asset) return { ...base, enabled: false, reason: `No ${orientationName(orientation)} image is assigned to this role.` };
  const compatibility = getSceneOrientationCompatibility(asset.openings, orientation, sourceOrientations, asset.itemMapping);
  return { ...base, enabled: compatibility.compatible, reason: compatibility.reason };
}

export function createTemplateOrientationPlan(categoryId: number, flags: TemplateOrientationFlags | null | undefined,
  roles: readonly TemplateOrientationRole[]): TemplateOrientationPlan {
  const enabled = templateOrientationFlags(flags);
  return { categoryId, ...enabled, rows: roles.map((role) => {
    const neutral = (asset: TemplateOrientationAsset | null):TemplateOrientationSlotPlan=>({enabled:!(role.error||asset?.error),reason:role.error??asset?.error??null,
      sceneId:asset?.sceneId??null,itemMapping:asset?.itemMapping??null,asset});
    return { id: role.id, name: role.name, orientationSpecific: !role.neutral, ...(role.error ? { error: role.error } : {}),
      portrait: role.neutral ? neutral(role.portrait??null) : slotPlan(enabled, 'portrait', role.portrait ?? null, undefined, role.error),
      landscape: role.neutral ? neutral(role.landscape??null) : slotPlan(enabled, 'landscape', role.landscape ?? null, undefined, role.error) };
  }) };
}

/** Keep role IDs stable: orientation slots change the selected asset, never the output filename. */
export function selectListingTemplateOrientation(plan: TemplateOrientationPlan, orientation: ListingArtworkOrientation,
  sourceOrientations?: TemplateSourceOrientations): ListingTemplateOrientationSelection {
  const rows = plan.rows.map((role): ListingTemplateOrientationRow => {
    const configured = role[orientation];
    const slot = role.orientationSpecific
      ? slotPlan(plan, orientation, configured.asset, sourceOrientations, role.error ?? (configured.asset ? null : configured.reason))
      : configured;
    return { id: role.id, name: role.name, enabled: slot.enabled, disabledReason: slot.reason,
      sceneId: slot.sceneId, itemMapping: slot.itemMapping };
  });
  const expectedIds = [...new Set(rows.filter((row) => row.enabled).map((row) => row.id))];
  const skippedIds = [...new Set(rows.filter((row) => !row.enabled).map((row) => row.id))];
  const supported = plan[`${orientation}Enabled`];
  const warning = !supported
    ? `This template does not support ${orientation} artwork. Orientation-specific images will be skipped; compatible general images can still be generated.`
    : skippedIds.length ? `${skippedIds.length} image role${skippedIds.length === 1 ? '' : 's'} cannot be used for this ${orientation} listing and will be skipped.` : null;
  return { rows, expectedIds, skippedIds, warning };
}
