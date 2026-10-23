import { notFound } from 'next/navigation';

import { AppContainer } from '@/components/AppContainer';
import { Navbar } from '@/components/Navbar';
import { getOurCategoryEditorData } from '@/lib/our-categories';
import { NewImageTemplateEditorClient } from '../NewImageTemplateEditorClient';

export const dynamic = 'force-dynamic';

export default async function EditGridImageTemplatePage({
  params,
}: {
  params: Promise<{ templateId: string; imageTemplateId: string }>;
}) {
  const { templateId, imageTemplateId } = await params;
  let data;
  try {
    data = await getOurCategoryEditorData(templateId);
  } catch {
    notFound();
  }
  const imageTemplate = data.imageTemplates.find((candidate) => candidate.id === imageTemplateId);
  if (!imageTemplate || imageTemplate.isLinked || !imageTemplate.openingRegions.some((region) => region.grid)) notFound();

  return (
    <div>
      <Navbar />
      <main className="py-5 sm:py-6 lg:py-8">
        <AppContainer>
          <NewImageTemplateEditorClient data={data} initialTemplate={imageTemplate} />
        </AppContainer>
      </main>
    </div>
  );
}
