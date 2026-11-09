'use client';

import { AppContainer } from '@/components/AppContainer';
import { Navbar } from '@/components/Navbar';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';

export default function MarketsDeliveryError({ reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return <div><Navbar /><main className="py-5 sm:py-6 lg:py-8"><AppContainer>
    <Card><CardHeader><CardTitle>Markets &amp; Delivery</CardTitle></CardHeader><CardContent className="space-y-4">
      <p role="alert" className="text-sm">Unable to load this shop's delivery profiles. Check that the application database is available, then try again.</p>
      <Button onClick={reset}>Try again</Button>
    </CardContent></Card>
  </AppContainer></main></div>;
}
