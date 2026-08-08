import { AppContainer } from '@/components/AppContainer';
import { Navbar } from '@/components/Navbar';
import { CompareClient } from './CompareClient';

export default function ComparePage() {
  return <><Navbar /><main className="py-8"><AppContainer><CompareClient /></AppContainer></main></>;
}
