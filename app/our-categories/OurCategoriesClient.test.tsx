import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { OurCategoryListRow } from '@/lib/our-categories';

import { OurCategoriesClient } from './OurCategoriesClient';

describe('Our Templates list', () => {
  afterEach(() => vi.unstubAllGlobals());
  const copyCategories: OurCategoryListRow[] = [
    { id: '1', name: 'Nursery source', templateType: 'single', itemCount: 1, followedTemplateName: null, listingCount: 2, imageTemplateCount: 2 },
    { id: '2', name: 'Ocean destination', templateType: 'single', itemCount: 1, followedTemplateName: null, listingCount: 0, imageTemplateCount: 0 },
    { id: '3', name: 'Occupied destination', templateType: 'single', itemCount: 1, followedTemplateName: null, listingCount: 1, imageTemplateCount: 0 },
    { id: '4', name: 'Multiple source', templateType: 'multiple', itemCount: 3, followedTemplateName: null, listingCount: 0, imageTemplateCount: 1 },
    { id: '5', name: 'Three destination', templateType: 'multiple', itemCount: 3, followedTemplateName: null, listingCount: 0, imageTemplateCount: 0 },
    { id: '6', name: 'Six destination', templateType: 'multiple', itemCount: 6, followedTemplateName: null, listingCount: 0, imageTemplateCount: 0 },
  ];

  it('searches eligible sources and destinations and copies the selected template', async () => {
    const user = userEvent.setup();
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ categories: copyCategories.map((category) => category.id === '2' ? { ...category, imageTemplateCount: 2 } : category) }) });
    vi.stubGlobal('fetch', fetchMock);
    render(<OurCategoriesClient initialCategories={copyCategories} />);
    await user.click(screen.getByRole('button', { name: 'Copy Template' }));
    expect((screen.getByLabelText('Template Type') as HTMLSelectElement).value).toBe('single');
    expect((screen.getByRole('button', { name: 'Copy' }) as HTMLButtonElement).disabled).toBe(true);
    await user.click(screen.getByRole('combobox', { name: 'Copy From' }));
    expect(screen.queryByRole('option', { name: 'Multiple source' })).toBeNull();
    expect(screen.queryByRole('option', { name: 'Ocean destination' })).toBeNull();
    await user.type(screen.getByRole('combobox', { name: 'Copy From' }), 'nurs');
    await user.click(screen.getByRole('option', { name: 'Nursery source' }));
    await user.click(screen.getByRole('combobox', { name: 'Copy To' }));
    expect(screen.getByRole('option', { name: 'Occupied destination' })).toBeTruthy();
    await user.type(screen.getByRole('combobox', { name: 'Copy To' }), 'ocean');
    await user.click(screen.getByRole('option', { name: 'Ocean destination' }));
    await user.click(screen.getByRole('button', { name: 'Copy' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(fetchMock).toHaveBeenCalledWith('/api/our-categories/copy', expect.objectContaining({
      method: 'POST', body: JSON.stringify({ sourceCategoryId: '1', targetCategoryId: '2' }),
    }));
    const row = screen.getByText('Ocean destination').closest('tr');
    expect(within(row!).getAllByRole('cell')[4].textContent).toBe('2');
  });

  it('limits multiple destinations to matching item counts and cancels without copying', async () => {
    const user = userEvent.setup();
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    render(<OurCategoriesClient initialCategories={copyCategories} />);
    await user.click(screen.getByRole('button', { name: 'Copy Template' }));
    await user.selectOptions(screen.getByLabelText('Template Type'), 'multiple');
    await user.click(screen.getByRole('combobox', { name: 'Copy From' }));
    await user.keyboard('{Enter}');
    await user.click(screen.getByRole('combobox', { name: 'Copy To' }));
    expect(screen.getByRole('option', { name: 'Three destination' })).toBeTruthy();
    expect(screen.queryByRole('option', { name: 'Six destination' })).toBeNull();
    await user.keyboard('{Escape}');
    await user.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('asks whether to create a single or multiple template', async () => {
    const user = userEvent.setup();
    render(<OurCategoriesClient initialCategories={[]} />);
    await user.click(screen.getByRole('button', { name: 'Create' }));
    const dialog = screen.getByRole('dialog');
    expect(within(dialog).getByRole('heading', { name: 'Create Template' })).toBeTruthy();
    expect(within(dialog).getByText('Select if you want a single template or a multiple template.')).toBeTruthy();
    expect(within(dialog).getByRole('link', { name: 'Single Template' }).getAttribute('href')).toBe('/our-templates/create');
    expect(within(dialog).getByRole('link', { name: 'Multiple Template' }).getAttribute('href')).toBe('/our-templates/create/multiple');
  });

  it('shows the template type and followed template', () => {
    render(<OurCategoriesClient initialCategories={[{
      id: '10',
      name: 'Six print set',
      templateType: 'multiple',
      followedTemplateName: 'Nursery print',
      listingCount: 0,
      imageTemplateCount: 2,
    }]} />);
    const row = screen.getByText('Six print set').closest('tr');
    expect(row).toBeTruthy();
    expect(within(row!).getByText('Multiple')).toBeTruthy();
    expect(within(row!).getByText('Nursery print')).toBeTruthy();
    expect((within(row!).getByRole('link', { name: 'Edit Six print set' }) as HTMLAnchorElement).getAttribute('href')).toBe('/our-templates/10/edit');
  });
});
