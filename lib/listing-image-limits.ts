export const ETSY_MAX_LISTING_IMAGES = 20;
export const LISTING_IMAGE_GUIDE = [
  'Listing image',
  'Bedroom',
  'Playroom',
  'Perfect gift',
  'Frames',
  'Sizes',
  'Aspect ratios',
  'Customised shelve - both normal case',
  'Customised bedroom door - both',
  'Customised beside bed - top normal case',
  'Customised playroom - bottom text',
  'No Frames Included',
  'Digital Download',
  'How to print',
  'Personal Use Only',
] as const;
export const LISTING_COMPLETE_MIN_IMAGES = LISTING_IMAGE_GUIDE.length;
export const LISTING_EDITOR_MAX_IMAGES = 25;

export function hasRequiredListingImages(images: Array<{ localFileName: string | null }>) {
  return images.filter((image) => (image.localFileName?.trim().length ?? 0) > 0).length >= LISTING_COMPLETE_MIN_IMAGES;
}
