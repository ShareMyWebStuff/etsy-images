import { describe, expect, it } from 'vitest';

import { resolveListingCategory, type ListingCategoryTemplate } from '@/lib/listing-category';

function multipleTemplate(overrides: Partial<NonNullable<ListingCategoryTemplate>> = {}): NonNullable<ListingCategoryTemplate> {
  return {
    templateType: 'multiple',
    printsFrames: false,
    customisePrints: false,
    digitalDownload: false,
    printFrameSection: null,
    customisedSection: null,
    downloadSection: null,
    ...overrides,
  };
}

describe('resolveListingCategory', () => {
  it('uses the print section first when all product types are enabled', () => {
    const category = resolveListingCategory(multipleTemplate({
      printsFrames: true,
      customisePrints: true,
      digitalDownload: true,
      printFrameSection: { title: 'Kids & Nursery Prints' },
      customisedSection: { title: 'Personalised Prints' },
      downloadSection: { title: 'Digital Downloads' },
    }), null);

    expect(category).toEqual({
      name: 'Kids & Nursery Prints',
      templateProducts: { printsFrames: true, customisedPrints: true, digitalDownload: true },
    });
  });

  it('uses the customised section when prints are disabled', () => {
    const category = resolveListingCategory(multipleTemplate({
      customisePrints: true,
      digitalDownload: true,
      customisedSection: { title: 'Personalised Prints' },
      downloadSection: { title: 'Digital Downloads' },
    }), null);

    expect(category).toEqual({
      name: 'Personalised Prints',
      templateProducts: { printsFrames: false, customisedPrints: true, digitalDownload: true },
    });
  });

  it('uses the digital section when it is the only enabled product type', () => {
    const category = resolveListingCategory(multipleTemplate({
      digitalDownload: true,
      downloadSection: { title: 'Digital Downloads' },
    }), null);

    expect(category).toEqual({
      name: 'Digital Downloads',
      templateProducts: { printsFrames: false, customisedPrints: false, digitalDownload: true },
    });
  });

  it('keeps the existing source category for a single template', () => {
    const category = resolveListingCategory({
      ...multipleTemplate({ printsFrames: true, printFrameSection: { title: 'Template Prints' } }),
      templateType: 'single',
    }, 'Existing Category');

    expect(category).toEqual({ name: 'Existing Category', templateProducts: null });
  });
});
