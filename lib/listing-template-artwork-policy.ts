import type { ListingArtworkOrientation } from '@/lib/listing-print-crops';
import type { TemplateOrientationPlan } from '@/lib/template-orientation';

export type ListingTemplateArtworkAssignments = Record<string, Record<string, string>>;
export type ListingTemplateArtworkCandidate = {
  id: string; name: string; orientation: ListingArtworkOrientation; sectionId: string; subSectionId: string;
  hasThumbnail: boolean; hasCurrentSizes: boolean;
};
export type ListingTemplateArtworkItem = {
  itemNumber: number; orientation: ListingArtworkOrientation; sourceListingId: string | null; automatic: boolean;
};
export type ListingTemplateArtworkRole = {
  id: number; name: string; sceneId: string | null; assignmentKey: string | null;
  mode: 'no-areas' | 'both' | 'combined' | 'legacy'; requiresSelection: boolean;
  items: ListingTemplateArtworkItem[]; valid: boolean; errors: string[];
};
export type ListingTemplateArtworkPlan = {
  categoryId: number; orientation: ListingArtworkOrientation; valid: boolean; errors: string[];
  roles: ListingTemplateArtworkRole[]; candidates: ListingTemplateArtworkCandidate[];
  assignments: ListingTemplateArtworkAssignments;
  fingerprint?: string;
};

export function parseListingTemplateArtworkAssignments(value: unknown): ListingTemplateArtworkAssignments {
  const parsed = typeof value === 'string' ? JSON.parse(value) as unknown : value;
  if (parsed === null || parsed === undefined) return {};
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('The artwork selections are invalid.');
  const entries = Object.entries(parsed);
  if (entries.length > 1000) throw new Error('There are too many artwork selections.');
  const result: ListingTemplateArtworkAssignments = {};
  for (const [key, items] of entries) {
    if (!/^[1-9]\d*:[a-f0-9-]{36}$/i.test(key) || !items || typeof items !== 'object' || Array.isArray(items)) throw new Error('The artwork selections are invalid.');
    const selected: Record<string, string> = {};
    const fields = Object.entries(items);
    if (fields.length > 100) throw new Error('There are too many artwork items in a scene.');
    for (const [number, id] of fields) {
      if (!/^[1-9]\d*$/.test(number) || Number(number) > 100 || typeof id !== 'string'
        || !/^[1-9]\d*$/.test(id) || !Number.isSafeInteger(Number(id))) throw new Error('Choose valid listing artwork for each item.');
      selected[number] = id;
    }
    result[key] = selected;
  }
  return result;
}

/** Pure preflight: every invalid role blocks the whole listing; no rendering or writes occur here. */
export function planListingTemplateArtwork(input: {
  orientationPlan: TemplateOrientationPlan; currentListingId: string; sectionId: string;
  orientation: ListingArtworkOrientation; candidates: readonly ListingTemplateArtworkCandidate[];
  assignments?: ListingTemplateArtworkAssignments; legacyGroupSources?: Readonly<Record<string, string>>;
  legacyCandidates?: readonly ListingTemplateArtworkCandidate[];
}): ListingTemplateArtworkPlan {
  const { orientationPlan, orientation } = input;
  const sources = new Map([...input.candidates,...(input.legacyCandidates??[])].map((candidate) => [candidate.id, candidate]));
  const assignments = Object.fromEntries(Object.entries(input.assignments ?? {}).map(([key, value]) => [key, { ...value }]));
  const roles = orientationPlan.rows.map((role): ListingTemplateArtworkRole => {
    const slot = role[orientation], asset = slot.asset;
    const result: ListingTemplateArtworkRole = { id: role.id, name: role.name, sceneId: slot.sceneId,
      assignmentKey: slot.sceneId ? `${role.id}:${slot.sceneId}` : null, mode: asset?.mode ?? 'legacy',
      requiresSelection: false, items: [], valid: true, errors: [] };
    if (role.error) result.errors.push(role.error);
    if (role.orientationSpecific && !orientationPlan[`${orientation}Enabled`]) result.errors.push(`This template does not support ${orientation} artwork.`);
    if (asset?.error) result.errors.push(asset.error);
    if (!asset) {
      if (role.orientationSpecific) result.errors.push(slot.reason ?? `Load a ${orientation} image for this role.`);
      result.valid = result.errors.length === 0;
      return result;
    }
    if (asset.mode === 'no-areas') {
      if (asset.openings.length) result.errors.push('A No areas image must not contain artwork areas.');
      result.valid = result.errors.length === 0;
      return result;
    }
    const items = new Map<number, ListingArtworkOrientation>();
    for (const opening of asset.openings) {
      if (!Number.isSafeInteger(opening.imageItemNumber) || opening.imageItemNumber < 1
        || !['portrait', 'landscape'].includes(opening.orientation)) {
        result.errors.push('The image has invalid artwork areas.'); continue;
      }
      const previous = items.get(opening.imageItemNumber);
      if (previous && previous !== opening.orientation) result.errors.push(`Artwork item ${opening.imageItemNumber} is used by portrait and landscape areas. Use different artwork item numbers.`);
      else items.set(opening.imageItemNumber, opening.orientation);
    }
    if (!items.size) result.errors.push('Define at least one artwork area for this image.');
    if (asset.mode === 'combined' && new Set(items.values()).size !== 2) result.errors.push('A Combined image needs portrait and landscape artwork areas.');
    const legacyGroup = Boolean(asset.legacy && Object.keys(input.legacyGroupSources ?? {}).length);
    result.requiresSelection = items.size > 1 && !legacyGroup;
    const selected: Record<string, string> = {};
    for (const [itemNumber, required] of [...items].sort(([a], [b]) => a - b)) {
      const legacyPosition = asset.itemMapping?.[String(itemNumber)] ?? itemNumber;
      const id = legacyGroup ? input.legacyGroupSources?.[String(legacyPosition)] ?? null
        : items.size === 1 ? input.currentListingId : input.assignments?.[result.assignmentKey!]?.[String(itemNumber)] ?? null;
      result.items.push({ itemNumber, orientation: required, sourceListingId: id, automatic: !result.requiresSelection });
      if (id) selected[String(itemNumber)] = id;
      const source = id ? sources.get(id) : null;
      if (!source) result.errors.push(`Choose a listing from this section for artwork item ${itemNumber}.`);
      else if (!legacyGroup && source.sectionId !== input.sectionId) result.errors.push(`Artwork item ${itemNumber} must come from this section.`);
      else if (!source.hasThumbnail) result.errors.push(`Upload artwork for ${source.name} before using it as item ${itemNumber}.`);
      else if (!source.hasCurrentSizes) result.errors.push(`Complete Set Size for ${source.name} before using it as item ${itemNumber}.`);
      else if (source.orientation !== required) result.errors.push(`Artwork item ${itemNumber} needs ${required} artwork; ${source.name} is ${source.orientation}.`);
    }
    if (result.requiresSelection && !result.items.some((item) => item.sourceListingId === input.currentListingId)) result.errors.push('Use the current listing for at least one artwork item.');
    if (result.assignmentKey) assignments[result.assignmentKey] = selected;
    result.errors = [...new Set(result.errors)];
    result.valid = result.errors.length === 0;
    return result;
  });
  const errors = roles.flatMap((role) => role.errors.map((error) => `${role.name}: ${error}`));
  return { categoryId: orientationPlan.categoryId, orientation, valid: errors.length === 0, errors,
    roles, candidates: input.candidates.map((candidate) => ({ ...candidate })), assignments };
}
