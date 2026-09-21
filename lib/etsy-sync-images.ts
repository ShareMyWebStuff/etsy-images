export type EtsySyncVariant = 'print' | 'download';

export type EtsySyncImageSettings = {
  customTop: boolean;
  customBottom: boolean;
  customisePrints: boolean;
  customiseDigitalDownloads: boolean;
};

/** The positions here are the numbered slots in the listing editor, not Etsy ranks. */
export function selectEtsySyncImages<T extends { rank: number | null }>(
  images: T[],
  variant: EtsySyncVariant,
  settings: EtsySyncImageSettings,
): T[] {
  const canCustomise = variant === 'print'
    ? settings.customisePrints
    : settings.customiseDigitalDownloads;
  const top = canCustomise && settings.customTop;
  const bottom = canCustomise && settings.customBottom;

  return images.filter((image, index) => {
    const slot = image.rank !== null && Number.isInteger(image.rank) && image.rank > 0
      ? image.rank : index + 1;
    if (slot <= 7) return true;
    if (slot === 8 || slot === 9) return top && bottom;
    if (slot === 10) return top;
    if (slot === 11) return bottom;
    return slot >= 12 && slot <= 15 && variant === 'download';
  });
}
