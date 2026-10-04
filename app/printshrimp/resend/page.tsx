import { AppContainer } from '@/components/AppContainer';
import { Navbar } from '@/components/Navbar';
import { searchEtsyOrdersForResend } from '@/lib/etsy-orders';
import { PrintShrimpResendClient } from './PrintShrimpResendClient';

export const dynamic = 'force-dynamic';

export default async function PrintShrimpResendPage() {
  const orders = await searchEtsyOrdersForResend('');

  return <>
    <Navbar />
    <main className="py-8">
      <AppContainer>
        <PrintShrimpResendClient initialOrders={orders} />
      </AppContainer>
    </main>
  </>;
}
