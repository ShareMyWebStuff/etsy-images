import { BackdropImagesClient } from '@/app/backdrop-images/BackdropImagesClient';
import { AppContainer } from '@/components/AppContainer';
import { Navbar } from '@/components/Navbar';

export default function BackdropImagesPage() {
  return (
    <div>
      <Navbar />
      <main className="py-5 sm:py-6 lg:py-8">
        <AppContainer><BackdropImagesClient /></AppContainer>
      </main>
    </div>
  );
}
