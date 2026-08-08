import { Navbar } from '@/components/Navbar';
import { AppContainer } from '@/components/AppContainer';
import { readdir } from 'fs/promises';
import { CategoriesClient } from './CategoriesClient';

export const dynamic = 'force-dynamic';

const categoriesDirectory = 'D:\\Etsy\\EtsyListings';

async function getCategories() {
  const entries = await readdir(categoriesDirectory, { withFileTypes: true });

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
