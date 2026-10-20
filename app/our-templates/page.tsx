import { OurCategoriesClient } from '@/app/our-categories/OurCategoriesClient';
import { AppContainer } from '@/components/AppContainer';
import { Navbar } from '@/components/Navbar';
import { getOurCategories } from '@/lib/our-categories';

export const dynamic = 'force-dynamic';

export default async function OurTemplatesPage() {
  const templates = await getOurCategories();
  return (
    <div>
      <Navbar />
      <main className="py-5 sm:py-6 lg:py-8">
        <AppContainer><OurCategoriesClient initialCategories={templates} /></AppContainer>
      </main>
    </div>
  );
}
