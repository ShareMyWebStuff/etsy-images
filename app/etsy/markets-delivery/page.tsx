import { AppContainer } from '@/components/AppContainer';
import { Navbar } from '@/components/Navbar';
import { getMarketsDeliveryPageData } from '@/lib/markets-delivery';
import { MarketsDeliveryClient } from './MarketsDeliveryClient';

export const dynamic = 'force-dynamic';

export default async function MarketsDeliveryPage({
  searchParams,
}: {
  searchParams: Promise<{ shopId?: string; profileId?: string }>;
}) {
  const { shopId, profileId } = await searchParams;
  const data = await getMarketsDeliveryPageData(shopId);
  return (
    <div>
      <Navbar />
      <main className="py-5 sm:py-6 lg:py-8">
        <AppContainer><MarketsDeliveryClient initialData={data} initialProfileId={profileId} /></AppContainer>
      </main>
    </div>
  );
}
