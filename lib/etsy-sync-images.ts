export type EtsySyncVariant = 'print' | 'customised' | 'download';

export type EtsySyncImageSettings = {
  printsFrames: boolean;
  customisePrints: boolean;
};

export type EtsySyncImageTemplateUse = {
  useOnPrints: boolean;
  useOnCustomised: boolean;
  useOnDigital: boolean;
};

export type EtsyImageCleanupPlan = {
  preUploadDeleteIds: string[];
  afterFirstUploadDeleteIds: string[];
};

/**
 * Work out when stale Etsy images can be removed safely. If one or more of the
 * selected local images already exists on Etsy, every stale image can be
 * removed before uploading replacements. Otherwise retain one old image until
 * the first replacement succeeds because Etsy listings must not be left with
 * no image.
 */
export function planEtsyImageCleanup(
  remoteIds: string[],
  selectedMappedIds: Array<string | null | undefined>,
): EtsyImageCleanupPlan {
  const remoteIdSet = new Set(remoteIds);
  const reusableIds = new Set(
    selectedMappedIds.filter((id): id is string => Boolean(id && remoteIdSet.has(id))),
  );
  const staleIds = [...remoteIdSet].filter((id) => !reusableIds.has(id));
  const requiresUpload = selectedMappedIds.some((id) => !id || !remoteIdSet.has(id));

  if (reusableIds.size > 0 || !requiresUpload || staleIds.length === 0) {
    return { preUploadDeleteIds: staleIds, afterFirstUploadDeleteIds: [] };
  }

  return {
    preUploadDeleteIds: staleIds.slice(1),
    afterFirstUploadDeleteIds: staleIds.slice(0, 1),
  };
}

/**
 * Template-linked images use their explicit product flags. The numbered-slot
 * fallback is retained only for legacy or manually uploaded images that do not
 * have an image-template association.
 */
export function selectEtsySyncImages<T extends {
  rank: number | null;
  ourCategoryImageTemplate?: EtsySyncImageTemplateUse | null;
}>(
  images: T[],
  variant: EtsySyncVariant,
  settings: EtsySyncImageSettings,
): T[] {
  return images.filter((image, index) => {
    const template = image.ourCategoryImageTemplate;
    if (template) {
      if (variant === 'download') return template.useOnDigital;
      if (variant === 'customised') return template.useOnCustomised;
      return (settings.printsFrames && template.useOnPrints)
        || (settings.customisePrints && template.useOnCustomised);
    }

    const slot = image.rank !== null && Number.isInteger(image.rank) && image.rank > 0
      ? image.rank : index + 1;
    const canCustomise = variant === 'customised' || (variant === 'print' && settings.customisePrints);
    if (slot <= 7) return true;
    if (slot >= 8 && slot <= 11) return canCustomise;
    return slot >= 12 && slot <= 15 && variant === 'download';
  });
}
