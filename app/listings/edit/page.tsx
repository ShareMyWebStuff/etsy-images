import Link from 'next/link';
import type { Route } from 'next';
import { ArrowLeft } from 'lucide-react';
import { AppContainer } from '@/components/AppContainer';
import { Navbar } from '@/components/Navbar';
import { Button } from '@/components/ui/button';
import { getListingEditorData } from '@/lib/listing-editor';
import { ListingEditorClient } from './ListingEditorClient';

type EditListingPageProps = {
  searchParams?: Promise<{
    shopId?: string;
    sectionId?: string;
    subSectionId?: string;
    listingId?: string;
    tab?: string;
  }>;
};

export default async function EditListingPage({ searchParams }: EditListingPageProps) {
  const resolvedSearchParams = await searchParams;
  const shopId = resolvedSearchParams?.shopId ?? '';
  const sectionId = resolvedSearchParams?.sectionId ?? '';
  const subSectionId = resolvedSearchParams?.subSectionId ?? '';
  const listingId = resolvedSearchParams?.listingId ?? '';
  const data =
    shopId && sectionId && subSectionId && listingId
      ? await getListingEditorData({
          shopId,
          sectionId,
          subSectionId,
          listingId,
        })
      : null;
  const backHref =
    shopId && sectionId && subSectionId
      ? `/listings?shopId=${encodeURIComponent(shopId)}&sectionId=${encodeURIComponent(
          sectionId
        )}&subSectionId=${encodeURIComponent(subSectionId)}`
      : '/listings';

  return (
    <div>
      <Navbar />
      <main className="py-5 sm:py-6 lg:py-8">
        <AppContainer>
          <div className="mb-4">
            <Button asChild variant="outline">
              <Link href={backHref as Route}>
                <ArrowLeft className="h-4 w-4" aria-hidden="true" />
                Back to Listings
              </Link>
            </Button>
          </div>

          <ListingEditorClient initialData={data} initialTab={resolvedSearchParams?.tab === 'downloads' ? 'downloads' : 'images'} />
        </AppContainer>
      </main>
    </div>
  );
}
