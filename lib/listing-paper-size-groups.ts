import type { EtsyProductSizeKey } from '@/lib/listing-products';
import type { PrintableDownloadRatio } from '@/lib/printable-download-specs';

export const LISTING_PAPER_SIZE_SPECS: Record<EtsyProductSizeKey, {
  widthMillimetres: number;
  heightMillimetres: number;
  ratio: PrintableDownloadRatio;
}> = {
  a5: { widthMillimetres: 148, heightMillimetres: 210, ratio: 'iso-a1' },
  a4: { widthMillimetres: 210, heightMillimetres: 297, ratio: 'iso-a1' },
  a3: { widthMillimetres: 297, heightMillimetres: 420, ratio: 'iso-a1' },
  a2: { widthMillimetres: 420, heightMillimetres: 594, ratio: 'iso-a1' },
  a1: { widthMillimetres: 594, heightMillimetres: 841, ratio: 'iso-a1' },
  '5x7': { widthMillimetres: 127, heightMillimetres: 177.8, ratio: '5x7' },
  '6x8': { widthMillimetres: 152.4, heightMillimetres: 203.2, ratio: '3x4' },
  '8x10': { widthMillimetres: 203.2, heightMillimetres: 254, ratio: '4x5' },
  '11x14': { widthMillimetres: 279.4, heightMillimetres: 355.6, ratio: '11x14' },
  '12x16': { widthMillimetres: 304.8, heightMillimetres: 406.4, ratio: '3x4' },
  '12x18': { widthMillimetres: 304.8, heightMillimetres: 457.2, ratio: '2x3' },
  '16x20': { widthMillimetres: 406.4, heightMillimetres: 508, ratio: '4x5' },
  '16x24': { widthMillimetres: 406.4, heightMillimetres: 609.6, ratio: '2x3' },
  '18x24': { widthMillimetres: 457.2, heightMillimetres: 609.6, ratio: '3x4' },
  '20x28': { widthMillimetres: 508, heightMillimetres: 711.2, ratio: '5x7' },
  '20x30': { widthMillimetres: 508, heightMillimetres: 762, ratio: '2x3' },
  '24x36': { widthMillimetres: 609.6, heightMillimetres: 914.4, ratio: '2x3' },
  '30x40cm': { widthMillimetres: 300, heightMillimetres: 400, ratio: '3x4' },
  '50x70cm': { widthMillimetres: 500, heightMillimetres: 700, ratio: '5x7' },
};

export function smallestPaperSizePerAspectRatio<T extends { key: string }>(sizes: T[]) {
  const smallest = new Map<PrintableDownloadRatio, { size: T; area: number }>();
  for (const size of sizes) {
    const spec = LISTING_PAPER_SIZE_SPECS[size.key as EtsyProductSizeKey];
    if (!spec) continue;
    const area = spec.widthMillimetres * spec.heightMillimetres;
    const current = smallest.get(spec.ratio);
    if (!current || area < current.area) smallest.set(spec.ratio, { size, area });
  }
  const selected = new Set([...smallest.values()].map(({ size }) => size));
  return sizes.filter((size) => selected.has(size));
}
