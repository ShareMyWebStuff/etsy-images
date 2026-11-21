import { AppContainer } from '@/components/AppContainer';
import { Navbar } from '@/components/Navbar';
import { OurTemplateImagesClient } from './OurTemplateImagesClient';

export default function OurTemplateImagesPage() {
  return <div><Navbar /><main className="py-5 sm:py-6 lg:py-8"><AppContainer><OurTemplateImagesClient /></AppContainer></main></div>;
}
