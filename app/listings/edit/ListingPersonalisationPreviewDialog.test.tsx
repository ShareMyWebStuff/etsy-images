import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { ListingPersonalisationPreviewDialog } from './ListingPersonalisationPreviewDialog';

describe('ListingPersonalisationPreviewDialog', () => {
  beforeEach(() => {
    let imageNumber = 0;
    Object.defineProperty(URL, 'createObjectURL', {
      configurable: true,
      value: vi.fn(() => `blob:preview-${++imageNumber}`),
    });
    Object.defineProperty(URL, 'revokeObjectURL', { configurable: true, value: vi.fn() });
    vi.stubGlobal('fetch', vi.fn(async () => new Response(new Blob(['image'], { type: 'image/webp' }), {
      status: 200,
      headers: { 'Content-Type': 'image/webp' },
    })));
  });

  it('generates every enabled size and moves between the completed previews', async () => {
    const user = userEvent.setup();
    render(<ListingPersonalisationPreviewDialog
      open
      onOpenChange={vi.fn()}
      context={{ shopId: '1', sectionId: '2', subSectionId: '3', listingId: '4' }}
      sizes={[{ key: 'a5', label: 'A5' }, { key: 'a4', label: 'A4' }]}
      allowTop
      allowBottom
    />);

    await user.type(screen.getByLabelText('Preview Top Text'), 'Alice');
    await user.type(screen.getByLabelText('Preview Bottom Text'), 'Room');
    await user.click(screen.getByRole('button', { name: 'Generate' }));

    await waitFor(() => expect(screen.getByText('All 2 images have been generated.')).toBeTruthy());
    expect(fetch).toHaveBeenCalledTimes(2);
    expect(screen.getByText(/A5/).textContent).toContain('1 of 2');
    const firstRequest = JSON.parse(String((fetch as ReturnType<typeof vi.fn>).mock.calls[0][1]?.body));
    expect(firstRequest).toMatchObject({ sizeKey: 'a5', topText: 'Alice', bottomText: 'Room', borderEnabled: false });

    await user.click(screen.getByRole('button', { name: /Next/ }));
    expect(screen.getByText(/A4/).textContent).toContain('2 of 2');
  });
});
