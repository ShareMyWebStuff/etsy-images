import { notFound } from 'next/navigation';

import { OurCategoryEditorClient, type OurCategoryEditorTab } from '@/app/our-categories/OurCategoryEditorClient';
import { AppContainer } from '@/components/AppContainer';
import { Navbar } from '@/components/Navbar';
import { getOurCategoryEditorData } from '@/lib/our-categories';

export const dynamic = 'force-dynamic';

export default async function EditOurTemplatePage({
  params,
  searchParams,
}: {
  params: Promise<{ templateId: string }>;
  searchParams: Promise<{ tab?: string | string[] }>;
}) {
  const { templateId } = await params;
  const requestedTab = (await searchParams).tab;
  const tab = Array.isArray(requestedTab) ? requestedTab[0] : requestedTab;
  const initialTab: OurCategoryEditorTab = tab === 'print-details' || tab === 'image-templates'
    ? tab
    : 'details';
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
        <AppContainer><OurCategoryEditorClient initialData={data} initialTab={initialTab} /></AppContainer>
      </main>
    </div>
  );
}
