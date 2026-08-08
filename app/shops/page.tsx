import { Navbar } from '@/components/Navbar';
import { AppContainer } from '@/components/AppContainer';
import { getShopSectionsPageData, getShopSummary } from '@/lib/etsy-sync';
import { HomeClient } from '../HomeClient';
import { ShopSectionsClient } from './ShopSectionsClient';

type ShopsPageProps = {
  searchParams?: Promise<{
    shopId?: string;
  }>;
};

export const dynamic = 'force-dynamic';

async function loadInitialRows() {
  try {
    return await getShopSummary();
  } catch (error) {
    console.error('Failed to load Etsy shop summary:', error);
    return [];
  }
}

export default async function ShopsPage({ searchParams }: ShopsPageProps) {
  const shopId = (await searchParams)?.shopId;
  const sectionsData = shopId ? await getShopSectionsPageData(shopId) : null;
  const rows = shopId ? [] : await loadInitialRows();

  return (
    <div>
      <Navbar />

      <main className="py-5 sm:py-6 lg:py-8">
        <AppContainer>
          {shopId ? (
            <ShopSectionsClient initialData={sectionsData} shopId={shopId} />
          ) : (
            <HomeClient initialRows={rows} />
          )}
        </AppContainer>
      </main>
    </div>
  );
}
