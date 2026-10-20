import Link from 'next/link';
import type { Route } from 'next';
import { redirect } from 'next/navigation';
import { ArrowLeft } from 'lucide-react';
import { Navbar } from '@/components/Navbar';
import { AppContainer } from '@/components/AppContainer';
import { Button } from '@/components/ui/button';
import { getSectionListingsPageData, getSubSectionListingsPageData } from '@/lib/listing-table';
import { SubSectionListingsTable } from './SubSectionListingsTable';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

type ListingsPageProps = {
  searchParams?: Promise<{
    shopId?: string;
    sectionId?: string;
    subSectionId?: string;
  }>;
};

export default async function ListingsPage({ searchParams }: ListingsPageProps) {
  const resolvedSearchParams = await searchParams;
  const shopId = resolvedSearchParams?.shopId ?? null;
  const sectionId = resolvedSearchParams?.sectionId ?? null;
  const subSectionId = resolvedSearchParams?.subSectionId ?? null;
  if (!shopId || !sectionId) redirect('/shops');

  const backHref = `/shops?shopId=${encodeURIComponent(shopId)}`;
  const backLabel = 'Back to Sections';
  const subSectionListingsData = subSectionId
    ? await getSubSectionListingsPageData(shopId, sectionId, subSectionId)
    : await getSectionListingsPageData(shopId, sectionId);

  return (
    <div>
      <Navbar />
      <main className="py-5 sm:py-6 lg:py-8">
        <AppContainer>
          <div className="mb-4">
            <Button asChild variant="outline">
              <Link href={backHref as Route}>
                <ArrowLeft className="h-4 w-4" aria-hidden="true" />
                {backLabel}
              </Link>
            </Button>
          </div>
          <SubSectionListingsTable
            data={subSectionListingsData}
            shopId={shopId}
            sectionId={sectionId}
            subSectionId={subSectionListingsData?.subSection.id ?? null}
          />
        </AppContainer>
      </main>
    </div>
  );
}
