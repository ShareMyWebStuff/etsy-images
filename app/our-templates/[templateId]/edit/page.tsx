import { notFound } from 'next/navigation';

import { OurCategoryEditorClient } from '@/app/our-categories/OurCategoryEditorClient';
import { AppContainer } from '@/components/AppContainer';
import { Navbar } from '@/components/Navbar';
import { getOurCategoryEditorData } from '@/lib/our-categories';

export const dynamic = 'force-dynamic';

export default async function EditOurTemplatePage({ params }: { params: Promise<{ templateId: string }> }) {
  const { templateId } = await params;
  let data;
  try {
    data = await getOurCategoryEditorData(templateId);
  } catch {
    notFound();
  }
  return (
    <div>
      <Navbar />
      <main className="py-5 sm:py-6 lg:py-8">
        <AppContainer><OurCategoryEditorClient initialData={data} /></AppContainer>
      </main>
    </div>
  );
}
