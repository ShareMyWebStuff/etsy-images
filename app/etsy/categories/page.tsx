import { AppContainer } from '@/components/AppContainer';
import { Navbar } from '@/components/Navbar';
import { getEtsyCategoriesPageData } from '@/lib/local-shop-sections';
import { EtsyCategoriesClient } from './EtsyCategoriesClient';

export const dynamic = 'force-dynamic';

export default async function EtsyCategoriesPage() {
  const data = await getEtsyCategoriesPageData();
  return (
    <div>
      <Navbar />
      <main className="py-5 sm:py-6 lg:py-8">
        <AppContainer><EtsyCategoriesClient initialData={data} /></AppContainer>
      </main>
    </div>
  );
}
