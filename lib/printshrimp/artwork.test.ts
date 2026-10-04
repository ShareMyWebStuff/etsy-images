import { describe, expect, it } from 'vitest';
import sharp from 'sharp';

import {
  convertPrintShrimpArtwork,
  getPrintShrimpArtworkIdentity,
  getPrintShrimpVariantSizes,
  identifyPrintShrimpRatio,
  mapPrintShrimpRatioFiles,
  PRINTSHRIMP_RATIOS,
  validatePrintShrimpBaseSku,
  type PrintShrimpSourceFile,
} from '@/lib/printshrimp/artwork';

function file(id: number, name: string, width: number, height: number): PrintShrimpSourceFile {
  return { id, originalFileName: name, localFileName: `file_${id}.jpg`, widthPixels: width, heightPixels: height };
}

describe('PrintShrimp artwork mapping', () => {
  const allFiles = [
    file(1, 'Artwork_ISO_A1.jpeg', 7016, 9933),
    file(2, 'Artwork_5x7.jpeg', 6000, 8400),
    file(3, 'Artwork_4x5.jpeg', 4800, 6000),
    file(4, 'Artwork_11x14.jpeg', 3300, 4200),
    file(5, 'Artwork_3x4.jpeg', 5400, 7200),
    file(6, 'Artwork_2x3.jpeg', 7200, 10800),
  ];

  it('maps all six canonical Digital Download files rather than array positions', () => {
    const mapped = mapPrintShrimpRatioFiles([...allFiles].reverse());
    expect([...mapped.files.keys()].sort()).toEqual([...PRINTSHRIMP_RATIOS].sort());
    expect(mapped.missingRatios).toEqual([]);
    expect(mapped.duplicateRatios).toEqual([]);
    expect(identifyPrintShrimpRatio(file(9, 'misleading_2x3.jpeg', 4800, 6000))).toBe('4x5');
  });

  it('reports missing and duplicate ratios', () => {
    const mapped = mapPrintShrimpRatioFiles([...allFiles.slice(0, 5), file(7, 'duplicate_4x5.jpeg', 4800, 6000)]);
    expect(mapped.missingRatios).toEqual(['2x3']);
    expect(mapped.duplicateRatios).toEqual(['4x5']);
  });

  it('ignores a superseded ISO A2 file when the canonical ISO A1 download exists', () => {
    const mapped = mapPrintShrimpRatioFiles([
      ...allFiles,
      file(8, 'Artwork_ISO_A2.jpeg', 4961, 7016),
    ]);
    expect(mapped.duplicateRatios).toEqual([]);
    expect(mapped.files.get('A')?.originalFileName).toBe('Artwork_ISO_A1.jpeg');
  });

  it('builds the required logical SKUs and JPEG filenames without changing the Etsy SKU', () => {
    expect(PRINTSHRIMP_RATIOS.map((ratio) => getPrintShrimpArtworkIdentity('GREEN-TURTLE-001', ratio))).toEqual([
      { sku: 'GREEN-TURTLE-001', fileName: 'GREEN-TURTLE-001_A.jpg' },
      { sku: 'GREEN-TURTLE-001', fileName: 'GREEN-TURTLE-001_5x7.jpg' },
      { sku: 'GREEN-TURTLE-001', fileName: 'GREEN-TURTLE-001_4x5.jpg' },
      { sku: 'GREEN-TURTLE-001', fileName: 'GREEN-TURTLE-001_11x14.jpg' },
      { sku: 'GREEN-TURTLE-001', fileName: 'GREEN-TURTLE-001_3x4.jpg' },
      { sku: 'GREEN-TURTLE-001', fileName: 'GREEN-TURTLE-001_2x3.jpg' },
    ]);
    expect(() => validatePrintShrimpBaseSku('BAD/SKU')).toThrow(/only letters/);
    expect(() => validatePrintShrimpBaseSku('BAD SKU')).toThrow(/only letters/);
    expect(() => validatePrintShrimpBaseSku('A'.repeat(51))).toThrow(/50 characters/);
    expect(() => validatePrintShrimpBaseSku('')).toThrow(/Add an Etsy SKU/);
  });

  it('maps each ratio to sizes accepted by the supplied PrintShrimp API documentation', () => {
    expect(getPrintShrimpVariantSizes('A')).toEqual(['A1', 'A2', 'A3', 'A4', 'A5']);
    expect(getPrintShrimpVariantSizes('5x7')).toEqual(['5x7', '50x70cm']);
    expect(getPrintShrimpVariantSizes('4x5')).toEqual(['8x10', '16x20']);
    expect(getPrintShrimpVariantSizes('11x14')).toEqual(['11x14']);
    expect(getPrintShrimpVariantSizes('3x4')).toEqual(['6x8', '18x24', '30x40cm']);
    expect(getPrintShrimpVariantSizes('2x3')).toEqual(['12x18', '16x24', '20x30', '24x36']);
  });
});

describe('PrintShrimp JPEG conversion', () => {
  it('flattens transparency onto white, preserves dimensions, writes sRGB JPEG and leaves the source unchanged', async () => {
    const source = await sharp({
      create: { width: 2, height: 1, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } },
    }).png().toBuffer();
    const original = Buffer.from(source);

    const converted = await convertPrintShrimpArtwork(source);
    const metadata = await sharp(converted.jpeg).metadata();
    const pixels = await sharp(converted.jpeg).raw().toBuffer();

    expect(source).toEqual(original);
    expect(converted.width).toBe(2);
    expect(converted.height).toBe(1);
    expect(metadata.format).toBe('jpeg');
    expect(metadata.space).toBe('srgb');
    expect(metadata.hasAlpha).toBe(false);
    expect(metadata.density).toBe(300);
    expect([...pixels.slice(0, 3)]).toEqual([255, 255, 255]);
  });
});
