import { AppContainer } from '@/components/AppContainer';
import { Navbar } from '@/components/Navbar';
import { getBackupTableCounts } from '@/lib/database-backup';

import { BackupClient } from './BackupClient';

export const dynamic = 'force-dynamic';

export default async function BackupPage() {
  const tables = await getBackupTableCounts();

  return (
    <div>
      <Navbar />
      <main className="py-5 sm:py-6 lg:py-8">
        <AppContainer>
          <BackupClient initialTables={tables} />
        </AppContainer>
      </main>
    </div>
  );
}
