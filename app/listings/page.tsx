import Link from 'next/link';
import type { Route } from 'next';
import { ArrowLeft } from 'lucide-react';
import { Navbar } from '@/components/Navbar';
import { AppContainer } from '@/components/AppContainer';
import { Button } from '@/components/ui/button';
import { getSectionListingsPageData, getSubSectionListingsPageData } from '@/lib/listing-table';
import { ListingsClient } from './ListingsClient';
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
  const backHref = shopId
        ? `/shops?shopId=${encodeURIComponent(shopId)}`
        : null;
  const backLabel = 'Back to Sections';
  const subSectionListingsData = shopId && sectionId
    ? subSectionId
      ? await getSubSectionListingsPageData(shopId, sectionId, subSectionId)
      : await getSectionListingsPageData(shopId, sectionId)
    : null;

  return (
    <div>
      <Navbar />
      <main className="py-5 sm:py-6 lg:py-8">
        <AppContainer>
          {backHref ? (
            <div className="mb-4">
              <Button asChild variant="outline">
                <Link href={backHref as Route}>
                  <ArrowLeft className="h-4 w-4" aria-hidden="true" />
                  {backLabel}
                </Link>
              </Button>
            </div>
          ) : null}
          {sectionId ? (
            <SubSectionListingsTable
              data={subSectionListingsData}
              shopId={shopId}
              sectionId={sectionId}
              subSectionId={subSectionListingsData?.subSection.id ?? null}
            />
          ) : (
            <ListingsClient />
          )}
        </AppContainer>
      </main>
    </div>
  );
}
