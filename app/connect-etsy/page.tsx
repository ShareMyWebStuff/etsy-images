import { Navbar } from '@/components/Navbar';
import { AppContainer } from '@/components/AppContainer';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';

export default function ConnectEtsyPage() {
  return (
    <div>
      <Navbar />
      <main className="py-5 sm:py-6 lg:py-8">
        <AppContainer>
          <Card>
            <CardHeader className="pb-4">
              <CardTitle>Connect Etsy</CardTitle>
              <CardDescription>Authorize this local app to read listings and create or update Etsy shop sections and draft listings.</CardDescription>
            </CardHeader>
            <CardContent>
              <Button asChild>
                <a href="/api/etsy/connect">Connect or Reauthorize Etsy</a>
              </Button>
            </CardContent>
          </Card>
        </AppContainer>
      </main>
    </div>
  );
}
