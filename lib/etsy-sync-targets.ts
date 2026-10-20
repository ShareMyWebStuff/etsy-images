import type { EtsySyncVariant } from '@/lib/etsy-sync-images';

type TemplateSyncSections = {
  printsFrames: boolean;
  customisePrints: boolean;
  digitalDownload: boolean;
  printFrameSection: { id: number } | null;
  customisedSection: { id: number } | null;
  downloadSection: { id: number } | null;
};

/**
 * Etsy permits one shop section per listing. Print and Customised can share a
 * physical listing only when the template points them at the same section.
 */
export function getTemplateEtsySyncVariants(template: TemplateSyncSections | null): EtsySyncVariant[] {
  if (!template) return [];
  const printSection = template.printsFrames ? template.printFrameSection : null;
  const customisedSection = template.customisePrints ? template.customisedSection : null;
  const customisedSharesPrintSection = Boolean(
    printSection && customisedSection && printSection.id === customisedSection.id,
  );
  return [
    ...(printSection ? ['print' as const] : []),
    ...(customisedSection && !customisedSharesPrintSection ? ['customised' as const] : []),
    ...(template.digitalDownload && template.downloadSection ? ['download' as const] : []),
  ];
}
