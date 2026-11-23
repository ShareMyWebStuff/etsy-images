import { useState } from 'react';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { SectionListingImageGallery } from '@/app/listings/SectionListingImageGallery';
import type { ListingGalleryItem } from '@/lib/listing-gallery';

const listings: ListingGalleryItem[] = [
  { id: '500', listingName: 'Fox in the woods', hasThumbnail: true, thumbnailUpdatedAt: '2026-11-22T10:00:00.000Z', subSectionId: '8', canDelete: true, deleteDisabledReason: null },
  { id: '501', listingName: 'Otter by the river', hasThumbnail: true, thumbnailUpdatedAt: '2026-11-22T11:00:00.000Z', subSectionId: '9', canDelete: true, deleteDisabledReason: null },
  { id: '502', listingName: 'Missing artwork', hasThumbnail: false, thumbnailUpdatedAt: null, subSectionId: '8', canDelete: true, deleteDisabledReason: null },
  { id: '503', listingName: 'Unassigned artwork', hasThumbnail: true, thumbnailUpdatedAt: null, subSectionId: null, canDelete: false, deleteDisabledReason: 'Choose a local subsection before deleting this listing.' },
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

  it('opens only the selected original at full viewport size and returns to the same gallery cards and scroll', async () => {
    const fetchMock = vi.fn().mockResolvedValue(json(metadata)); vi.stubGlobal('fetch', fetchMock);
    const onOpenChange = vi.fn();
    render(<SectionListingImageGallery {...props} onOpenChange={onOpenChange} />);
    const thumbnail = await screen.findByRole('img', { name: 'Otter by the river artwork thumbnail' });
    const gallery = screen.getByRole('dialog', { name: 'Images: Woodland prints' });
    const scroll = screen.getByLabelText('Section images'); scroll.scrollTop = 420;
    expect(screen.queryByRole('img', { name: /original artwork/ })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'View full image for Otter by the river' }));
    const full = screen.getByRole('dialog', { name: 'Full image: Otter by the river' });
    expect(full.className).toContain('h-[100dvh]'); expect(full.className).toContain('max-w-none');
    const original = within(full).getByRole('img', { name: 'Otter by the river original artwork' }) as HTMLImageElement;
    const url = new URL(original.src);
    expect(Object.fromEntries(url.searchParams)).toEqual({ shopId: '123', sectionId: '3', subSectionId: '9', listingId: '501', v: listings[1].thumbnailUpdatedAt });
    expect(url.searchParams.has('preview')).toBe(false);
    expect(gallery.isConnected).toBe(true); expect(thumbnail.isConnected).toBe(true);
    expect(within(full).getByRole('status').textContent).toBe('Loading full image…');
    fireEvent.load(original); expect(within(full).queryByRole('status')).toBeNull();
    fireEvent.click(original);
    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Full image: Otter by the river' })).toBeNull());
    expect(screen.getByRole('dialog', { name: 'Images: Woodland prints' })).toBe(gallery);
    expect(screen.getByRole('img', { name: 'Otter by the river artwork thumbnail' })).toBe(thumbnail);
    expect(scroll.scrollTop).toBe(420); expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(onOpenChange).not.toHaveBeenCalled();
  });

  it('handles original-image failure/retry and Escape or Close exits the image before the gallery', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(json(metadata)));
    const onOpenChange = vi.fn(), restoreGallery = vi.fn();
    render(<SectionListingImageGallery {...props} onOpenChange={onOpenChange} onRestoreFocus={restoreGallery} />);
    const trigger = await screen.findByRole('button', { name: 'View full image for Fox in the woods' });
    fireEvent.click(trigger);
    let full = screen.getByRole('dialog', { name: 'Full image: Fox in the woods' });
    const original = within(full).getByRole('img') as HTMLImageElement;
    fireEvent.error(original);
    expect(within(full).getByRole('alert').textContent).toContain('Unable to load the full image');
    fireEvent.click(within(full).getByRole('button', { name: 'Retry full image' }));
    const retried = within(full).getByRole('img') as HTMLImageElement;
    expect(new URL(retried.src).searchParams.get('retry')).toBe('1');
    expect(new URL(retried.src).searchParams.has('preview')).toBe(false);
    fireEvent.load(retried); fireEvent.error(original);
    expect(within(full).queryByRole('alert')).toBeNull(); expect(within(full).queryByRole('status')).toBeNull();
    fireEvent.keyDown(full, { key: 'Escape' });
    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Full image: Fox in the woods' })).toBeNull());
    expect(onOpenChange).not.toHaveBeenCalled(); expect(restoreGallery).not.toHaveBeenCalled();
    await waitFor(() => expect(document.activeElement).toBe(trigger));
    fireEvent.click(trigger); full = screen.getByRole('dialog', { name: 'Full image: Fox in the woods' });
    fireEvent.click(within(full).getByRole('button', { name: 'Close' }));
    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Full image: Fox in the woods' })).toBeNull());
    expect(screen.getByRole('dialog', { name: 'Images: Woodland prints' })).toBeTruthy();
    expect(onOpenChange).not.toHaveBeenCalled();
  });

  it('keeps trash outside the image click area, confirms the named listing and images, and cancels without a DELETE', async () => {
    const protectedItem = { ...listings[0], id: '504', listingName: 'Etsy artwork', canDelete: false, deleteDisabledReason: 'Listings on Etsy cannot be deleted here.' };
    const unknownPermission = { ...listings[0], id: '505', listingName: 'Unknown permissions', canDelete: undefined, deleteDisabledReason: undefined };
    const fetchMock = vi.fn().mockResolvedValue(json({ ...metadata, listings: [...listings, protectedItem, unknownPermission] })); vi.stubGlobal('fetch', fetchMock);
    render(<SectionListingImageGallery {...props} />);
    const preview = await screen.findByRole('button', { name: 'View full image for Fox in the woods' });
    const trash = screen.getByRole('button', { name: 'Delete Fox in the woods' });
    expect(preview.contains(trash)).toBe(false);
    for (const name of ['Etsy artwork', 'Unknown permissions', 'Unassigned artwork']) {
      expect((screen.getByRole('button', { name: `Delete ${name}` }) as HTMLButtonElement).disabled).toBe(true);
    }
    expect(screen.getByRole('button', { name: 'Delete Etsy artwork' }).title).toBe(protectedItem.deleteDisabledReason);
    fireEvent.click(trash);
    const confirmation = screen.getByRole('dialog', { name: 'Delete listing: Fox in the woods?' });
    expect(within(confirmation).getByText('Delete Fox in the woods and all its images?')).toBeTruthy();
    expect(screen.queryByRole('dialog', { name: 'Full image: Fox in the woods' })).toBeNull();
    fireEvent.click(within(confirmation).getByRole('button', { name: 'Cancel' }));
    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Delete listing: Fox in the woods?' })).toBeNull());
    expect(fetchMock).toHaveBeenCalledTimes(1); expect(trash.isConnected).toBe(true);
    await waitFor(() => expect(document.activeElement).toBe(trash));
  });

  it('deletes once with the selected actual subsection, locks dismissal, removes only that card and preserves gallery scroll', async () => {
    const pending = deferred<ReturnType<typeof json>>();
    const fetchMock = vi.fn().mockResolvedValueOnce(json(metadata)).mockReturnValueOnce(pending.promise); vi.stubGlobal('fetch', fetchMock);
    const deleted = vi.fn(), busy = vi.fn(), onOpenChange = vi.fn();
    render(<SectionListingImageGallery {...props} onOpenChange={onOpenChange} onListingDeleted={deleted} onDeletingChange={busy} />);
    const trash = await screen.findByRole('button', { name: 'Delete Otter by the river' });
    const gallery = screen.getByRole('dialog', { name: 'Images: Woodland prints' });
    const galleryClose = within(gallery).getByRole('button', { name: 'Close' });
    const fox = screen.getByRole('img', { name: 'Fox in the woods artwork thumbnail' });
    const scroll = screen.getByLabelText('Section images'); scroll.scrollTop = 300;
    fireEvent.click(trash);
    const confirmation = screen.getByRole('dialog', { name: 'Delete listing: Otter by the river?' });
    const yes = within(confirmation).getByRole('button', { name: 'Yes, delete listing' });
    fireEvent.click(yes); fireEvent.click(yes);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(fetchMock).toHaveBeenLastCalledWith('/api/shops/listings', { method: 'DELETE', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ shopId: '123', sectionId: '3', subSectionId: '9', listingId: '501' }) });
    expect(busy).toHaveBeenCalledWith(true);
    expect((within(confirmation).getByRole('button', { name: 'Cancel' }) as HTMLButtonElement).disabled).toBe(true);
    fireEvent.keyDown(confirmation, { key: 'Escape' }); fireEvent.click(within(confirmation).getByRole('button', { name: 'Close' })); fireEvent.click(galleryClose);
    expect(confirmation.isConnected).toBe(true); expect(onOpenChange).not.toHaveBeenCalled();
    await act(async () => pending.resolve(json({ deletedId: '501', data: null, refreshError: 'Table refresh failed.' })));
    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Delete listing: Otter by the river?' })).toBeNull());
    expect(screen.queryByText('Otter by the river')).toBeNull();
    expect(screen.getByRole('img', { name: 'Fox in the woods artwork thumbnail' })).toBe(fox);
    expect(screen.getByRole('dialog', { name: 'Images: Woodland prints' })).toBe(gallery);
    expect(scroll.scrollTop).toBe(300); expect(deleted).toHaveBeenCalledExactlyOnceWith('501');
    expect(busy).toHaveBeenLastCalledWith(false); expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(screen.getByRole('status').textContent).toBe('Otter by the river deleted.');
  });

  it.each([
    ['server failure', json({ error: 'Storage cleanup could not be completed.' }, false), 'Storage cleanup'],
    ['wrong acknowledgement', json({ deletedId: '999', data: null }), 'could not be confirmed'],
  ])('keeps the card and confirmation on %s and allows a guarded retry', async (_name, response, errorText) => {
    const fetchMock = vi.fn().mockResolvedValueOnce(json(metadata)).mockResolvedValueOnce(response).mockResolvedValueOnce(json({ deletedId: '500', data: null }));
    vi.stubGlobal('fetch', fetchMock);
    const deleted = vi.fn(); render(<SectionListingImageGallery {...props} onListingDeleted={deleted} />);
    fireEvent.click(await screen.findByRole('button', { name: 'Delete Fox in the woods' }));
    let confirmation = screen.getByRole('dialog', { name: 'Delete listing: Fox in the woods?' });
    fireEvent.click(within(confirmation).getByRole('button', { name: 'Yes, delete listing' }));
    expect((await within(confirmation).findByRole('alert')).textContent).toContain(errorText);
    expect(deleted).not.toHaveBeenCalled(); expect(screen.getByText('Fox in the woods')).toBeTruthy();
    fireEvent.click(within(confirmation).getByRole('button', { name: 'Yes, delete listing' }));
    await waitFor(() => expect(deleted).toHaveBeenCalledExactlyOnceWith('500'));
    expect(fetchMock.mock.calls.filter(([, options]) => options?.method === 'DELETE')).toHaveLength(2);
    expect(screen.queryByRole('dialog', { name: 'Delete listing: Fox in the woods?' })).toBeNull();
  });

  it('ignores a late DELETE response after the shop/section changes', async () => {
    const pending = deferred<ReturnType<typeof json>>();
    const nextItem = { ...listings[0], id: '700', listingName: 'New destination artwork', subSectionId: '40' };
    const fetchMock = vi.fn().mockResolvedValueOnce(json(metadata)).mockReturnValueOnce(pending.promise)
      .mockResolvedValueOnce(json({ sectionName: 'New section', listings: [nextItem] })); vi.stubGlobal('fetch', fetchMock);
    const deleted = vi.fn(), busy = vi.fn();
    const { rerender } = render(<SectionListingImageGallery {...props} onListingDeleted={deleted} onDeletingChange={busy} />);
    fireEvent.click(await screen.findByRole('button', { name: 'Delete Fox in the woods' }));
    fireEvent.click(within(screen.getByRole('dialog', { name: 'Delete listing: Fox in the woods?' })).getByRole('button', { name: 'Yes, delete listing' }));
    rerender(<SectionListingImageGallery {...props} shopId="456" sectionId="30" sectionName="New section" onListingDeleted={deleted} onDeletingChange={busy} />);
    await screen.findByText('New destination artwork');
    await act(async () => pending.resolve(json({ deletedId: '500', data: null })));
    expect(deleted).not.toHaveBeenCalled(); expect(busy).toHaveBeenLastCalledWith(false);
    expect(screen.getByRole('dialog', { name: 'Images: New section' })).toBeTruthy();
    expect(screen.queryByText('Fox in the woods deleted.')).toBeNull();
    expect(screen.getByRole('img', { name: 'New destination artwork artwork thumbnail' })).toBeTruthy();
  });
});
