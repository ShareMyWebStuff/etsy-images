import { redirect } from 'next/navigation';

export default async function CreateOurCategoryRedirectPage({ searchParams }: {
  searchParams?: Promise<{ portraitEnabled?: string; landscapeEnabled?: string }>;
}) {
  const orientations = await searchParams;
  const query = new URLSearchParams();
  if (orientations?.portraitEnabled !== undefined) query.set('portraitEnabled', orientations.portraitEnabled);
  if (orientations?.landscapeEnabled !== undefined) query.set('landscapeEnabled', orientations.landscapeEnabled);
  redirect(`/our-templates/create${query.size ? `?${query}` : ''}`);
}
