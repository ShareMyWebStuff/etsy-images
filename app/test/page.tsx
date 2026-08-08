import { Navbar } from '@/components/Navbar';
import { AppContainer } from '@/components/AppContainer';
import { ListingsClient } from '@/app/listings/ListingsClient';

export default function TestPage() {
  return (
    <div>
      <Navbar />

      <main className="py-5 sm:py-6 lg:py-8">
        <AppContainer>
          <ListingsClient showEtsyTools showJsonResponse />
        </AppContainer>
      </main>
    </div>
  );
}
