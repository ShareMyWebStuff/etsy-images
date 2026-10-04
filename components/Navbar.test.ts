import { describe, expect, it } from 'vitest';

import { NAV_GROUPS } from '@/components/Navbar';

describe('main navigation', () => {
  it('places PrintShrimp between Pinterest and Admin with the sync route', () => {
    const titles = NAV_GROUPS.map((group) => group.title);
    expect(titles.slice(titles.indexOf('Pinterest'), titles.indexOf('Admin') + 1)).toEqual(['Pinterest', 'PrintShrimp', 'Admin']);
    expect(NAV_GROUPS.find((group) => group.title === 'PrintShrimp')?.items).toEqual([
      { label: 'Sync to PrintShrimp', href: '/sync-to-printshrimp' },
      { label: 'Orders', href: '/printshrimp/orders' },
      { label: 'Resend Item', href: '/printshrimp/resend' },
    ]);
    expect(NAV_GROUPS.find((group) => group.title === 'Etsy')?.items[0]).toEqual({
      label: 'Orders',
      href: '/etsy/orders',
    });
  });
});
