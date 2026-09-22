import { AppContainer } from '@/components/AppContainer';
import { Navbar } from '@/components/Navbar';
import { getAccountsData } from '@/lib/accounts';

import { AccountsClient } from './AccountsClient';

export const dynamic = 'force-dynamic';

export default async function AccountsPage() {
  const data = await getAccountsData();
  return (
    <div>
      <Navbar />
      <main className="py-5 sm:py-6 lg:py-8">
        <AppContainer>
          <AccountsClient initialData={data} />
        </AppContainer>
      </main>
    </div>
  );
}
