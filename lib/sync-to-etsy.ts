import { prisma } from '@/lib/prisma';
import { SINGLE_LISTINGS_SUB_SECTION_NAME } from '@/lib/shop-sub-sections';
import { deleteListingFromEtsy, makeListingInactive, publishListing, syncListingToEtsy } from '@/lib/local-listings';
import { isDropboxInstructionPdfFile } from '@/lib/dropbox-bundle';
import { isListingComplete } from '@/lib/listing-completeness';
import { parseCurrentListingPrintCropSettings } from '@/lib/listing-print-crops';
import { hasRequiredPrintableDownloads } from '@/lib/printable-download-specs';
import { digitalPriceExcludingUkVat, etsyMoneyToPence } from '@/lib/etsy-digital-vat';
import { getTemplateDownloadSectionId, getTemplatePrintSection, hasRequiredTemplateDownloadSection } from '@/lib/template-download-section';
import { getRemoteEtsySectionIds } from '@/lib/local-shop-sections';
import type { EtsySyncVariant } from '@/lib/etsy-sync-images';
import { effectiveListingTemplateSettings } from '@/lib/listing-template-settings';

const MAX_ETSY_DOWNLOAD_SIZE_BYTES = 20 * 1024 * 1024;

export type SyncToEtsyListing = {
  id: string;
  listingName: string;
  subjectName: string;
  localDirectoryName: string | null;
  subSectionId: string;
  subSectionName: string;
  hasEtsyListing: boolean;
  hasActiveEtsyListing: boolean;
  isComplete: boolean;
  isSynced: boolean;
  isPublished: boolean;
  isInactive: boolean;
  canSync: boolean;
  pendingChanges: string[];
  syncDisabledReason: string | null;
  etsyProductType: 'physical' | 'digital';
  etsyListingMode: 'physical' | 'download' | 'both';
  etsyCategory: string;
  categoryUses: string[];
  syncVariants: EtsySyncVariant[];
  listOnEtsy: boolean;
};

export type SyncToEtsySection = {
  id: string;
  categoryId: string;
  shopId: string;
  sectionName: string;
  etsyShopSectionId: number;
  hasEtsySection: boolean;
  showSubject: boolean;
  listings: SyncToEtsyListing[];
};

export type LocalSyncToEtsySection = {
  id: string;
  shopId: string;
  sectionName: string;
  showSubject: boolean;
  etsySections: Array<{
    categoryId: string;
    sectionName: string;
    etsyShopSectionId: number;
    hasEtsySection: boolean;
  }>;
  listings: SyncToEtsyListing[];
};

export type SyncToEtsyData = {
  localSections: LocalSyncToEtsySection[];
  sections: SyncToEtsySection[];
};

