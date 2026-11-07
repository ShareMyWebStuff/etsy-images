import { LoaderCircle } from 'lucide-react';
import { AppContainer } from '@/components/AppContainer';
import { Navbar } from '@/components/Navbar';

export default function SyncToPrintShrimpLoading() {
  return <>
    <Navbar />
    <main className="py-8">
      <AppContainer>
        <h1 className="text-2xl font-semibold">Sync to PrintShrimp</h1>
        <p role="status" className="mt-4 flex items-center gap-2 text-muted-foreground">
          <LoaderCircle className="h-4 w-4 animate-spin" aria-hidden="true" />
          Loading listings and checking PrintShrimp sync status…
        </p>
      </AppContainer>
    </main>
  </>;
}
