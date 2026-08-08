import { Navbar } from '@/components/Navbar';
import { AppContainer } from '@/components/AppContainer';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';

export default function HomePage() {
  return (
    <div>
      <Navbar />

      <main className="py-5 sm:py-6 lg:py-8">
        <AppContainer>
          <Card>
            <CardHeader>
              <CardTitle>Instructions</CardTitle>
            </CardHeader>
            <CardContent>
              <ol className="space-y-4">
                <li>
                  <span className="font-medium">1. Select Local</span>
                  <ol className="mt-2 space-y-1 pl-6 text-muted-foreground">
                    <li>1.1. Create your shop sections</li>
                    <li>1.2. Create your listings under the section</li>
                  </ol>
                </li>
                <li>
                  <span className="font-medium">2. Go to Etsy Sync</span>
                  <ol className="mt-2 pl-6 text-muted-foreground">
                    <li>2.1. Upload your local listings to Etsy</li>
                  </ol>
                </li>
                <li>
                  <span className="font-medium">3. Go to Etsy Publish</span>
                  <ol className="mt-2 pl-6 text-muted-foreground">
                    <li>3.1. Select the listings you want to publish on Etsy</li>
                  </ol>
                </li>
              </ol>
            </CardContent>
          </Card>
        </AppContainer>
      </main>
    </div>
  );
}
