import { act, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { ListingThumbnailChooser } from './ListingThumbnailChooser';

class ReadableImage {
  static instances: ReadableImage[] = [];
  naturalWidth = 0;
  naturalHeight = 0;
  onload: (() => void) | null = null;
  onerror: (() => void) | null = null;
  src = '';
  constructor() { ReadableImage.instances.push(this); }
  load(width: number, height: number) {
    this.naturalWidth = width;
    this.naturalHeight = height;
    this.onload?.();
  }
}

function selectFile(name = 'artwork.png') {
  const file = new File(['image bytes'], name, { type: 'image/png' });
  fireEvent.change(screen.getByLabelText('Choose thumbnail image'), { target: { files: [file] } });
  return file;
}

async function finishReading(width: number, height: number, index = ReadableImage.instances.length - 1) {
  await act(async () => { ReadableImage.instances[index].load(width, height); });
}

describe('ListingThumbnailChooser', () => {
  const revokeObjectURL = vi.fn();

  beforeEach(() => {
    ReadableImage.instances = [];
    let imageNumber = 0;
    vi.stubGlobal('Image', ReadableImage);
    Object.defineProperty(URL, 'createObjectURL', { configurable: true, value: vi.fn(() => `blob:thumbnail-${++imageNumber}`) });
    Object.defineProperty(URL, 'revokeObjectURL', { configurable: true, value: revokeObjectURL });
    revokeObjectURL.mockClear();
  });

  afterEach(() => vi.unstubAllGlobals());

  it('explains supported images before selection and reports when a file is being read', () => {
    render(<ListingThumbnailChooser onSave={vi.fn()} />);
    expect(screen.getByText(/Choose a JPG, PNG, or WEBP image in a 2:3 or 4:5 ratio/)).toBeTruthy();
    selectFile('reading.png');
    expect(screen.getByRole('status').textContent).toBe('Reading thumbnail image…');
    expect((screen.getByLabelText('Choose thumbnail image') as HTMLInputElement).disabled).toBe(true);
    expect(screen.getByText('Selected: reading.png')).toBeTruthy();
  });

  it.each([
    { width: 2000, height: 3000, orientation: 'Portrait', ratio: '2:3' },
    { width: 3000, height: 2000, orientation: 'Landscape', ratio: '2:3' },
    { width: 2400, height: 3000, orientation: 'Portrait', ratio: '4:5' },
    { width: 3000, height: 2400, orientation: 'Landscape', ratio: '4:5' },
  ])('previews valid $orientation $ratio artwork before saving', async ({ width, height, orientation, ratio }) => {
    const onSave = vi.fn().mockResolvedValue(undefined);
    render(<ListingThumbnailChooser onSave={onSave} />);
    const file = selectFile();
    await finishReading(width, height);
    const dialog = screen.getByRole('dialog', { name: 'Confirm thumbnail' });
    expect(within(dialog).getByAltText('Selected thumbnail').getAttribute('src')).toBe('blob:thumbnail-1');
    expect(within(dialog).getByText(`${width} × ${height} · ${orientation}`)).toBeTruthy();
    expect(within(dialog).getByText(new RegExp(`approximately ${ratio}`))).toBeTruthy();
    expect(onSave).not.toHaveBeenCalled();
    await act(async () => { fireEvent.click(within(dialog).getByRole('button', { name: 'Save thumbnail' })); });
    expect(onSave).toHaveBeenCalledWith(file, 0);
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(revokeObjectURL).toHaveBeenCalledWith('blob:thumbnail-1');
  });

  it('shows a rejected image filename, dimensions and ratio error beside the chooser', async () => {
    const onSave = vi.fn();
    render(<ListingThumbnailChooser onSave={onSave} />);
    selectFile('square-image.png');
    await finishReading(1024, 1024);
    expect(screen.getByText('Selected: square-image.png · 1024 × 1024 px')).toBeTruthy();
    expect(screen.getByRole('alert').textContent).toContain('Choose an image with a 2:3 or 4:5 aspect ratio.');
    expect(screen.getByRole('alert').parentElement?.querySelector('input[type=file]')).toBeTruthy();
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(onSave).not.toHaveBeenCalled();
    expect(revokeObjectURL).toHaveBeenCalledWith('blob:thumbnail-1');
  });

  it('shows a file reading failure beside the selected filename and allows another selection', async () => {
    render(<ListingThumbnailChooser onSave={vi.fn()} />);
    selectFile('damaged.png');
    await act(async () => { ReadableImage.instances[0].onerror?.(); });
    expect(screen.getByText('Selected: damaged.png')).toBeTruthy();
    expect(screen.getByRole('alert').textContent).toContain('The selected thumbnail could not be read.');
    selectFile('replacement.png');
    await finishReading(2000, 3000);
    expect(screen.queryByRole('alert')).toBeNull();
    expect(screen.getByRole('dialog')).toBeTruthy();
  });

  it('keeps upload failures in the confirmation dialog and allows retry with the chosen rotation', async () => {
    const onSave = vi.fn().mockRejectedValueOnce(new Error('Thumbnail upload failed. Please retry.')).mockResolvedValueOnce(undefined);
    render(<ListingThumbnailChooser onSave={onSave} />);
    const file = selectFile();
    await finishReading(3000, 2000);
    const dialog = screen.getByRole('dialog');
    fireEvent.click(within(dialog).getByRole('button', { name: 'Rotate right' }));
    expect(within(dialog).getByText('2000 × 3000 · Portrait')).toBeTruthy();
    await act(async () => { fireEvent.click(within(dialog).getByRole('button', { name: 'Save thumbnail' })); });
    expect(within(dialog).getByRole('alert').textContent).toBe('Thumbnail upload failed. Please retry.');
    expect(onSave).toHaveBeenLastCalledWith(file, 90);
    expect(revokeObjectURL).not.toHaveBeenCalled();
    await act(async () => { fireEvent.click(within(dialog).getByRole('button', { name: 'Save thumbnail' })); });
    expect(onSave).toHaveBeenCalledTimes(2);
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('reports saving progress and prevents duplicate saves', async () => {
    let finishSave!: () => void;
    const onSave = vi.fn(() => new Promise<void>((resolve) => { finishSave = resolve; }));
    render(<ListingThumbnailChooser onSave={onSave} />);
    selectFile();
    await finishReading(2000, 3000);
    fireEvent.click(screen.getByRole('button', { name: 'Save thumbnail' }));
    expect(screen.getByRole('status').textContent).toBe('Saving thumbnail image…');
    const saveButton = screen.getByRole('button', { name: 'Saving...' }) as HTMLButtonElement;
    expect(saveButton.disabled).toBe(true);
    fireEvent.click(saveButton);
    expect(onSave).toHaveBeenCalledTimes(1);
    await act(async () => finishSave());
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('ignores an older image read after a newer selection and releases previews on unmount', async () => {
    const view = render(<ListingThumbnailChooser onSave={vi.fn()} />);
    selectFile('first.png');
    selectFile('second.png');
    await finishReading(3000, 2000, 1);
    await finishReading(1024, 1024, 0);
    const dialog = screen.getByRole('dialog');
    expect(within(dialog).getByText('second.png')).toBeTruthy();
    expect(within(dialog).queryByRole('alert')).toBeNull();
    expect(within(dialog).getByAltText('Selected thumbnail').getAttribute('src')).toBe('blob:thumbnail-2');
    expect(revokeObjectURL).toHaveBeenCalledWith('blob:thumbnail-1');
    view.unmount();
    expect(revokeObjectURL).toHaveBeenCalledWith('blob:thumbnail-2');
  });
});
