import { AppContainer } from '@/components/AppContainer';
import { Navbar } from '@/components/Navbar';
import { getPrintShrimpOrdersPageData } from '@/lib/printshrimp/orders';
import { PrintShrimpOrdersClient } from './PrintShrimpOrdersClient';

export const dynamic = 'force-dynamic';

export default async function PrintShrimpOrdersPage() {
  const data = await getPrintShrimpOrdersPageData();
  return <>
    <Navbar />
    <main className="py-8">
      <AppContainer><PrintShrimpOrdersClient initialData={data} /></AppContainer>
    </main>
  </>;
}
