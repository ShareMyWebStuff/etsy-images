import { AppContainer } from '@/components/AppContainer';
import { Navbar } from '@/components/Navbar';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { getAdminListingEditorData, getAdminListingOptions } from '@/lib/listing-editor';
import { ListingEditorClient } from '../../listings/edit/ListingEditorClient';

type AdminEditListingPageProps = {
  searchParams?: Promise<{ listingId?: string }>;
};

export const dynamic = 'force-dynamic';

export default async function AdminEditListingPage({ searchParams }: AdminEditListingPageProps) {
  const listingId = (await searchParams)?.listingId ?? '';
  const [listings, data] = await Promise.all([
    getAdminListingOptions(),
    listingId ? getAdminListingEditorData(listingId) : Promise.resolve(null),
  ]);

  return (
    <div>
      <Navbar />
      <main className="py-5 sm:py-6 lg:py-8">
        <AppContainer className="space-y-6">
          <Card>
            <CardHeader>
              <CardTitle>Select Listing</CardTitle>
            </CardHeader>
            <CardContent>
              <form className="flex flex-col gap-3 sm:flex-row" method="get">
                <select
                  className="h-10 min-w-0 flex-1 rounded-md border border-input bg-background px-3 text-sm"
                  name="listingId"
                  defaultValue={listingId}
                  required
                >
                  <option value="" disabled>Select a listing</option>
                  {listings.map((listing) => (
                    <option key={listing.id} value={listing.id}>
                      {listing.title} — {listing.shopName} / {listing.sectionName}
                    </option>
                  ))}
                </select>
                <Button type="submit">Edit Listing</Button>
              </form>
            </CardContent>
          </Card>

          {listingId ? <ListingEditorClient initialData={data} showAdminEditSection /> : null}
        </AppContainer>
      </main>
    </div>
  );
}
