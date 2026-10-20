export type ListingTemplateProducts = {
  printsFrames: boolean;
  customisedPrints: boolean;
  digitalDownload: boolean;
};

export type ListingCategoryTemplate = {
  templateType: string;
  printsFrames: boolean;
  customisePrints: boolean;
  digitalDownload: boolean;
  printFrameSection: { title: string } | null;
  customisedSection: { title: string } | null;
  downloadSection: { title: string } | null;
} | null;

export type ResolvedListingCategory = {
  name: string | null;
  templateProducts: ListingTemplateProducts | null;
};

export function resolveListingCategory(
  template: ListingCategoryTemplate,
  fallbackName: string | null,
): ResolvedListingCategory {
  if (!template || template.templateType !== 'multiple') {
    return { name: fallbackName, templateProducts: null };
  }

  const templateProducts = {
    printsFrames: template.printsFrames,
    customisedPrints: template.customisePrints,
    digitalDownload: template.digitalDownload,
  };

  if (template.printsFrames) {
    return {
      name: template.printFrameSection?.title ?? fallbackName,
      templateProducts,
    };
  }

  if (template.customisePrints) {
    return {
      name: template.customisedSection?.title ?? fallbackName,
      templateProducts,
    };
  }

  if (template.digitalDownload) {
    return {
      name: template.downloadSection?.title ?? fallbackName,
      templateProducts,
    };
  }

  return { name: fallbackName, templateProducts };
}
