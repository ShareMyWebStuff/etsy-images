import type { OurTemplateImageView } from '@/lib/our-template-images';
import type { OurTemplateImageDefinition } from '@/lib/our-template-image-types';
import type { ListingArtworkOrientation } from '@/lib/listing-print-crops';

export type TemplateImageDefinitionMode = 'no-areas' | 'both' | 'combined';
export type TemplateImageVariantSlot = 'portrait' | 'landscape' | 'single';
export type TemplateImageArtworkItem = { imageItemNumber: number; orientation: ListingArtworkOrientation };
export type OurTemplateImageDefinitionView = {
  id: string;
  name: string;
  mode: TemplateImageDefinitionMode;
  createdAt: string;
  updatedAt: string;
  images: OurTemplateImageView[];
};

/** Multiple openings may intentionally repeat the same artwork item. */
export function getDefinitionArtworkItems(definition: Pick<OurTemplateImageDefinition, 'openings'>): TemplateImageArtworkItem[] {
  const items = new Map<number, ListingArtworkOrientation>();
  for (const opening of definition.openings) {
    const previous = items.get(opening.imageItemNumber);
    if (previous && previous !== opening.orientation) {
      throw new Error(`Artwork item ${opening.imageItemNumber} cannot be used for both portrait and landscape areas. Choose a different artwork item for the other orientation.`);
    }
    items.set(opening.imageItemNumber, opening.orientation);
  }
  return [...items].sort(([first], [second]) => first - second).map(([imageItemNumber, orientation]) => ({ imageItemNumber, orientation }));
}

export function validateDefinitionChildMode(mode: TemplateImageDefinitionMode, slot: TemplateImageVariantSlot,
  definition: Pick<OurTemplateImageDefinition, 'openings'>): void {
  if (mode === 'no-areas') {
    if (slot !== 'single' || definition.openings.length !== 0) throw new Error('No areas definitions require one image without artwork areas.');
    return;
  }
  if (!definition.openings.length) throw new Error('Define at least one artwork area before saving this image.');
  const items = getDefinitionArtworkItems(definition);
  if (mode === 'both') {
    if ((slot !== 'portrait' && slot !== 'landscape') || items.some((item) => item.orientation !== slot)) {
      throw new Error(`Every artwork area must use ${slot === 'landscape' ? 'landscape' : 'portrait'} orientation for this image slot.`);
    }
    return;
  }
  if (mode !== 'combined' || slot !== 'single' || !items.some((item) => item.orientation === 'portrait')
    || !items.some((item) => item.orientation === 'landscape')) {
    throw new Error('Combined images require at least one portrait area and one landscape area, using different artwork items.');
  }
}
