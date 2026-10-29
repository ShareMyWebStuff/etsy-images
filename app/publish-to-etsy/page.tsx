import { AppContainer } from '@/components/AppContainer';
import { Navbar } from '@/components/Navbar';
import { getSyncToEtsyData } from '@/lib/sync-to-etsy';
import { prisma } from '@/lib/prisma';
import { SyncToEtsyClient } from '../sync-to-etsy/SyncToEtsyClient';

export const dynamic = 'force-dynamic';

export default async function PublishToEtsyPage() {
  const [data, shops] = await Promise.all([
    getSyncToEtsyData(),
    prisma.etsyShop.findMany({
      orderBy: [{ shopName: 'asc' }, { etsyShopId: 'asc' }],
      select: { etsyShopId: true, shopName: true, title: true },
    }),
  ]);
  const shopOptions = shops.map((shop) => ({
    id: shop.etsyShopId.toString(),
    name: shop.shopName ?? shop.title ?? `Shop ${shop.etsyShopId}`,
  }));

  return (
    <>
      <Navbar />
      <main className="py-8">
        <AppContainer>
          <SyncToEtsyClient initialData={data} mode="publish" shops={shopOptions} />
        </AppContainer>
      </main>
    </>
  );
}
