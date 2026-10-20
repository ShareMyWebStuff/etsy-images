import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import { EtsyCategoriesClient } from './EtsyCategoriesClient';
import type { EtsyCategoriesPageData } from '@/lib/local-shop-sections';

function pageData(): EtsyCategoriesPageData {
  return {
    shopId: '66615491',
    categories: [
      {
        id: 3,
        etsyShopSectionId: 60763197,
        title: 'Kids & Nursery Prints',
        useForPrintFrames: true,
        useForCustomisedPrints: true,
        useForDigitalDownloads: false,
        listingCount: 0,
      },
      {
        id: 4,
        etsyShopSectionId: 60449656,
        title: 'Digital downloads',
        useForPrintFrames: false,
        useForCustomisedPrints: false,
        useForDigitalDownloads: true,
        listingCount: 2,
      },
    ],
  };
}

describe('EtsyCategoriesClient', () => {
  it('shows listing counts and locks edit and delete for categories used by listings', () => {
    render(<EtsyCategoriesClient initialData={pageData()} />);
    const usedRow = screen.getByText('Digital downloads').closest('tr');
    expect(usedRow).toBeTruthy();
    expect(within(usedRow!).getByText('2')).toBeTruthy();
    expect((within(usedRow!).getByRole('button', { name: 'Delete Digital downloads' }) as HTMLButtonElement).disabled).toBe(true);
    expect((within(usedRow!).getByRole('button', { name: 'Edit Digital downloads' }) as HTMLButtonElement).disabled).toBe(true);
    const unusedRow = screen.getByText('Kids & Nursery Prints').closest('tr');
    expect((within(unusedRow!).getByRole('button', { name: 'Delete Kids & Nursery Prints' }) as HTMLButtonElement).disabled).toBe(false);
    expect((within(unusedRow!).getByRole('button', { name: 'Edit Kids & Nursery Prints' }) as HTMLButtonElement).disabled).toBe(false);
  });

  it('opens the create popup with all product types selected and creates a category', async () => {
    const user = userEvent.setup();
    const updated = pageData();
    updated.categories.push({
      id: 5,
      etsyShopSectionId: 700,
      title: 'New category',
      useForPrintFrames: true,
      useForCustomisedPrints: true,
      useForDigitalDownloads: true,
      listingCount: 0,
    });
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue({
      ok: true,
      json: async () => ({ data: updated }),
    } as Response);
    render(<EtsyCategoriesClient initialData={pageData()} />);
    await user.click(screen.getByRole('button', { name: 'Create' }));
    const dialog = screen.getByRole('dialog');
    expect(within(dialog).getByRole('heading', { name: 'Create Etsy Category' })).toBeTruthy();
    expect((within(dialog).getByLabelText('Print / Frames') as HTMLInputElement).checked).toBe(true);
    expect((within(dialog).getByLabelText('Customised') as HTMLInputElement).checked).toBe(true);
    expect((within(dialog).getByLabelText('Digital Downloads') as HTMLInputElement).checked).toBe(true);
    await user.type(within(dialog).getByLabelText('Category name'), 'New category');
    await user.click(within(dialog).getByRole('button', { name: 'Create' }));
    await waitFor(() => expect(screen.getByText('New category')).toBeTruthy());
    expect(fetchMock).toHaveBeenCalledWith('/api/etsy/categories', expect.objectContaining({
      method: 'POST',
      body: JSON.stringify({
        shopId: '66615491',
        title: 'New category',
        usages: ['printFrames', 'customisedPrints', 'digitalDownloads'],
      }),
    }));
  });

  it('edits an unused category and confirms deletion', async () => {
    const user = userEvent.setup();
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue({
      ok: true,
      json: async () => ({ data: { ...pageData(), categories: [] } }),
    } as Response);
    render(<EtsyCategoriesClient initialData={pageData()} />);
    await user.click(screen.getByRole('button', { name: 'Edit Kids & Nursery Prints' }));
    const editDialog = screen.getByRole('dialog');
    expect(within(editDialog).getByRole('heading', { name: 'Edit Etsy Category' })).toBeTruthy();
    expect((within(editDialog).getByLabelText('Category name') as HTMLInputElement).value).toBe('Kids & Nursery Prints');
    await user.click(within(editDialog).getByRole('button', { name: 'Cancel' }));
    await user.click(screen.getByRole('button', { name: 'Delete Kids & Nursery Prints' }));
    const deleteDialog = screen.getByRole('dialog');
    expect(within(deleteDialog).getByRole('heading', { name: 'Delete Etsy Category?' })).toBeTruthy();
    await user.click(within(deleteDialog).getByRole('button', { name: 'Delete' }));
    await waitFor(() => expect(fetchMock).toHaveBeenCalledWith('/api/etsy/categories', expect.objectContaining({
      method: 'DELETE',
      body: JSON.stringify({ shopId: '66615491', categoryId: '3' }),
    })));
  });
});
