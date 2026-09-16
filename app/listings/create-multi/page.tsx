import { MultiListingWizard } from './MultiListingWizard';
import { getMultiListingWizardData } from '@/lib/multi-listing';

export default async function CreateMultiListingPage({
  searchParams,
}: {
  searchParams: Promise<{
    shopId?: string;
    sectionId?: string;
    subSectionId?: string;
    listingName?: string;
    numberOfItems?: string;
    includeAllItems?: string;
    etsyProductType?: string;
  }>;
}) {
  const params = await searchParams;
  const shopId = params.shopId ?? '';
  const sectionId = params.sectionId ?? '';
  const subSectionId = params.subSectionId ?? '';
  const data = shopId && sectionId && subSectionId
    ? await getMultiListingWizardData(shopId, sectionId, subSectionId)
    : null;
  const requestedItemCount = params.numberOfItems;
  const hasValidRequestedItemCount = ['1', '3', '6', '12', 'all'].includes(requestedItemCount ?? '');
  const includeAllItems = hasValidRequestedItemCount
    ? requestedItemCount === 'all'
    : data?.subSection.includeAllDownloads ?? false;
  const parsedItemCount = Number(requestedItemCount);
  const numberOfItems = includeAllItems
    ? null
    : hasValidRequestedItemCount && [1, 3, 6, 12].includes(parsedItemCount)
      ? parsedItemCount
      : data?.subSection.numberOfDownloads ?? 1;
  const etsyProductType = params.etsyProductType === 'digital' ? 'digital' : 'physical';

  return (
    <main className="mx-auto w-full max-w-5xl px-6 py-10">
      <MultiListingWizard
        data={data}
        shopId={shopId}
        sectionId={sectionId}
        subSectionId={subSectionId}
        initialListingName={params.listingName ?? ''}
        numberOfItems={numberOfItems}
        includeAllItems={includeAllItems}
        etsyProductType={etsyProductType}
      />
    </main>
  );
}
