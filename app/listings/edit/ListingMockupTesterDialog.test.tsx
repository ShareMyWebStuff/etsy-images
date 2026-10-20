import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { ListingMockupTesterDialog } from './ListingMockupTesterDialog';

describe('Listing mockup tester dialog', () => {
  beforeEach(() => {
    Object.defineProperty(URL, 'createObjectURL', { configurable: true, value: vi.fn(() => 'blob:background') });
    Object.defineProperty(URL, 'revokeObjectURL', { configurable: true, value: vi.fn() });
  });

  afterEach(() => vi.unstubAllGlobals());

  it('uses the active listing artwork and validates background uploads', async () => {
    const user = userEvent.setup({ applyAccept: false });
    render(<ListingMockupTesterDialog
      open
      onOpenChange={vi.fn()}
      context={{ shopId: '10', sectionId: '20', subSectionId: '30', listingId: '40' }}
      listingName="Triceratops"
      artworkOptions={[{ id: 'primary', label: 'Primary artwork', url: '/artwork.png', primary: true }]}
    />);

    expect(screen.getByRole('heading', { name: 'Tester' })).toBeTruthy();
    expect((screen.getByLabelText('Listing artwork') as HTMLSelectElement).value).toBe('primary');
    const backgroundColour = screen.getByLabelText('Background Colour') as HTMLSelectElement;
    expect(backgroundColour.value).toBe('#F5F0E8');
    expect([...backgroundColour.options].map((option) => option.value)).toEqual(['#FFFFFF', '#FAF8F4', '#F5F0E8']);
    expect((screen.getByLabelText('Frame thickness') as HTMLInputElement).value).toBe('4');
    expect((screen.getByLabelText('Frame depth') as HTMLInputElement).value).toBe('1');
    expect((screen.getByLabelText('Shadow strength') as HTMLInputElement).value).toBe('17');
    expect(screen.getByRole('button', { name: 'Generate' }).hasAttribute('disabled')).toBe(true);

    await user.upload(screen.getByLabelText('Room background image'), new File(['not an image'], 'room.txt', { type: 'text/plain' }));
    expect((await screen.findByRole('alert')).textContent).toContain('Choose a PNG, JPEG or WebP room background.');
  });

  it('creates a ratio-locked default placement for a readable background', async () => {
    class ReadableImage {
      naturalWidth = 1600;
      naturalHeight = 1200;
      decoding = 'async';
      onload: (() => void) | null = null;
      onerror: (() => void) | null = null;
      set src(_value: string) {
        queueMicrotask(() => this.onload?.());
      }
    }
    vi.stubGlobal('Image', ReadableImage);
    const user = userEvent.setup();
    render(<ListingMockupTesterDialog
      open
      onOpenChange={vi.fn()}
      context={{ shopId: '10', sectionId: '20', subSectionId: '30', listingId: '41' }}
      listingName="Stegosaurus"
      artworkOptions={[{ id: 'primary', label: 'Primary artwork', url: '/artwork.png', primary: true }]}
    />);

    await user.upload(screen.getByLabelText('Room background image'), new File(['image'], 'nursery.png', { type: 'image/png' }));
    await waitFor(() => expect(screen.getByText(/nursery\.png \(1600 × 1200px\)/)).toBeTruthy());
    await user.click(screen.getByRole('button', { name: /Reset placement/ }));

    const width = Number((screen.getByLabelText('Opening width (px)') as HTMLInputElement).value);
    const height = Number((screen.getByLabelText('Opening height (px)') as HTMLInputElement).value);
    expect(height).toBe(Math.round(width * Math.SQRT2));
    expect(screen.getByRole('button', { name: 'Generate' }).hasAttribute('disabled')).toBe(false);
    expect((screen.getByLabelText('Frame depth') as HTMLInputElement).disabled).toBe(true);
    await user.selectOptions(screen.getByLabelText('Frame finish'), 'oak');
    await waitFor(() => expect((screen.getByLabelText('Frame depth') as HTMLInputElement).disabled).toBe(false));
  });
});