export async function getSyncToEtsyData(
  { checkRemoteSections = true }: { checkRemoteSections?: boolean } = {},
): Promise<SyncToEtsyData> {
  const sections = await prisma.etsyShopSection.findMany({
    where: { shop: { isNot: null } },
    orderBy: [{ title: 'asc' }],
    include: {
      shop: { select: { etsyShopId: true, shopName: true, title: true } },
      subSections: {
        include: {
          listings: {
            orderBy: [{ localDirectoryName: 'asc' }, { title: 'asc' }],
            include: {
              sourceSection: { select: { title: true } },
              files: { select: { localFileName: true, originalFileName: true, filename: true, sizeBytes: true, widthPixels: true, heightPixels: true, rawJson: true } },
              images: { orderBy: [{ rank: 'asc' }, { id: 'asc' }], select: { localFileName: true, ourCategoryImageTemplateId: true } },
              tags: { select: { id: true } },
              products: { select: { id: true, productType: true, priceKey: true } },
              dropboxBundle: { select: { sharedUrl: true } },
              dropboxFiles: {
                select: {
                  groupNumber: true,
                  sourceListingId: true,
                  sourceDirectoryName: true,
                  localFileName: true,
                  originalFileName: true,
                },
              },
              productConfig: { select: { listOnEtsy: true, digitalDownload: true, printsFrames: true, printsFramesOverride: true, digitalDownloadOverride: true, customisePrints: true, customTop: true, customBottom: true, sku: true } },
              ourCategory: {
                select: {
                  updatedAt: true,
                  templateType: true,
                  itemCount: true,
                  printsFrames: true,
                  customisePrints: true,
                  customTop: true,
                  customBottom: true,
                  digitalDownload: true,
                  printFrameSection: { select: { id: true, etsyShopSectionId: true, title: true } },
                  customisedSection: { select: { id: true, etsyShopSectionId: true, title: true } },
                  downloadSection: { select: { id: true, etsyShopSectionId: true, title: true } },
                  imageTemplates: { select: {
                    id: true,
                    updatedAt: true,
                    linkedSourceImageTemplate: { select: { updatedAt: true } },
                  } },
                  followedTemplate: { select: {
                    updatedAt: true,
                    imageTemplates: { select: { updatedAt: true } },
                  } },
                },
              },
              groupItems: { select: { id: true } },
            },
          },
        },
      },
    },
  });

  const shopIds = [...new Set(sections.map((section) => section.shop!.etsyShopId.toString()))];
  const savedDigitalPrices = await prisma.adminProductPrice.findMany({
    where: { category: 'digital' },
    select: { productKey: true, amountPence: true },
  });
  const digitalPrices = new Map(savedDigitalPrices.map((price) => [price.productKey, price.amountPence]));
  // PrintShrimp uses local listing completeness and category grouping, without
  // needing to contact Etsy or verify that its remote sections still exist.
  const remoteSectionIdsByShop = new Map(checkRemoteSections
    ? await Promise.all(shopIds.map(async (shopId) => (
      [shopId, new Set(await getRemoteEtsySectionIds(shopId))] as const
    )))
    : []);

  const localSections = await Promise.all(sections.map(async (section) => ({
      id: String(section.id),
      shopId: section.shop!.etsyShopId.toString(),
      sectionName: section.title,
      showSubject: section.subSections.some((subSection) => subSection.listings.some((listing) => (
        listing.includeAllItems || [3, 6, 12].includes(listing.numberOfItems ?? 1)
      ))),
      listings: (await Promise.all(section.subSections
        .sort((a, b) => {
          if (a.name === SINGLE_LISTINGS_SUB_SECTION_NAME) return -1;
          if (b.name === SINGLE_LISTINGS_SUB_SECTION_NAME) return 1;
          return a.name.localeCompare(b.name);
        })
        .flatMap((subSection) => subSection.listings.map(async (listing) => {
          if (!listing.ourCategory) return null;
          const templateSettings = effectiveListingTemplateSettings(listing.ourCategory, listing.productConfig);
          const effectiveTemplate = { ...listing.ourCategory, ...templateSettings };
          const customisation = templateSettings;
          const templateUpdatedAt = Math.max(
            listing.ourCategory.updatedAt?.getTime() ?? 0,
            listing.ourCategory.followedTemplate?.updatedAt?.getTime() ?? 0,
            ...listing.ourCategory.imageTemplates.flatMap((image) => [
              image.updatedAt?.getTime() ?? 0,
              image.linkedSourceImageTemplate?.updatedAt?.getTime() ?? 0,
            ]),
            ...(listing.ourCategory.followedTemplate?.imageTemplates ?? [])
              .map((image) => image.updatedAt?.getTime() ?? 0),
          );
          const templateChangedAfter = (syncedAt: Date | null) => (
            templateUpdatedAt > (syncedAt?.getTime() ?? 0)
          );
          const missingTemplateCategories = [
            templateSettings.printsFrames && !listing.ourCategory.printFrameSection ? 'Print / Frame' : null,
            customisation.customisePrints && !listing.ourCategory.customisedSection ? 'Customised' : null,
            templateSettings.digitalDownload && !listing.ourCategory.downloadSection ? 'Digital Download' : null,
          ].filter((value): value is string => value !== null);
          if (missingTemplateCategories.length > 0) return null;

          const templateCategoriesById = new Map<number, {
            id: number;
            etsyShopSectionId: number;
            title: string;
            uses: string[];
            variants: EtsySyncVariant[];
            existsOnEtsy: boolean;
          }>();
          const addTemplateCategory = (
            category: { id: number; etsyShopSectionId: number; title: string } | null,
            use: string,
            variant: EtsySyncVariant,
          ) => {
            if (!category) return;
            const current = templateCategoriesById.get(category.id);
            if (current) {
              if (!current.uses.includes(use)) current.uses.push(use);
              if (!current.variants.includes(variant)) current.variants.push(variant);
              return;
            }
            templateCategoriesById.set(category.id, {
              ...category,
              uses: [use],
              variants: [variant],
              existsOnEtsy: remoteSectionIdsByShop.get(section.shop!.etsyShopId.toString())?.has(category.etsyShopSectionId) ?? false,
            });
          };
          if (templateSettings.printsFrames) addTemplateCategory(listing.ourCategory.printFrameSection, 'Print / Frames', 'print');
          if (customisation.customisePrints) {
            const sharesPrintCategory = templateSettings.printsFrames
              && listing.ourCategory.printFrameSection?.id === listing.ourCategory.customisedSection?.id;
            addTemplateCategory(listing.ourCategory.customisedSection, 'Customised', sharesPrintCategory ? 'print' : 'customised');
          }
          if (templateSettings.digitalDownload) addTemplateCategory(listing.ourCategory.downloadSection, 'Digital Download', 'download');
          const templateCategories = [...templateCategoriesById.values()];
          if (templateCategories.length === 0) return null;

          const hasDropboxPdf = listing.files.some((file) =>
            isDropboxInstructionPdfFile(file)
            && /\.pdf$/i.test(file.localFileName ?? '')
            && (file.sizeBytes ?? 0) > 0
            && (file.sizeBytes ?? 0) <= MAX_ETSY_DOWNLOAD_SIZE_BYTES
          );
          const etsyProductType = listing.etsyProductType === 'digital' ? 'digital' as const : 'physical' as const;
          const printEnabled = templateSettings.printsFrames || customisation.customisePrints;
          const requiresEtsyDownloads = templateSettings.digitalDownload;
          const templatePrintSection = getTemplatePrintSection(effectiveTemplate);
          const templatePrintSectionId = templatePrintSection?.etsyShopSectionId ?? null;
          const templateDownloadSectionId = getTemplateDownloadSectionId(effectiveTemplate);
          const allTemplateCategoriesExistOnEtsy = templateCategories.every((category) => category.existsOnEtsy);
          const etsyListingMode = printEnabled && requiresEtsyDownloads
            ? 'both' as const
            : requiresEtsyDownloads ? 'download' as const : 'physical' as const;
          const missingDownloadSection = requiresEtsyDownloads && templateDownloadSectionId === null;
          const missingPrintSection = printEnabled && templatePrintSectionId === null;
          const hasCurrentDropbox = Boolean(listing.dropboxBundle?.sharedUrl?.trim())
            && listing.dropboxSyncedAt !== null
            && listing.dropboxRevision === listing.downloadsRevision
            && (listing.dropboxFiles.length === 0 || listing.files.some(isDropboxInstructionPdfFile));
          const isComplete = isListingComplete({
            isMultiple: listing.ourCategory?.templateType === 'multiple',
            hasTemplate: listing.ourCategory !== null,
            hasGroupSelection: listing.ourCategory?.templateType !== 'multiple'
              || listing.groupItems.length === listing.ourCategory.itemCount,
            hasDownloadInstructions: hasDropboxPdf,
            hasListingDescription: listing.ourCategory?.templateType === 'multiple'
              || (listing.listingDescription?.trim().length ?? 0) > 0,
            hasThumbnail: (listing.thumbnailFileName?.trim().length ?? 0) > 0,
            hasThumbnailSizes: listing.ourCategory?.templateType === 'multiple'
              || parseCurrentListingPrintCropSettings(listing.printCropSettings, {
                fileName: listing.thumbnailFileName,
                updatedAt: listing.thumbnailUpdatedAt?.toISOString() ?? null,
              }) !== null,
            requiresTextAreas: listing.ourCategory?.templateType !== 'multiple' && customisation.customisePrints,
            hasTextAreas: !customisation.customisePrints || listing.personalisationTextAreas !== null,
            hasRequiredImages: (listing.ourCategory?.imageTemplates.length ?? 0) > 0
              && listing.ourCategory!.imageTemplates.every((template) => listing.images.some((image) => image.ourCategoryImageTemplateId === template.id)),
            hasRequiredDigitalDownloads: listing.ourCategory?.templateType !== 'multiple' && hasRequiredPrintableDownloads(listing.files),
            hasCurrentZips: true,
            hasCurrentDropbox,
            hasDownloadSection: hasRequiredTemplateDownloadSection(effectiveTemplate),
            hasTags: listing.tags.length > 0,
            hasTitle: listing.title.trim().length > 0,
            hasEtsyDescription: (listing.description?.trim().length ?? 0) > 0,
            hasQuantity: (listing.quantity ?? 0) > 0,
            hasDigitalTitle: (listing.digitalTitle?.trim().length ?? 0) > 0,
            hasDigitalDescription: (listing.digitalDescription?.trim().length ?? 0) > 0,
            hasDigitalQuantity: (listing.digitalQuantity ?? 0) > 0,
            hasPrimaryColour: (listing.primaryColour?.trim().length ?? 0) > 0,
            hasSecondaryColour: (listing.secondaryColour?.trim().length ?? 0) > 0,
            hasEtsySku: (listing.productConfig?.sku?.trim().length ?? 0) > 0,
          });
          const listOnEtsy = listing.productConfig?.listOnEtsy ?? true;
          const digitalProduct = listing.products.find((product) => product.productType === 'digital');
          const configuredDigitalPrice = digitalProduct
            ? digitalPrices.get(digitalProduct.priceKey) ?? null
            : null;
          const expectedEtsyDigitalPrice = configuredDigitalPrice === null
            ? null
            : digitalPriceExcludingUkVat(configuredDigitalPrice);
          const remoteDigitalRaw = listing.etsyDownloadRawJson && typeof listing.etsyDownloadRawJson === 'object'
            && !Array.isArray(listing.etsyDownloadRawJson)
            ? listing.etsyDownloadRawJson as Record<string, unknown>
            : null;
          const remoteEtsyDigitalPrice = etsyMoneyToPence(remoteDigitalRaw?.price);
          const digitalPriceChanged = listing.etsyDownloadId !== null
            && expectedEtsyDigitalPrice !== null
            && remoteEtsyDigitalPrice !== null
            && remoteEtsyDigitalPrice !== expectedEtsyDigitalPrice;
          const pendingChanges = [
            listing.detailsChanged ? 'Details' : null,
            listing.tagsChanged ? 'Tags' : null,
            listing.imagesChanged ? 'Images' : null,
            listing.downloadsChanged ? 'Downloads' : null,
            listing.productsChanged ? 'Products' : null,
            ((templateSettings.printsFrames && templateChangedAfter(listing.lastSyncedAt))
              || (customisation.customisePrints && templateChangedAfter(listing.etsyCustomisedLastSyncedAt))
              || (templateSettings.digitalDownload && templateChangedAfter(listing.etsyDownloadLastSyncedAt))) ? 'Template' : null,
          ].filter((area): area is string => area !== null);
          const missingPrintListing = printEnabled && listing.etsyId === null;
          const missingDownloadListing = requiresEtsyDownloads && listing.etsyDownloadId === null;
          const hasCurrentSection = (!printEnabled || (templatePrintSectionId !== null && listing.shopSectionId === templatePrintSectionId))
            && (!requiresEtsyDownloads || (templateDownloadSectionId !== null
              && listing.etsyDownloadShopSectionId === templateDownloadSectionId));
          const hasEtsyListing = listing.etsyId !== null || listing.etsyDownloadId !== null;
          const sectionChanges = hasCurrentSection ? [] : ['Etsy section'];
          const needsSync = missingPrintListing || missingDownloadListing || pendingChanges.length > 0 || sectionChanges.length > 0;
          const hasActiveEtsyListing = (listing.etsyId !== null && (listing.state === 'active' || listing.state === 'published'))
            || (listing.etsyDownloadId !== null && (listing.etsyDownloadState === 'active' || listing.etsyDownloadState === 'published'));
          const enabledStates = [
            ...(printEnabled ? [listing.state] : []),
            ...(requiresEtsyDownloads ? [listing.etsyDownloadState] : []),
          ];
          const printSectionIsCurrent = !printEnabled
            || (templatePrintSectionId !== null && listing.shopSectionId === templatePrintSectionId);
          const downloadSectionIsCurrent = !requiresEtsyDownloads
            || (templateDownloadSectionId !== null && listing.etsyDownloadShopSectionId === templateDownloadSectionId);
          const changedAfter = (syncedAt: Date | null) => (
            syncedAt === null || syncedAt.getTime() < listing.lastLocalChangeAt.getTime()
          );
          const customisedEnabled = customisation.customisePrints
            && (!templateSettings.printsFrames || listing.ourCategory.customisedSection?.id !== listing.ourCategory.printFrameSection?.id);
          const customisedSectionId = listing.ourCategory.customisedSection?.etsyShopSectionId ?? null;
          const customisedSectionIsCurrent = !customisedEnabled
            || (customisedSectionId !== null && listing.etsyCustomisedShopSectionId === customisedSectionId);
          const buildVariantStatus = (variant: EtsySyncVariant) => {
            const enabled = variant === 'print'
              ? templateSettings.printsFrames
              : variant === 'customised' ? customisedEnabled : requiresEtsyDownloads;
            const remoteId = variant === 'print'
              ? listing.etsyId
              : variant === 'customised' ? listing.etsyCustomisedId : listing.etsyDownloadId;
            const state = variant === 'print'
              ? listing.state
              : variant === 'customised' ? listing.etsyCustomisedState : listing.etsyDownloadState;
            const sectionIsCurrent = variant === 'print'
              ? printSectionIsCurrent
              : variant === 'customised' ? customisedSectionIsCurrent : downloadSectionIsCurrent;
            const sectionIsMissing = variant === 'print'
              ? listing.ourCategory!.printFrameSection === null
              : variant === 'customised' ? listing.ourCategory!.customisedSection === null : missingDownloadSection;
            const requiredCategoriesExistOnEtsy = templateCategories
              .filter((category) => category.variants.includes(variant))
              .every((category) => category.existsOnEtsy);
            const lastSyncedAt = variant === 'print'
              ? listing.lastSyncedAt
              : variant === 'customised' ? listing.etsyCustomisedLastSyncedAt : listing.etsyDownloadLastSyncedAt;
            const changed = changedAfter(lastSyncedAt);
            const templateChanged = templateChangedAfter(lastSyncedAt);
            const priceChanged = variant === 'download' && digitalPriceChanged;
            const changedAreas = changed ? [
              listing.detailsChanged ? 'Details' : null,
              listing.tagsChanged ? 'Tags' : null,
              listing.imagesChanged ? 'Images' : null,
              variant === 'download' && listing.downloadsChanged ? 'Downloads' : null,
              listing.productsChanged ? 'Products' : null,
            ].filter((area): area is string => area !== null) : [];
            if (priceChanged) changedAreas.push('Price');
            if (changed && changedAreas.length === 0) changedAreas.push('Local changes');
            if (templateChanged) changedAreas.push('Template');
            const needsSync = enabled && (remoteId === null || !sectionIsCurrent || changed || priceChanged || templateChanged);
            const pending = [
              remoteId === null ? `New ${variant === 'download' ? 'digital' : variant} listing` : null,
              ...changedAreas,
              !sectionIsCurrent ? 'Etsy section' : null,
            ].filter((area): area is string => area !== null);
            const canSync = listOnEtsy
              ? enabled && isComplete && requiredCategoriesExistOnEtsy && !sectionIsMissing
                && (variant !== 'download' || hasDropboxPdf) && needsSync
              : remoteId !== null && listing.productsChanged;
            const syncDisabledReason = !enabled
              ? `The assigned template does not enable ${variant === 'download' ? 'Digital Downloads' : variant === 'customised' ? 'Customised Prints' : 'Prints / Frames'}.`
              : !isComplete
              ? 'Complete this listing before syncing it to Etsy.'
              : !listOnEtsy && remoteId === null
              ? 'This listing is set not to be listed on Etsy.'
              : !requiredCategoriesExistOnEtsy
              ? 'Add this template category to Etsy before syncing this listing.'
              : sectionIsMissing
              ? `Select the Etsy ${variant === 'download' ? 'Digital Download' : variant === 'customised' ? 'Customised' : 'Print / Frame'} Section on the assigned template before syncing.`
              : variant === 'download' && !hasDropboxPdf
              ? 'Create the Digital Download PDF before syncing.'
              : !needsSync
              ? 'No local changes have been made since the last Etsy sync.'
              : null;
            return {
              hasEtsyListing: remoteId !== null,
              hasActiveEtsyListing: remoteId !== null && (state === 'active' || state === 'published'),
              isComplete,
              isSynced: remoteId !== null && state === 'draft' && !needsSync,
              isPublished: remoteId !== null && (state === 'active' || state === 'published'),
              isInactive: remoteId !== null && state === 'inactive',
              canSync,
              pendingChanges: pending,
              syncDisabledReason,
            };
          };
          const variantStatuses = {
            print: buildVariantStatus('print'),
            customised: buildVariantStatus('customised'),
            download: buildVariantStatus('download'),
          };
          return {
            id: String(listing.id),
            listingName: listing.localDirectoryName ?? listing.title,
            subjectName: listing.sourceSection?.title ?? section.title,
            localDirectoryName: listing.localDirectoryName,
            subSectionId: String(subSection.id),
            subSectionName: subSection.name,
            etsyProductType,
            etsyListingMode,
            etsyCategory: '',
            templateCategories,
            variantStatuses,
            listOnEtsy,
            hasEtsyListing,
            hasActiveEtsyListing,
            isComplete,
            isSynced: hasEtsyListing && enabledStates.length > 0 && enabledStates.every((state) => state === 'draft') && !needsSync,
            isPublished: hasEtsyListing && enabledStates.length > 0 && enabledStates.every((state) => state === 'active' || state === 'published'),
            isInactive: hasEtsyListing && enabledStates.length > 0 && enabledStates.every((state) => state === 'inactive'),
            canSync: listOnEtsy
              ? isComplete && (printEnabled || requiresEtsyDownloads) && allTemplateCategoriesExistOnEtsy && !missingPrintSection
                && !missingDownloadSection && (!requiresEtsyDownloads || hasDropboxPdf) && needsSync
              : hasEtsyListing && listing.productsChanged,
            pendingChanges: [
              ...(missingPrintListing ? ['New print listing'] : []),
              ...(missingDownloadListing ? ['New digital listing'] : []),
              ...pendingChanges,
              ...sectionChanges,
            ],
            syncDisabledReason: !isComplete
              ? 'Complete this listing before syncing it to Etsy.'
              : !listOnEtsy && !hasEtsyListing
              ? 'This listing is set not to be listed on Etsy.'
              : !printEnabled && !requiresEtsyDownloads
              ? 'Enable Prints / Frames or Digital Download on the assigned template.'
              : !allTemplateCategoriesExistOnEtsy
              ? 'Add all template categories to Etsy before syncing this listing.'
              : missingPrintSection
              ? 'Select an Etsy Print / Frame Section on the assigned template before syncing.'
              : missingDownloadSection
              ? 'Select a Digital Download Section on the assigned template before syncing.'
              : requiresEtsyDownloads && !hasDropboxPdf
              ? 'Create the Digital Download PDF before syncing.'
                : !needsSync
                  ? 'No local changes have been made since the last Etsy sync.'
                  : null,
          };
        })))).filter((listing): listing is NonNullable<typeof listing> => listing !== null),
    })));

  type PreparedLocalSection = (typeof localSections)[number];
  type PreparedListing = PreparedLocalSection['listings'][number];
  type PreparedTemplateCategory = PreparedListing['templateCategories'][number];

  const buildCategoryListing = (
    listing: PreparedListing,
    category: PreparedTemplateCategory,
  ): SyncToEtsyListing => {
    const { templateCategories: _templateCategories, variantStatuses, ...baseListing } = listing;
    const statuses = category.variants.map((variant) => variantStatuses[variant]);
    const pendingChanges = [...new Set(statuses.flatMap((status) => status.pendingChanges))];
    return {
      ...baseListing,
      etsyProductType: category.variants.length === 1 && category.variants[0] === 'download' ? 'digital' : 'physical',
      etsyListingMode: category.variants.length > 1
        ? 'both'
        : category.variants[0] === 'download' ? 'download' : 'physical',
      etsyCategory: category.title,
      categoryUses: category.uses,
      syncVariants: category.variants,
      hasEtsyListing: statuses.some((status) => status.hasEtsyListing),
      hasActiveEtsyListing: statuses.some((status) => status.hasActiveEtsyListing),
      isComplete: statuses.every((status) => status.isComplete),
      isSynced: statuses.every((status) => status.isSynced),
      isPublished: statuses.every((status) => status.isPublished),
      isInactive: statuses.every((status) => status.isInactive),
      canSync: statuses.some((status) => status.canSync),
      pendingChanges,
      syncDisabledReason: statuses.some((status) => status.canSync)
        ? null
        : statuses.find((status) => status.syncDisabledReason)?.syncDisabledReason ?? null,
    };
  };

  const categories = new Map<string, SyncToEtsySection>();
  for (const localSection of localSections) {
    for (const listing of localSection.listings) {
      for (const category of listing.templateCategories) {
        const key = `${localSection.shopId}:${category.id}`;
        let grouped = categories.get(key);
        if (!grouped) {
          grouped = {
            id: key,
            categoryId: String(category.id),
            shopId: localSection.shopId,
            sectionName: category.title,
            etsyShopSectionId: category.etsyShopSectionId,
            hasEtsySection: category.existsOnEtsy,
            showSubject: localSection.showSubject,
            listings: [],
          };
          categories.set(key, grouped);
        } else {
          grouped.showSubject ||= localSection.showSubject;
        }
        grouped.listings.push(buildCategoryListing(listing, category));
      }
    }
  }

  const localViewSections: LocalSyncToEtsySection[] = localSections.map((localSection) => {
    const etsySections = new Map<number, LocalSyncToEtsySection['etsySections'][number]>();
    const listings: SyncToEtsyListing[] = [];
    for (const listing of localSection.listings) {
      for (const category of listing.templateCategories) {
        if (!etsySections.has(category.id)) {
          etsySections.set(category.id, {
            categoryId: String(category.id),
            sectionName: category.title,
            etsyShopSectionId: category.etsyShopSectionId,
            hasEtsySection: category.existsOnEtsy,
          });
        }
        listings.push(buildCategoryListing(listing, category));
      }
    }
    return {
      id: `local:${localSection.id}`,
      shopId: localSection.shopId,
      sectionName: localSection.sectionName,
      showSubject: localSection.showSubject,
      etsySections: [...etsySections.values()].sort((first, second) => (
        first.sectionName.localeCompare(second.sectionName, undefined, { sensitivity: 'base' })
      )),
      listings: listings.sort((first, second) => (
        first.listingName.localeCompare(second.listingName, undefined, { sensitivity: 'base' })
        || first.etsyCategory.localeCompare(second.etsyCategory, undefined, { sensitivity: 'base' })
      )),
    };
  }).filter((section) => section.listings.length > 0);

  return {
    localSections: localViewSections.sort((first, second) => (
      first.sectionName.localeCompare(second.sectionName, undefined, { sensitivity: 'base' })
      || first.shopId.localeCompare(second.shopId)
    )),
    sections: [...categories.values()]
      .map((section) => ({
        ...section,
        listings: [...section.listings].sort((first, second) => (
          first.listingName.localeCompare(second.listingName, undefined, { sensitivity: 'base' })
          || first.etsyCategory.localeCompare(second.etsyCategory, undefined, { sensitivity: 'base' })
        )),
      }))
      .sort((first, second) => (
        first.sectionName.localeCompare(second.sectionName, undefined, { sensitivity: 'base' })
        || first.shopId.localeCompare(second.shopId)
      )),
  };
}

