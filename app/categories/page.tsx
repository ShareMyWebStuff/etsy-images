import { Navbar } from '@/components/Navbar';
import { AppContainer } from '@/components/AppContainer';
import { CategoriesClient } from './CategoriesClient';
import { ETSY_LISTINGS_DIRECTORY } from '@/lib/config';
import { readdir } from '@/lib/s3-listing-storage';

export const dynamic = 'force-dynamic';

async function getCategories() {
  const entries = await readdir(ETSY_LISTINGS_DIRECTORY, { withFileTypes: true });

  return entries
    .filter((entry) => !entry.name.startsWith('.'))
    .map((entry) => entry.name)
    .sort((a, b) => a.localeCompare(b));
}

export default async function CategoriesPage() {
  const categories = await getCategories();

  return (
    <div>
      <Navbar />
      <main className="py-5 sm:py-6 lg:py-8">
        <AppContainer>
          <CategoriesClient categories={categories} />
        </AppContainer>
      </main>
    </div>
  );
}
