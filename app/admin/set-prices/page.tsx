import { AppContainer } from '@/components/AppContainer';
import { Navbar } from '@/components/Navbar';
import { getSetPricesData } from '@/lib/set-prices';

import { SetPricesClient } from './SetPricesClient';

export const dynamic = 'force-dynamic';

export default async function SetPricesPage() {
  const data = await getSetPricesData();
  return (
    <div>
      <Navbar />
      <main className="py-5 sm:py-6 lg:py-8">
        <AppContainer>
          <SetPricesClient initialData={data} />
        </AppContainer>
      </main>
    </div>
  );
}
