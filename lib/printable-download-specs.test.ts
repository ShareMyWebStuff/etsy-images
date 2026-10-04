import { describe, expect, it } from 'vitest';
import {
  getPrintableDownloadRole,
  getPrintableDownloadStatus,
  hasRequiredPrintableDownloads,
  PRINTABLE_DOWNLOAD_SPECS,
  printableDownloadDimensions,
} from '@/lib/printable-download-specs';
import { PRICE_OPTIONS } from '@/lib/set-prices-core';

describe('printable download requirements', () => {
  it('requires all six exact-size files and the guide', () => {
    const files = PRINTABLE_DOWNLOAD_SPECS.map((spec) => {
      const dimensions = printableDownloadDimensions(spec.key, 'portrait');
      return {
        originalFileName: `Green_Sea_Turtle_${spec.fileToken}_${spec.masterToken}_${dimensions.width}x${dimensions.height}_300DPI.jpeg`,
        widthPixels: dimensions.width,
        heightPixels: dimensions.height,
      };
    });
    expect(hasRequiredPrintableDownloads(files)).toBe(false);
    const complete = [...files, { originalFileName: 'How_To_Print_Guide.pdf' }];
    expect(hasRequiredPrintableDownloads(complete)).toBe(true);
    expect(getPrintableDownloadStatus(complete).completedCount).toBe(7);
    expect(hasRequiredPrintableDownloads([...files, { originalFileName: 'How_To_Print_Guide.txt' }])).toBe(false);
  });

  it('does not accept a preview-sized file with a matching name', () => {
    const file = {
      originalFileName: 'Green_Sea_Turtle_ISO_A1_7016x9933_300DPI.jpeg',
      widthPixels: 1086,
      heightPixels: 1448,
    };
    expect(getPrintableDownloadRole(file)).toBe('iso-a1');
    expect(getPrintableDownloadStatus([file]).items[0].created).toBe(false);
  });

  it('recognises generated roles stored in metadata', () => {
    expect(getPrintableDownloadRole({ rawJson: { printableDownloadRole: '5x7' } })).toBe('5x7');
    expect(getPrintableDownloadRole({ rawJson: { printableDownloadRole: 'guide' } })).toBe('guide');
  });

  it('covers every physical size sold on the Set Prices screen with one of the six masters', () => {
    const coveredSizes = new Set(PRINTABLE_DOWNLOAD_SPECS.flatMap((spec) => spec.supportedSizes)
      .map((size) => size.toLocaleLowerCase().replace(/\s+/g, '').replace(/in$/i, '')));
    const pricedSizes = PRICE_OPTIONS
      .filter((option) => option.category === 'unframed' || option.category === 'framed')
      .map((option) => option.key.replace(/^(?:unframed|framed)_/, ''));

    expect(pricedSizes.every((size) => coveredSizes.has(size))).toBe(true);
  });
});
