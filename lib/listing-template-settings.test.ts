import { describe, expect, it } from 'vitest';
import { effectiveListingTemplateSettings } from '@/lib/listing-template-settings';

const template = {
  printsFrames: true, customisePrints: true, digitalDownload: true,
  customTop: true, customBottom: true,
};

describe('listing template overrides', () => {
  it('inherits template options before any overrides are saved', () => {
    expect(effectiveListingTemplateSettings(template, null)).toEqual(template);
  });

  it('can disable prints and downloads while retaining customised prints', () => {
    expect(effectiveListingTemplateSettings(template, {
      printsFramesOverride: false, digitalDownloadOverride: false,
    })).toEqual({ ...template, printsFrames: false, digitalDownload: false });
  });

  it('never allows a listing override to turn on a template-disabled option', () => {
    expect(effectiveListingTemplateSettings({ ...template, printsFrames: false, digitalDownload: false, customisePrints: false }, {
      printsFramesOverride: true, digitalDownloadOverride: true, customisePrints: true,
    })).toEqual({ printsFrames: false, digitalDownload: false, customisePrints: false, customTop: false, customBottom: false });
  });
});
