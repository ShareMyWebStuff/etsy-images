export type TemplateDownloadSectionSource = {
  digitalDownload: boolean;
  downloadSection: {
    etsyShopSectionId: number;
  } | null;
} | null | undefined;

export type TemplateEtsySectionReference = {
  id: number;
  etsyShopSectionId: number;
  title: string;
};

export type TemplatePrintSectionSource = {
  printsFrames: boolean;
  customisePrints: boolean;
  printFrameSection: TemplateEtsySectionReference | null;
  customisedSection: TemplateEtsySectionReference | null;
} | null | undefined;

export function getTemplateDownloadSectionId(template: TemplateDownloadSectionSource) {
  if (!template?.digitalDownload) return null;
  return template.downloadSection?.etsyShopSectionId ?? null;
}

export function hasRequiredTemplateDownloadSection(template: TemplateDownloadSectionSource) {
  return !template || !template.digitalDownload || getTemplateDownloadSectionId(template) !== null;
}

export function getTemplatePrintSection(template: TemplatePrintSectionSource) {
  if (!template) return null;
  if (template.printsFrames) return template.printFrameSection;
  if (template.customisePrints) return template.customisedSection;
  return null;
}

export function getTemplatePrintSectionId(template: TemplatePrintSectionSource) {
  return getTemplatePrintSection(template)?.etsyShopSectionId ?? null;
}

export function hasRequiredTemplatePrintSection(template: TemplatePrintSectionSource) {
  return !template || (!template.printsFrames && !template.customisePrints) || getTemplatePrintSectionId(template) !== null;
}
