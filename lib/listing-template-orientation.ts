import { Prisma } from '@prisma/client';
import { prisma } from '@/lib/prisma';
import {
  createTemplateOrientationPlan, parseTemplateOrientationVariants,
  type TemplateOrientationAsset, type TemplateOrientationPlan, type TemplateOrientationRole,
  type TemplateOrientationVariants, type TemplateSceneOpening,
} from '@/lib/template-orientation';

type CategoryRow = { id: number; portraitEnabled: boolean | number | null; landscapeEnabled: boolean | number | null };
type RoleRow = {
  id: number; categoryId: number; name: string; position: number;
  ourTemplateImageId: string | null; ourTemplateImageItemMapping: unknown; orientationVariants: unknown;
  linkedSourceCategoryId: number | null; linkedSourceImageTemplateId: number | null; linkedImageItemNumber: number | null;
  templateImageDefinitionId?: string | null;
};
type SceneRow = { id: string; openings: unknown; updatedAt?:Date|string;renderSignature?:string };
type DefinitionRow = { id:string;mode:'no-areas'|'both'|'combined';variantSlot:'portrait'|'landscape'|'single'|null;sceneId:string|null;definitionUpdatedAt?:Date|string };
type ResolvedRole = {
  variants: TemplateOrientationVariants; legacySceneId: string | null; legacyMapping: Record<string, number> | null;
  forcedItemNumber: number | null; error?: string;
  definitionId?: string | null;
};

function json(value: unknown) { return typeof value === 'string' ? JSON.parse(value) as unknown : value; }
function mapping(value: unknown): Record<string, number> | null {
  const input = json(value);
  if (input === null || input === undefined) return null;
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new Error('The saved scene artwork mapping is invalid.');
  const result: Record<string, number> = {};
  for (const [key, item] of Object.entries(input)) {
    if (!/^[1-9]\d*$/.test(key) || !Number.isSafeInteger(item) || Number(item) < 1) throw new Error('The saved scene artwork mapping is invalid.');
    result[key] = Number(item);
  }
  return result;
}

