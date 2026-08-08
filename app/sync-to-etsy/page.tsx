import { AppContainer } from '@/components/AppContainer';
import { Navbar } from '@/components/Navbar';
import { getSyncToEtsyData } from '@/lib/sync-to-etsy';
import { SyncToEtsyClient } from './SyncToEtsyClient';

export const dynamic = 'force-dynamic';

export default async function SyncToEtsyPage() {
  const data = await getSyncToEtsyData();
  return <><Navbar /><main className="py-8"><AppContainer><SyncToEtsyClient initialData={data} /></AppContainer></main></>;
}
