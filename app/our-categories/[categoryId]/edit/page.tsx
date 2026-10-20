import { redirect } from 'next/navigation';

export default async function EditOurCategoryRedirectPage({ params }: { params: Promise<{ categoryId: string }> }) {
  const { categoryId } = await params;
  redirect(`/our-templates/${encodeURIComponent(categoryId)}/edit`);
}
