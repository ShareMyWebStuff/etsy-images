'use client';

import { AppContainer } from '@/components/AppContainer';
import { Navbar } from '@/components/Navbar';
import { Button } from '@/components/ui/button';

export default function SyncToPrintShrimpError({ reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return <>
    <Navbar />
    <main className="py-8">
      <AppContainer>
        <h1 className="text-2xl font-semibold">Sync to PrintShrimp</h1>
        <div role="alert" className="mt-4 grid gap-3 rounded-md border border-destructive/30 bg-destructive/5 p-4 text-sm">
          <p>Unable to load the PrintShrimp listings. Please try again.</p>
          <Button type="button" variant="outline" className="w-fit" onClick={reset}>Try again</Button>
        </div>
      </AppContainer>
    </main>
  </>;
}
