import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createListingPrintCropSettings, defaultNativeListingPrintCropDraft } from '@/lib/listing-print-crops';

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

  it('starts with the effective listing background colour', () => {
    render(<ListingMockupTesterDialog
      open
      onOpenChange={vi.fn()}
      context={{ shopId: '10', sectionId: '20', subSectionId: '30', listingId: '42' }}
      listingName="Apatosaurus"
      artworkOptions={[{ id: 'primary', label: 'Primary artwork', url: '/artwork.png', primary: true }]}
      initialBackgroundColour="#FAF8F4"
    />);

    expect((screen.getByLabelText('Background Colour') as HTMLSelectElement).value).toBe('#FAF8F4');
  });

  it('uses the saved thumbnail crop when generating the preview and downloadable mockup', async () => {
    class ReadableImage {
      naturalWidth = 1600;
      naturalHeight = 1200;
      onload: (() => void) | null = null;
      onerror: (() => void) | null = null;
      url = '';
      get src() { return this.url; }
      set src(url: string) {
        this.url = url;
        if (url === '/artwork.png') { this.naturalWidth = 4000; this.naturalHeight = 5000; }
        queueMicrotask(() => this.onload?.());
      }
    }
    vi.stubGlobal('Image', ReadableImage);
    const canvasContext = {
      save: vi.fn(), restore: vi.fn(), beginPath: vi.fn(), rect: vi.fn(), clip: vi.fn(),
      drawImage: vi.fn(), fillRect: vi.fn(), strokeRect: vi.fn(),
    };
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(canvasContext as unknown as CanvasRenderingContext2D);
    vi.spyOn(HTMLCanvasElement.prototype, 'toBlob').mockImplementation((callback) => callback(new Blob(['png'], { type: 'image/png' })));
    const crops = createListingPrintCropSettings(defaultNativeListingPrintCropDraft(4000, 5000), {
      fileName: 'thumbnail.png', updatedAt: '2026-11-13T12:00:00.000Z', width: 4000, height: 5000,
    });
    crops.regions['2x3'].x = 1 / 6;
    const user = userEvent.setup();
    render(<ListingMockupTesterDialog
      open onOpenChange={vi.fn()} context={{ shopId: '10', sectionId: '20', subSectionId: '30', listingId: '43' }}
      listingName="Jellyfish"
      artworkOptions={[{ id: 'primary', label: 'Primary artwork', url: '/artwork.png', primary: true, printCropSettings: crops }]}
    />);
    await user.selectOptions(screen.getByLabelText('Print ratio'), '2x3');
    await user.upload(screen.getByLabelText('Room background image'), new File(['image'], 'room.png', { type: 'image/png' }));
    await user.click(screen.getByRole('button', { name: /Reset placement/ }));
    await waitFor(() => expect(screen.getByRole('button', { name: 'Generate' }).hasAttribute('disabled')).toBe(false));
    await user.click(screen.getByRole('button', { name: 'Generate' }));
    await waitFor(() => expect(canvasContext.clip).toHaveBeenCalledOnce());
    const paper = canvasContext.rect.mock.calls[0] as unknown as number[];
    const artwork = canvasContext.drawImage.mock.calls.find((args) => (args[0] as ReadableImage).src === '/artwork.png')!;
    expect(artwork[1]).toBeCloseTo(paper[0] - (paper[2] * 0.2));
    expect(artwork[2]).toBeCloseTo(paper[1]);
    expect(artwork[3]).toBeCloseTo(paper[2] * 1.2);
    expect(artwork[4]).toBeCloseTo(paper[3]);
    expect(await screen.findByAltText('Jellyfish unframed room mockup')).toBeTruthy();
    expect(screen.getByRole('link', { name: /Download PNG/ }).getAttribute('href')).toBe('blob:background');
  });
});
