import { useState } from 'react';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { SectionListingImageGallery } from '@/app/listings/SectionListingImageGallery';
import type { ListingGalleryItem } from '@/lib/listing-gallery';

const listings: ListingGalleryItem[] = [
  { id: '500', listingName: 'Fox in the woods', hasThumbnail: true, thumbnailUpdatedAt: '2026-11-22T10:00:00.000Z', subSectionId: '8' },
  { id: '501', listingName: 'Otter by the river', hasThumbnail: true, thumbnailUpdatedAt: '2026-11-22T11:00:00.000Z', subSectionId: '9' },
  { id: '502', listingName: 'Missing artwork', hasThumbnail: false, thumbnailUpdatedAt: null, subSectionId: '8' },
  { id: '503', listingName: 'Unassigned artwork', hasThumbnail: true, thumbnailUpdatedAt: null, subSectionId: null },
];
const metadata = { sectionName: 'Woodland prints', listings };
const props = { open: true, onOpenChange: vi.fn(), shopId: '123', sectionId: '3', sectionName: 'Woodland' };
const json = (payload: unknown, ok = true) => ({ ok, json: async () => payload });
function deferred<T>() { let resolve!: (value: T) => void; const promise = new Promise<T>((next) => { resolve = next; }); return { promise, resolve }; }

afterEach(() => { vi.unstubAllGlobals(); vi.clearAllMocks(); });