export async function syncOneListing(listingId: string, requestedVariants?: EtsySyncVariant[]) {
  const listing = await prisma.etsyListing.findUnique({
    where: { id: Number(listingId) },
    include: {
      files: { select: { localFileName: true, sizeBytes: true, rawJson: true } },
      dropboxFiles: {
        select: {
          groupNumber: true,
          sourceListingId: true,
          sourceDirectoryName: true,
          localFileName: true,
          originalFileName: true,
        },
      },
      productConfig: { select: { listOnEtsy: true, digitalDownload: true, printsFrames: true, digitalDownloadOverride: true } },
      ourCategory: { select: { printsFrames: true, customisePrints: true, digitalDownload: true } },
      subSection: { include: { shopSection: { include: { shop: true } } } },
    },
  });
  const section = listing?.subSection?.shopSection;
  const shop = section?.shop;
  if (!listing || !listing.subSection || !section || !shop) throw new Error('Listing context not found.');
  if (listing.productConfig?.listOnEtsy === false) {
    if (listing.etsyId !== null || listing.etsyCustomisedId !== null || listing.etsyDownloadId !== null) {
      if (listing.state === 'active' || listing.state === 'published'
        || listing.etsyCustomisedState === 'active' || listing.etsyCustomisedState === 'published'
        || listing.etsyDownloadState === 'active' || listing.etsyDownloadState === 'published') {
        await makeListingInactive(shop.etsyShopId.toString(), String(section.id), String(listing.subSection.id), String(listing.id));
      } else if (listing.state !== 'inactive') {
        // Etsy documents Draft -> Publish/Delete, while deactivation is for a
        // previously published listing. Remove a draft when it is explicitly unset.
        await deleteListingFromEtsy(shop.etsyShopId.toString(), String(section.id), String(listing.subSection.id), String(listing.id));
      }
      await prisma.etsyListing.update({
        where: { id: listing.id },
        data: {
          productsChanged: false,
          lastSyncedAt: listing.state === 'active' || listing.state === 'published' || listing.state === 'inactive'
            || listing.etsyCustomisedState === 'active' || listing.etsyCustomisedState === 'published' || listing.etsyCustomisedState === 'inactive'
            || listing.etsyDownloadState === 'active' || listing.etsyDownloadState === 'published' || listing.etsyDownloadState === 'inactive'
            ? new Date()
            : null,
        },
      });
    }
    return;
  }
  const digitalEnabled = listing.ourCategory
    ? effectiveListingTemplateSettings(listing.ourCategory, listing.productConfig).digitalDownload
    : listing.productConfig?.digitalDownload ?? false;
  const variants = requestedVariants ? [...new Set(requestedVariants)] : undefined;
  if (variants?.some((variant) => variant !== 'print' && variant !== 'customised' && variant !== 'download')) {
    throw new Error('Choose a valid Etsy product type to sync.');
  }
  const hasDropboxPdf = listing.files.some((file) =>
    isDropboxInstructionPdfFile(file)
    && /\.pdf$/i.test(file.localFileName ?? '')
    && (file.sizeBytes ?? 0) > 0
    && (file.sizeBytes ?? 0) <= MAX_ETSY_DOWNLOAD_SIZE_BYTES
  );
  const requiresEtsyDownloads = digitalEnabled && (!variants || variants.includes('download'));
  if (requiresEtsyDownloads && !hasDropboxPdf) {
    throw new Error('Create the Digital Download PDF before syncing.');
  }
  await syncListingToEtsy(
    shop.etsyShopId.toString(),
    String(section.id),
    String(listing.subSection.id),
    String(listing.id),
    variants,
  );
}

