'use client';

import Link from 'next/link';
import type { Route } from 'next';
import { usePathname } from 'next/navigation';

import { AppContainer } from '@/components/AppContainer';
import {
  NavigationMenu,
  NavigationMenuContent,
  NavigationMenuItem,
  NavigationMenuLink,
  NavigationMenuList,
  NavigationMenuTrigger,
} from '@/components/ui/navigation-menu';

type NavGroup = {
  title: string;
  items: Array<{
    label: string;
    href: Route;
  }>;
};

const navGroups = [
  {
    title: 'Local',
    items: [
      { label: 'Categories', href: '/categories' },
      { label: 'Listings', href: '/listings' },
      { label: 'Price Update', href: '/price-update' },
      { label: 'Shops', href: '/shops' },
    ],
  },
  {
    title: 'Etsy',
    items: [
      { label: 'Sync to Etsy', href: '/sync-to-etsy' },
      { label: 'Publish to Etsy', href: '/publish-to-etsy' },
      { label: 'Compare', href: '/compare' },
    ],
  },
  {
    title: 'Pinterest',
    items: [
      { label: 'Overview', href: '/pinterest' },
      { label: 'Connection', href: '/pinterest/connection' },
      { label: 'Boards', href: '/pinterest/boards' },
      { label: 'Pins', href: '/pinterest/pins' },
      { label: 'Campaigns', href: '/pinterest/campaigns' },
      { label: 'Queue', href: '/pinterest/queue' },
      { label: 'Analytics', href: '/pinterest/analytics' },
      { label: 'Trends', href: '/pinterest/trends' },
      { label: 'AI Campaign', href: '/pinterest/ai-campaign' },
    ],
  },
  {
    title: 'Admin',
    items: [
      { label: 'Accounts', href: '/admin/accounts' },
      { label: 'Set Prices', href: '/admin/set-prices' },
      { label: 'Backup', href: '/admin/backup' },
      { label: 'Edit Listing', href: '/admin/edit-listing' },
      { label: 'Connect Etsy', href: '/connect-etsy' },
      { label: 'Test', href: '/test' },
    ],
  },
] satisfies NavGroup[];

export function Navbar() {
  const pathname = usePathname();

  return (
    <header className="sticky top-0 z-40 w-full border-b border-border bg-card/90 backdrop-blur">
      <AppContainer className="flex min-h-14 items-center justify-between gap-4 py-2">
        <Link href="/" className="text-lg font-semibold text-card-foreground no-underline">
          Etsy
        </Link>

        <NavigationMenu viewport={false}>
          <NavigationMenuList>
            {navGroups.map((group, index) => (
              <NavigationMenuItem key={group.title}>
                <NavigationMenuTrigger className={group.items.some((item) => pathname === item.href || pathname.startsWith(`${item.href}/`)) ? 'bg-accent text-accent-foreground' : undefined}>
                  {group.title}
                </NavigationMenuTrigger>
                <NavigationMenuContent
                  className={`absolute top-full mt-2 w-auto overflow-hidden rounded-md border border-border bg-popover text-popover-foreground shadow-md ${
                    index === 0 ? 'left-0' : index === navGroups.length - 1 ? 'left-auto right-0' : 'left-1/2 -translate-x-1/2'
                  }`}
                >
                  <ul className="grid w-56 gap-1 p-2">
                    {group.items.map((item) => (
                      <li key={item.href}>
                        <NavigationMenuLink asChild>
                          <Link
                            href={item.href}
                            aria-current={pathname === item.href || pathname.startsWith(`${item.href}/`) ? 'page' : undefined}
                            className={pathname === item.href || pathname.startsWith(`${item.href}/`) ? 'bg-accent text-accent-foreground' : undefined}
                          >
                            {item.label}
                          </Link>
                        </NavigationMenuLink>
                      </li>
                    ))}
                  </ul>
                </NavigationMenuContent>
              </NavigationMenuItem>
            ))}
          </NavigationMenuList>
        </NavigationMenu>
      </AppContainer>
    </header>
  );
}
