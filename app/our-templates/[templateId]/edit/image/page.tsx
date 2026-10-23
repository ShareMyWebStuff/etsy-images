import { notFound } from 'next/navigation';

import { AppContainer } from '@/components/AppContainer';
import { Navbar } from '@/components/Navbar';
import { getOurCategoryEditorData } from '@/lib/our-categories';
import { NewImageTemplateEditorClient } from './NewImageTemplateEditorClient';

export const dynamic = 'force-dynamic';

export default async function CreateGridImageTemplatePage({ params }: { params: Promise<{ templateId: string }> }) {
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
        <AppContainer><NewImageTemplateEditorClient data={data} /></AppContainer>
      </main>
    </div>
  );
}