export async function publishOneListing(listingId: string, variants: EtsySyncVariant[]) {
  const listing = await prisma.etsyListing.findUnique({
    where: { id: Number(listingId) },
    include: { subSection: { include: { shopSection: { include: { shop: true } } } } },
  });
  const section = listing?.subSection?.shopSection;
  const shop = section?.shop;
  if (!listing || !listing.subSection || !section || !shop) throw new Error('Listing context not found.');
  await publishListing(shop.etsyShopId.toString(), String(section.id), String(listing.subSection.id), String(listing.id), variants);
}

export async function makeOneListingInactive(listingId: string, variants: EtsySyncVariant[]) {
  const listing = await prisma.etsyListing.findUnique({
    where: { id: Number(listingId) },
    include: { subSection: { include: { shopSection: { include: { shop: true } } } } },
  });
  const section = listing?.subSection?.shopSection;
  const shop = section?.shop;
  if (!listing || !listing.subSection || !section || !shop) throw new Error('Listing context not found.');
  const states = { print: listing.state, customised: listing.etsyCustomisedState, download: listing.etsyDownloadState };
  if (!variants.some((variant) => states[variant] === 'active' || states[variant] === 'published')) {
    throw new Error('Only a published listing can be made inactive.');
  }
  await makeListingInactive(shop.etsyShopId.toString(), String(section.id), String(listing.subSection.id), String(listing.id), variants);
}

export async function deleteOneListingFromEtsy(listingId: string) {
  const listing = await prisma.etsyListing.findUnique({
    where: { id: Number(listingId) },
    include: { subSection: { include: { shopSection: { include: { shop: true } } } } },
  });
  const section = listing?.subSection?.shopSection;
  const shop = section?.shop;
  if (!listing || !listing.subSection || !section || !shop) throw new Error('Listing context not found.');
  await deleteListingFromEtsy(shop.etsyShopId.toString(), String(section.id), String(listing.subSection.id), String(listing.id));
}