describe('Section listing image gallery', () => {
  it('does not fetch or mount images while closed, then shows every title with lightweight scoped previews', async () => {
    const pending = deferred<ReturnType<typeof json>>();
    const fetchMock = vi.fn().mockReturnValue(pending.promise); vi.stubGlobal('fetch', fetchMock);
    const { rerender } = render(<SectionListingImageGallery {...props} open={false} />);
    expect(fetchMock).not.toHaveBeenCalled(); expect(screen.queryByRole('img')).toBeNull(); expect(screen.queryByRole('dialog')).toBeNull();
    rerender(<SectionListingImageGallery {...props} />);
    expect(screen.getByRole('status').textContent).toBe('Loading section images…');
    expect(screen.queryByRole('img')).toBeNull();
    expect(fetchMock).toHaveBeenCalledExactlyOnceWith('/api/shops/listings/gallery?shopId=123&sectionId=3', expect.objectContaining({ cache: 'no-store' }));
    await act(async () => pending.resolve(json(metadata)));
    expect(screen.getByRole('dialog', { name: 'Images: Woodland prints' })).toBeTruthy();
    expect(screen.getByText(/4 listings/)).toBeTruthy();
    for (const listing of listings) expect(screen.getByText(listing.listingName)).toBeTruthy();
    const images = screen.getAllByRole('img') as HTMLImageElement[];
    expect(images).toHaveLength(2);
    expect(screen.getAllByRole('listitem')).toHaveLength(4);
    images.forEach((image, index) => {
      const url = new URL(image.src);
      expect(url.pathname).toBe('/api/shops/listings/thumbnail');
      expect(Object.fromEntries(url.searchParams)).toEqual({ shopId: '123', sectionId: '3', subSectionId: index === 0 ? '8' : '9',
        listingId: listings[index].id, preview: '1', v: listings[index].thumbnailUpdatedAt });
      expect(image.getAttribute('loading')).toBe('lazy'); expect(image.getAttribute('decoding')).toBe('async');
      expect(image.width).toBe(512); expect(image.height).toBe(512); expect(image.className).toContain('object-contain');
    });
    expect(screen.getByText('No thumbnail uploaded.')).toBeTruthy();
    expect(screen.getByText('Artwork unavailable for this listing.')).toBeTruthy();
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('shows metadata errors and retries before rendering cards', async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce(json({ error: 'Section images temporarily unavailable.' }, false))
      .mockResolvedValueOnce(json(metadata)); vi.stubGlobal('fetch', fetchMock);
    render(<SectionListingImageGallery {...props} />);
    expect((await screen.findByRole('alert')).textContent).toBe('Section images temporarily unavailable.');
    expect(screen.queryByRole('img')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Retry gallery' }));
    expect(await screen.findByText('Fox in the woods')).toBeTruthy();
    expect(screen.queryByRole('alert')).toBeNull(); expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(fetchMock.mock.calls.every(([, options]) => options.cache === 'no-store')).toBe(true);
  });

  it('keeps other cards usable when a thumbnail fails and retries only a lightweight preview', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(json(metadata)));
    render(<SectionListingImageGallery {...props} />);
    const image = await screen.findByRole('img', { name: 'Fox in the woods artwork thumbnail' }) as HTMLImageElement;
    fireEvent.error(image);
    expect(screen.getByText('Thumbnail could not be loaded.')).toBeTruthy();
    expect(screen.getByRole('img', { name: 'Otter by the river artwork thumbnail' })).toBeTruthy();
    expect(screen.getByText('Fox in the woods')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Retry image for Fox in the woods' }));
    const retry = screen.getByRole('img', { name: 'Fox in the woods artwork thumbnail' }) as HTMLImageElement;
    const url = new URL(retry.src);
    expect(url.searchParams.get('preview')).toBe('1'); expect(url.searchParams.get('retry')).toBe('1');
    expect(url.searchParams.get('listingId')).toBe('500'); expect(url.searchParams.get('subSectionId')).toBe('8');
    // A late error from the previous img must not hide its newer retry.
    fireEvent.error(image);
    expect(screen.getByRole('img', { name: 'Fox in the woods artwork thumbnail' })).toBe(retry);
    expect(screen.queryByText('Thumbnail could not be loaded.')).toBeNull();
    fireEvent.error(retry);
    fireEvent.error(image);
    expect(screen.getByText('Thumbnail could not be loaded.')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Retry image for Fox in the woods' })).toBeTruthy();
  });

  it('aborts stale metadata on context changes and scopes all new previews to the new destination', async () => {
    const old = deferred<ReturnType<typeof json>>();
    const nextItem = { ...listings[0], id: '700', listingName: 'New shop artwork', subSectionId: '40' };
    const fetchMock = vi.fn().mockReturnValueOnce(old.promise).mockResolvedValueOnce(json({ sectionName: 'New section', listings: [nextItem] }));
    vi.stubGlobal('fetch', fetchMock);
    const { rerender } = render(<SectionListingImageGallery {...props} />);
    rerender(<SectionListingImageGallery {...props} shopId="456" sectionId="30" sectionName="New section" />);
    const image = await screen.findByRole('img', { name: 'New shop artwork artwork thumbnail' }) as HTMLImageElement;
    expect((fetchMock.mock.calls[0][1].signal as AbortSignal).aborted).toBe(true);
    expect(fetchMock.mock.calls[1][0]).toBe('/api/shops/listings/gallery?shopId=456&sectionId=30');
    expect(Object.fromEntries(new URL(image.src).searchParams)).toEqual({ shopId: '456', sectionId: '30', subSectionId: '40', listingId: '700', preview: '1', v: nextItem.thumbnailUpdatedAt });
    await act(async () => old.resolve(json(metadata)));
    expect(screen.queryByText('Fox in the woods')).toBeNull();
    expect(screen.getByRole('dialog', { name: 'Images: New section' })).toBeTruthy();
    expect(screen.getAllByRole('img')).toHaveLength(1);
  });

  it('clears old cards while closed and fetches fresh metadata/versioned images on reopening', async () => {
    const reopen = deferred<ReturnType<typeof json>>();
    const updated = { ...listings[0], thumbnailUpdatedAt: '2026-11-22T12:00:00.000Z' };
    const fetchMock = vi.fn().mockResolvedValueOnce(json(metadata)).mockReturnValueOnce(reopen.promise); vi.stubGlobal('fetch', fetchMock);
    const { rerender } = render(<SectionListingImageGallery {...props} />);
    const original = await screen.findByRole('img', { name: 'Fox in the woods artwork thumbnail' });
    fireEvent.error(original);
    rerender(<SectionListingImageGallery {...props} open={false} />);
    expect(screen.queryByRole('img')).toBeNull(); expect(fetchMock).toHaveBeenCalledTimes(1);
    rerender(<SectionListingImageGallery {...props} />);
    expect(screen.queryByRole('img')).toBeNull(); expect(screen.getByRole('status').textContent).toContain('Loading');
    await act(async () => reopen.resolve(json({ ...metadata, listings: [updated] })));
    const fresh = screen.getByRole('img', { name: 'Fox in the woods artwork thumbnail' }) as HTMLImageElement;
    expect(new URL(fresh.src).searchParams.get('v')).toBe(updated.thumbnailUpdatedAt);
    expect(screen.queryByText('Thumbnail could not be loaded.')).toBeNull();
    fireEvent.error(original);
    expect(screen.getByRole('img', { name: 'Fox in the woods artwork thumbnail' })).toBe(fresh);
  });

  it.each(['Close', 'Escape'])('closes accessibly through %s and restores the external gallery trigger', async (method) => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(json(metadata)));
    const restore = vi.fn();
    function Gallery() {
      const [open, setOpen] = useState(true);
      return <SectionListingImageGallery {...props} open={open} onOpenChange={setOpen} onRestoreFocus={restore} />;
    }
    render(<Gallery />); await screen.findByText('Fox in the woods');
    if (method === 'Close') fireEvent.click(screen.getByRole('button', { name: 'Close' }));
    else fireEvent.keyDown(screen.getByRole('dialog'), { key: 'Escape' });
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(screen.queryByRole('img')).toBeNull();
    await waitFor(() => expect(restore).toHaveBeenCalledOnce());
  });

  it('shows an empty section and rejects malformed metadata without loading arbitrary images', async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce(json({ sectionName: 'Empty section', listings: [] }))
      .mockResolvedValueOnce(json({ sectionName: 'Invalid', listings: [{ id: '500', hasThumbnail: true }] }));
    vi.stubGlobal('fetch', fetchMock);
    const { rerender } = render(<SectionListingImageGallery {...props} />);
    expect(await screen.findByText('No listings in this section.')).toBeTruthy();
    expect(screen.queryByRole('img')).toBeNull();
    rerender(<SectionListingImageGallery {...props} sectionId="4" />);
    expect((await screen.findByRole('alert')).textContent).toContain('could not be read');
    expect(screen.queryByRole('img')).toBeNull();
  });
});
