import { describe, expect, it } from 'vitest';
import {
  getTemplateDownloadSectionId,
  getTemplatePrintSection,
  getTemplatePrintSectionId,
  hasRequiredTemplateDownloadSection,
  hasRequiredTemplatePrintSection,
} from '@/lib/template-download-section';

describe('template download sections', () => {
  it('uses the Etsy section id selected by the template', () => {
    const template = {
      digitalDownload: true,
      downloadSection: { etsyShopSectionId: 60449656 },
    };

    expect(getTemplateDownloadSectionId(template)).toBe(60449656);
    expect(hasRequiredTemplateDownloadSection(template)).toBe(true);
  });

  it('reports a missing section when a template enables downloads without one', () => {
    const template = { digitalDownload: true, downloadSection: null };

    expect(getTemplateDownloadSectionId(template)).toBeNull();
    expect(hasRequiredTemplateDownloadSection(template)).toBe(false);
  });

  it('does not require a section when the template disables downloads', () => {
    const template = { digitalDownload: false, downloadSection: null };

    expect(getTemplateDownloadSectionId(template)).toBeNull();
    expect(hasRequiredTemplateDownloadSection(template)).toBe(true);
  });
});

describe('template print sections', () => {
  const printFrameSection = { id: 1, etsyShopSectionId: 111, title: 'Kids & Nursery Prints' };
  const customisedSection = { id: 2, etsyShopSectionId: 222, title: 'Personalised Prints' };

  it('uses the Print / Frame section when prints are enabled', () => {
    const template = { printsFrames: true, customisePrints: true, printFrameSection, customisedSection };

    expect(getTemplatePrintSection(template)).toEqual(printFrameSection);
    expect(getTemplatePrintSectionId(template)).toBe(111);
    expect(hasRequiredTemplatePrintSection(template)).toBe(true);
  });

  it('uses the Customised section when standard prints are disabled', () => {
    const template = { printsFrames: false, customisePrints: true, printFrameSection, customisedSection };

    expect(getTemplatePrintSection(template)).toEqual(customisedSection);
    expect(getTemplatePrintSectionId(template)).toBe(222);
  });

  it('reports a missing enabled print section', () => {
    expect(hasRequiredTemplatePrintSection({
      printsFrames: true,
      customisePrints: false,
      printFrameSection: null,
      customisedSection: null,
    })).toBe(false);
  });
});
