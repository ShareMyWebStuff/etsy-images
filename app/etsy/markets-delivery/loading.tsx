import { AppContainer } from '@/components/AppContainer';
import { Navbar } from '@/components/Navbar';

export default function MarketsDeliveryLoading() {
  return <div><Navbar /><main className="py-5 sm:py-6 lg:py-8"><AppContainer>
    <h1 className="text-2xl font-semibold tracking-tight">Markets &amp; Delivery</h1>
    <p role="status" className="mt-4 text-sm text-muted-foreground">Loading shops and delivery profiles...</p>
  </AppContainer></main></div>;
}
