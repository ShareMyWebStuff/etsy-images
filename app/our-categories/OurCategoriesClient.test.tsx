import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';

import { OurCategoriesClient } from './OurCategoriesClient';

describe('Our Templates list', () => {
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