/** Batch metadata only: no artwork/image bytes, masks, S3 calls or writes. */
export async function getListingTemplateOrientationPlans(categoryIds: number[]): Promise<Map<number, TemplateOrientationPlan>> {
  if (categoryIds.some((id) => !Number.isSafeInteger(id) || id < 1)) throw new Error('Invalid template category id.');
  const ids = [...new Set(categoryIds)];
  if (!ids.length || typeof prisma.$queryRaw !== 'function') return new Map();
  const [categories, initialRoles] = await Promise.all([
    prisma.$queryRaw<CategoryRow[]>`
      SELECT id, portraitEnabled, landscapeEnabled FROM our_categories WHERE id IN (${Prisma.join(ids)})
    `,
    prisma.$queryRaw<RoleRow[]>`
      SELECT id, categoryId, name, position, ourTemplateImageId, ourTemplateImageItemMapping, orientationVariants,
             linkedSourceCategoryId, linkedSourceImageTemplateId, linkedImageItemNumber, templateImageDefinitionId
      FROM our_category_image_templates WHERE categoryId IN (${Prisma.join(ids)}) ORDER BY position, id
    `,
  ]);
  if (!categories.length) return new Map();
  const rolesById = new Map(initialRoles.map((role) => [Number(role.id), role]));
  const requestedLinks = new Set<number>();
  for (let depth = 0; depth < 32; depth++) {
    const missing = [...new Set([...rolesById.values()].flatMap((role) => {
      const id = role.linkedSourceImageTemplateId;
      return id && !rolesById.has(Number(id)) && !requestedLinks.has(Number(id)) ? [Number(id)] : [];
    }))];
    if (!missing.length) break;
    missing.forEach((id) => requestedLinks.add(id));
    const linked = await prisma.$queryRaw<RoleRow[]>`
      SELECT id, categoryId, name, position, ourTemplateImageId, ourTemplateImageItemMapping, orientationVariants,
             linkedSourceCategoryId, linkedSourceImageTemplateId, linkedImageItemNumber, templateImageDefinitionId
      FROM our_category_image_templates WHERE id IN (${Prisma.join(missing)})
    `;
    linked.forEach((role) => rolesById.set(Number(role.id), role));
  }

  const resolve = (role: RoleRow, visited = new Set<number>()): ResolvedRole => {
    if (visited.has(Number(role.id)) || visited.size >= 32) throw new Error('The image role contains a circular or overly deep link.');
    if (role.linkedSourceImageTemplateId) {
      const source = rolesById.get(Number(role.linkedSourceImageTemplateId));
      if (!source || Number(source.categoryId) !== Number(role.linkedSourceCategoryId)) throw new Error('The linked source image role is unavailable.');
      if (!Number.isSafeInteger(role.linkedImageItemNumber) || Number(role.linkedImageItemNumber) < 1) throw new Error('The linked artwork item number is invalid.');
      const inherited = resolve(source, new Set(visited).add(Number(role.id)));
      return { ...inherited, forcedItemNumber: Number(role.linkedImageItemNumber) };
    }
    return { variants: parseTemplateOrientationVariants(role.orientationVariants), legacySceneId: role.ourTemplateImageId,
      legacyMapping: mapping(role.ourTemplateImageItemMapping), forcedItemNumber: null, definitionId:role.templateImageDefinitionId??null };
  };
  const resolved = new Map<number, ResolvedRole>();
  for (const role of initialRoles) {
    try { resolved.set(Number(role.id), resolve(role)); }
    catch (error) { resolved.set(Number(role.id), { variants: null, legacySceneId: null, legacyMapping: null,
      forcedItemNumber: null, error: error instanceof Error ? error.message : 'The image role is unavailable.' }); }
  }
  const definitionIds=[...new Set([...resolved.values()].flatMap(role=>role.definitionId?[role.definitionId]:[]))];
  const definitions=definitionIds.length?await prisma.$queryRaw<DefinitionRow[]>`
    SELECT definition.id, definition.mode, definition.updatedAt AS definitionUpdatedAt, image.variantSlot, image.sceneId
    FROM our_template_image_definitions definition
    LEFT JOIN our_template_image_definition_images image ON image.definitionId=definition.id
    WHERE definition.id IN (${Prisma.join(definitionIds)})
  `:[];
  const sceneIds = [...new Set([...definitions.flatMap(row=>row.sceneId?[row.sceneId]:[]),...[...resolved.values()].flatMap((role) => role.definitionId?[]:role.variants
    ? [role.variants.portrait?.ourTemplateImageId, role.variants.landscape?.ourTemplateImageId].filter((id): id is string => Boolean(id))
    : role.legacySceneId ? [role.legacySceneId] : [])])];
  const scenes = sceneIds.length ? await prisma.$queryRaw<SceneRow[]>`
    SELECT id, updatedAt, JSON_EXTRACT(definition, '$.openings') AS openings,
      SHA2(CONCAT(CAST(definition AS CHAR),imagePath,COALESCE(whiteImagePath,''),COALESCE(blackImagePath,'')),256) AS renderSignature
    FROM our_template_images WHERE id IN (${Prisma.join(sceneIds)})
  ` : [];
  const scenesById = new Map(scenes.map((scene) => [scene.id, scene]));
  const asset = (sceneId: string, itemMapping: Record<string, number> | null, forcedItemNumber: number | null): TemplateOrientationAsset => {
    const scene = scenesById.get(sceneId);
    if (!scene) return { sceneId, itemMapping, openings: [], legacy:true,error: 'The saved scene is unavailable.' };
    try {
      const value = json(scene.openings);
      if (!Array.isArray(value)) throw new Error('The saved scene has invalid artwork openings.');
      const openings: TemplateSceneOpening[] = value.map((opening) => ({ id: opening?.id, name: opening?.name,
        imageItemNumber: opening?.imageItemNumber, orientation: opening?.orientation }));
      const effective = forcedItemNumber === null ? itemMapping : Object.fromEntries(openings.map((opening) => [String(opening.imageItemNumber), forcedItemNumber]));
      return { sceneId, openings, itemMapping: effective,legacy:true,
        ...(scene.renderSignature?{renderSignature:scene.renderSignature}:{}),
        ...(scene.updatedAt?{updatedAt:new Date(scene.updatedAt).toISOString()}:{}) };
    } catch { return { sceneId, itemMapping, openings: [],legacy:true,error: 'The saved scene has invalid artwork openings.' }; }
  };
  const plans = new Map<number, TemplateOrientationPlan>();
  for (const category of categories) {
    const roles: TemplateOrientationRole[] = initialRoles.filter((role) => Number(role.categoryId) === Number(category.id)).map((role) => {
      const value = resolved.get(Number(role.id))!;
      if (value.error) return { id: Number(role.id), name: role.name, neutral: false, error: value.error };
      if(value.definitionId){
        const children=definitions.filter(row=>row.id===value.definitionId);
        const mode=children[0]?.mode;
        if(!mode||!['no-areas','both','combined'].includes(mode))return{id:Number(role.id),name:role.name,neutral:false,error:'The template image definition is unavailable.'};
        const parentAsset=(slot:'portrait'|'landscape'|'single')=>{
          const child=children.find(row=>row.variantSlot===slot&&row.sceneId);
          if(!child?.sceneId)return null;
          const variant=Object.values(value.variants??{}).find(candidate=>candidate?.ourTemplateImageId===child.sceneId);
          return{...asset(child.sceneId,variant?.itemMapping??(value.legacySceneId===child.sceneId?value.legacyMapping:null),value.forcedItemNumber),
            definitionId:value.definitionId!,mode,legacy:Boolean(value.legacySceneId||value.variants),
            ...(child.definitionUpdatedAt?{definitionUpdatedAt:new Date(child.definitionUpdatedAt).toISOString()}:{})};
        };
        if(mode==='both')return{id:Number(role.id),name:role.name,neutral:false,portrait:parentAsset('portrait'),landscape:parentAsset('landscape')};
        const shared=parentAsset('single');
        if(!shared)return{id:Number(role.id),name:role.name,neutral:mode==='no-areas',error:'Load an image in this template image definition.'};
        return{id:Number(role.id),name:role.name,neutral:mode==='no-areas',portrait:shared,landscape:shared};
      }
      if (value.variants) return { id: Number(role.id), name: role.name, neutral: false,
        portrait: value.variants.portrait ? asset(value.variants.portrait.ourTemplateImageId, value.variants.portrait.itemMapping ?? null, value.forcedItemNumber) : null,
        landscape: value.variants.landscape ? asset(value.variants.landscape.ourTemplateImageId, value.variants.landscape.itemMapping ?? null, value.forcedItemNumber) : null };
      if (value.legacySceneId) {
        const shared = asset(value.legacySceneId, value.legacyMapping, value.forcedItemNumber);
        return { id: Number(role.id), name: role.name, neutral: false, portrait: shared, landscape: shared };
      }
      return { id: Number(role.id), name: role.name, neutral: true };
    });
    plans.set(Number(category.id), createTemplateOrientationPlan(Number(category.id), category, roles));
  }
  return plans;
}
