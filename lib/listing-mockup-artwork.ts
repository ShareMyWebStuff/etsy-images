import { containArtwork, type MockupPlacement, type MockupRatio } from '@/lib/listing-mockup-tester';
import { cropRegionToArtworkPlacement, type ListingPrintCropSettings } from '@/lib/listing-print-crops';

/** Draws a saved paper crop upright, containing the paper if the opening has another orientation. */
export function drawMockupArtwork(
  context: CanvasRenderingContext2D,
  image: HTMLImageElement,
  opening: MockupPlacement,
  ratio: MockupRatio,
  settings?: ListingPrintCropSettings | null,
) {
  if (settings?.version !== 4 || settings.sourceRatio !== '4x5') {
    const artwork = containArtwork(image.naturalWidth, image.naturalHeight, opening);
    context.drawImage(image, artwork.x, artwork.y, artwork.width, artwork.height);
    return;
  }

  const crop = settings.regions[ratio === 'iso-a' ? 'iso-a1' : ratio];
  const paper = containArtwork(crop.width * image.naturalWidth, crop.height * image.naturalHeight, opening);
  const placement = cropRegionToArtworkPlacement(crop);
  context.save();
  context.beginPath();
  context.rect(paper.x, paper.y, paper.width, paper.height);
  context.clip();
  context.drawImage(
    image,
    paper.x + (placement.x * paper.width),
    paper.y + (placement.y * paper.height),
    placement.width * paper.width,
    placement.height * paper.height,
  );
  context.restore();
}
