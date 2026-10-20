import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { BackdropImagesClient } from './BackdropImagesClient';

describe('Backdrop Images', () => {
  beforeEach(() => {
    Object.defineProperty(URL, 'createObjectURL', { configurable: true, value: vi.fn(() => 'blob:background') });
    Object.defineProperty(URL, 'revokeObjectURL', { configurable: true, value: vi.fn() });
  });

  afterEach(() => vi.unstubAllGlobals());

  it('validates background uploads and has no frame controls', async () => {
    const user = userEvent.setup({ applyAccept: false });
    render(<BackdropImagesClient />);

    expect(screen.getByRole('heading', { name: 'Backdrop Images' })).toBeTruthy();
    expect(screen.queryByLabelText('Frame finish')).toBeNull();
    expect(screen.queryByLabelText('Shadow strength')).toBeNull();
    expect(screen.getByRole('button', { name: 'Download' }).hasAttribute('disabled')).toBe(true);

    await user.upload(screen.getByLabelText('Backdrop background image'), new File(['not an image'], 'room.txt', { type: 'text/plain' }));
    expect((await screen.findByRole('alert')).textContent).toContain('Choose a PNG, JPEG or WebP background image.');
  });

  it('creates an unlabelled pink ratio-locked editing guide for a readable background', async () => {
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
    render(<BackdropImagesClient />);

    await user.upload(screen.getByLabelText('Backdrop background image'), new File(['image'], 'nursery.webp', { type: 'image/webp' }));
    await waitFor(() => expect(screen.getByText(/nursery\.webp \(1600 × 1200px\)/)).toBeTruthy());
    await user.click(screen.getByRole('button', { name: /Reset placement/ }));

    const width = Number((screen.getByLabelText('Opening width (px)') as HTMLInputElement).value);
    const height = Number((screen.getByLabelText('Opening height (px)') as HTMLInputElement).value);
    expect(height).toBe(Math.round(width * Math.SQRT2));
    expect(screen.queryByText('Paper opening')).toBeNull();
    expect(screen.getByTestId('paper-opening').className).toContain('bg-[#ff1493]');
    expect(screen.getByRole('button', { name: 'Download' }).hasAttribute('disabled')).toBe(false);
  });
});
