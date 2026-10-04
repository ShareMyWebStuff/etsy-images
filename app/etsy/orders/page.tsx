import { AppContainer } from '@/components/AppContainer';
import { Navbar } from '@/components/Navbar';
import { getEtsyOrdersPageData } from '@/lib/etsy-orders';
import { EtsyOrdersClient } from './EtsyOrdersClient';

export const dynamic = 'force-dynamic';

export default async function EtsyOrdersPage() {
  const data = await getEtsyOrdersPageData();
  return <>
    <Navbar />
    <main className="py-8">
      <AppContainer><EtsyOrdersClient initialData={data} /></AppContainer>
    </main>
  </>;
}
