import { AppContainer } from '@/components/AppContainer';
import { Navbar } from '@/components/Navbar';
import { getSyncToPrintShrimpData } from '@/lib/printshrimp/sync';
import { SyncToPrintShrimpClient } from './SyncToPrintShrimpClient';

export const dynamic = 'force-dynamic';

export default async function SyncToPrintShrimpPage() {
  const data = await getSyncToPrintShrimpData();
  return <><Navbar /><main className="py-8"><AppContainer><SyncToPrintShrimpClient initialData={data} /></AppContainer></main></>;
}
