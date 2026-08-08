import { MultiListingWizard } from './MultiListingWizard';
import { getMultiListingWizardData } from '@/lib/multi-listing';

export default async function CreateMultiListingPage({
  searchParams,
}: {
  searchParams: Promise<{ shopId?: string; sectionId?: string; subSectionId?: string }>;
}) {
  const params = await searchParams;
  const shopId = params.shopId ?? '';
  const sectionId = params.sectionId ?? '';
  const subSectionId = params.subSectionId ?? '';
  const data = shopId && sectionId && subSectionId
    ? await getMultiListingWizardData(shopId, sectionId, subSectionId)
    : null;

  return (
    <main className="mx-auto w-full max-w-5xl px-6 py-10">
      <MultiListingWizard data={data} shopId={shopId} sectionId={sectionId} subSectionId={subSectionId} />
    </main>
  );
}
