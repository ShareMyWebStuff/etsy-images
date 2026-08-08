import { AppContainer } from '@/components/AppContainer';
import { Navbar } from '@/components/Navbar';
import { getPriceUpdateData } from '@/lib/price-update';
import { PriceUpdateClient } from './PriceUpdateClient';

export const dynamic = 'force-dynamic';

export default async function PriceUpdatePage() {
  const data = await getPriceUpdateData();
  return <><Navbar /><main className="py-8"><AppContainer><PriceUpdateClient initialData={data} /></AppContainer></main></>;
}
