import { describe, expect, it } from 'vitest';
import { getTemplateEtsySyncVariants } from '@/lib/etsy-sync-targets';

const section = (id: number) => ({ id });

describe('getTemplateEtsySyncVariants', () => {
  it('deduplicates Print and Customised when both use the same Etsy category', () => {
    expect(getTemplateEtsySyncVariants({
      printsFrames: true,
      customisePrints: true,
      digitalDownload: true,
      printFrameSection: section(3),
      customisedSection: section(3),
      downloadSection: section(4),
    })).toEqual(['print', 'download']);
  });

  it('creates separate Print, Customised and Digital targets for distinct categories', () => {
    expect(getTemplateEtsySyncVariants({
      printsFrames: true,
      customisePrints: true,
      digitalDownload: true,
      printFrameSection: section(1),
      customisedSection: section(2),
      downloadSection: section(3),
    })).toEqual(['print', 'customised', 'download']);
  });

  it('supports a Customised-only physical template', () => {
    expect(getTemplateEtsySyncVariants({
      printsFrames: false,
      customisePrints: true,
      digitalDownload: false,
      printFrameSection: null,
      customisedSection: section(2),
      downloadSection: null,
    })).toEqual(['customised']);
  });
});
