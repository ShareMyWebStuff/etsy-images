import { OurCategoryEditorClient } from '@/app/our-categories/OurCategoryEditorClient';
import { AppContainer } from '@/components/AppContainer';
import { Navbar } from '@/components/Navbar';
import { getOurCategoryEditorData } from '@/lib/our-categories';

export const dynamic = 'force-dynamic';

export default async function CreateOurTemplatePage() {
  const data = await getOurCategoryEditorData();
  return (
    <div>
      <Navbar />
      <main className="py-5 sm:py-6 lg:py-8">
        <AppContainer><OurCategoryEditorClient initialData={data} /></AppContainer>
      </main>
    </div>
  );
}
