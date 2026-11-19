import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ComponentProps } from 'react';
import type { ListingEditorContext, ListingEditorData } from '@/lib/listing-editor';
import { ListingThumbnailGapControl } from './ListingThumbnailGapControl';

const context: ListingEditorContext = { shopId: '66615491', sectionId: '9', subSectionId: '14', listingId: '283' };
const thumbnail: NonNullable<ListingEditorData['thumbnail']> = {
  fileName: 'thumbnail.png', originalFileName: 'artwork.png', updatedAt: '2026-11-17T12:00:00Z',
  widthPixels: 1120, heightPixels: 1400, ratio: '4x5',
};
const endpoint = '/api/shops/listings/editor/thumbnail-gap';
const eligible = { analysis: { eligible: true, reason: '' }, thumbnailVersion: 'version-1' };
function json(body: unknown, status = 200) { return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } }); }
function deferred() {
  let resolve!: (response: Response) => void;
  const promise = new Promise<Response>((done) => { resolve = done; });
  return { promise, resolve };
}
function mount(fetchMock: ReturnType<typeof vi.fn>, props: Partial<ComponentProps<typeof ListingThumbnailGapControl>> = {}) {
  vi.stubGlobal('fetch', fetchMock);
  const onAdjusted = vi.fn();
  const onAdjustingChange = vi.fn();
  const values = { context, thumbnail, onAdjusted, onAdjustingChange, ...props };
  const view = render(<ListingThumbnailGapControl {...values} />);
  return { ...view, onAdjusted, onAdjustingChange, values };
}
async function ready() {
  const button = screen.getByRole('button', { name: 'Adjust Gap' }) as HTMLButtonElement;
  await waitFor(() => expect(button.disabled).toBe(false));
  return button;
}

afterEach(() => vi.unstubAllGlobals());

describe('Listing thumbnail gap control', () => {
  it('checks saved pixels before enabling and keeps edits local until Adjust Gap is clicked', async () => {
    const check = deferred();
    const fetchMock = vi.fn().mockReturnValue(check.promise);
    const { onAdjusted, onAdjustingChange } = mount(fetchMock);
    const input = screen.getByLabelText('Gap (%)') as HTMLInputElement;
    const button = screen.getByRole('button', { name: 'Adjust Gap' }) as HTMLButtonElement;
    expect(input.value).toBe('5');
    expect(input.getAttribute('min')).toBe('0');
    expect(input.getAttribute('max')).toBe('20');
    expect(input.getAttribute('step')).toBe('any');
    expect(input.nextElementSibling).toBe(button);
    expect(button.disabled).toBe(true);
    expect(screen.getByRole('status').textContent).toContain('Checking thumbnail transparency');
    expect(fetchMock).toHaveBeenCalledWith(`${endpoint}?shopId=66615491&sectionId=9&subSectionId=14&listingId=283`, expect.objectContaining({ signal: expect.any(AbortSignal) }));
    await act(async () => check.resolve(json(eligible)));
    await ready();
    fireEvent.change(input, { target: { value: '7.5' } });
    expect(input.value).toBe('7.5');
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(onAdjusted).not.toHaveBeenCalled();
    expect(onAdjustingChange).not.toHaveBeenCalled();
  });

  it.each(['', '-0.1', '20.1', 'Infinity', 'NaN'])('rejects an invalid gap without a POST: %s', async (value) => {
    const fetchMock = vi.fn().mockResolvedValue(json(eligible));
    mount(fetchMock);
    const button = await ready();
    fireEvent.change(screen.getByLabelText('Gap (%)'), { target: { value } });
    expect(button.disabled).toBe(true);
    expect(screen.getByRole('alert').textContent).toBe('Enter a gap from 0 to 20%.');
    fireEvent.click(button);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it.each(['0', '20', '2.25'])('allows the valid gap %s', async (value) => {
    const fetchMock = vi.fn().mockResolvedValue(json(eligible));
    mount(fetchMock);
    await ready();
    fireEvent.change(screen.getByLabelText('Gap (%)'), { target: { value } });
    expect((screen.getByRole('button', { name: 'Adjust Gap' }) as HTMLButtonElement).disabled).toBe(false);
    expect(screen.queryByRole('alert')).toBeNull();
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it.each(['This thumbnail is fully opaque.', 'This thumbnail contains no visible artwork.'])('explains why pixels cannot be adjusted: %s', async (reason) => {
    const fetchMock = vi.fn().mockResolvedValue(json({ analysis: { eligible: false, reason }, thumbnailVersion: 'version-1' }));
    const { onAdjusted } = mount(fetchMock);
    expect(await screen.findByText(reason)).toBeTruthy();
    const button = screen.getByRole('button', { name: 'Adjust Gap' }) as HTMLButtonElement;
    expect(button.disabled).toBe(true);
    fireEvent.click(button);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(onAdjusted).not.toHaveBeenCalled();
  });

  it('rechecks after a thumbnail is uploaded and after its saved version changes', async () => {
    const lastCheck = deferred();
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(json({ analysis: null, thumbnailVersion: null }))
      .mockResolvedValueOnce(json(eligible))
      .mockReturnValueOnce(lastCheck.promise);
    const view = mount(fetchMock, { thumbnail: null });
    expect(screen.getByText('Upload a thumbnail to adjust its gap.')).toBeTruthy();
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    expect((screen.getByRole('button', { name: 'Adjust Gap' }) as HTMLButtonElement).disabled).toBe(true);
    view.rerender(<ListingThumbnailGapControl {...view.values} thumbnail={thumbnail} />);
    await ready();
    view.rerender(<ListingThumbnailGapControl {...view.values} thumbnail={{ ...thumbnail, updatedAt: '2026-11-17T13:00:00Z' }} />);
    expect((screen.getByRole('button', { name: 'Adjust Gap' }) as HTMLButtonElement).disabled).toBe(true);
    expect(fetchMock).toHaveBeenCalledTimes(3);
    await act(async () => lastCheck.resolve(json({ ...eligible, thumbnailVersion: 'version-2' })));
    await ready();
  });

  it('posts the explicit percentage and checked version once, reports global busy state and returns changed data', async () => {
    const adjustment = deferred();
    const data = { context, thumbnail: { ...thumbnail, updatedAt: '2026-11-17T13:00:00Z' } } as ListingEditorData;
    const fetchMock = vi.fn().mockResolvedValueOnce(json(eligible)).mockReturnValueOnce(adjustment.promise);
    const { onAdjusted, onAdjustingChange } = mount(fetchMock);
    const button = await ready();
    fireEvent.change(screen.getByLabelText('Gap (%)'), { target: { value: '7.5' } });
    act(() => { button.click(); button.click(); });
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(onAdjustingChange.mock.calls).toEqual([[true]]);
    expect((screen.getByRole('button', { name: 'Adjusting...' }) as HTMLButtonElement).disabled).toBe(true);
    expect((screen.getByLabelText('Gap (%)') as HTMLInputElement).disabled).toBe(true);
    expect(fetchMock).toHaveBeenLastCalledWith(endpoint, expect.objectContaining({
      method: 'POST', body: JSON.stringify({ ...context, gapPercent: 7.5, expectedThumbnailVersion: 'version-1' }),
    }));
    await act(async () => adjustment.resolve(json({ ...eligible, changed: true, data, thumbnailVersion: 'version-2' })));
    expect(onAdjusted).toHaveBeenCalledExactlyOnceWith(data);
    expect(onAdjustingChange.mock.calls).toEqual([[true], [false]]);
    expect(screen.getByText('Thumbnail gap adjusted.')).toBeTruthy();
  });

  it('does not refresh the parent preview for an unchanged gap', async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce(json(eligible)).mockResolvedValueOnce(json({ ...eligible, changed: false }));
    const { onAdjusted } = mount(fetchMock);
    fireEvent.click(await ready());
    expect(await screen.findByText('The thumbnail already has this gap.')).toBeTruthy();
    expect(onAdjusted).not.toHaveBeenCalled();
  });

  it('keeps errors inline and the thumbnail unchanged after a failed adjustment', async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce(json(eligible)).mockResolvedValueOnce(json({ error: 'The thumbnail changed. Reload and retry.' }, 409));
    const { onAdjusted, onAdjustingChange } = mount(fetchMock);
    fireEvent.click(await ready());
    expect((await screen.findByRole('alert')).textContent).toContain('The thumbnail changed. Reload and retry.');
    expect((screen.getByRole('button', { name: 'Adjust Gap' }) as HTMLButtonElement).disabled).toBe(true);
    expect(onAdjusted).not.toHaveBeenCalled();
    expect(onAdjustingChange.mock.calls).toEqual([[true], [false]]);
  });

  it('can retry a failed analysis without posting an adjustment', async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce(json({ error: 'Thumbnail storage unavailable.' }, 503)).mockResolvedValueOnce(json(eligible));
    const { onAdjusted } = mount(fetchMock);
    expect((await screen.findByRole('alert')).textContent).toContain('Thumbnail storage unavailable.');
    expect((screen.getByRole('button', { name: 'Adjust Gap' }) as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
    await ready();
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(fetchMock.mock.calls.every(([, options]) => options.method !== 'POST')).toBe(true);
    expect(onAdjusted).not.toHaveBeenCalled();
  });

  it.each(['fileName', 'updatedAt', 'context'])('aborts and ignores old analysis after %s changes', async (change) => {
    const old = deferred();
    const fetchMock = vi.fn().mockReturnValueOnce(old.promise).mockResolvedValueOnce(json({ analysis: { eligible: false, reason: 'New thumbnail is opaque.' }, thumbnailVersion: 'version-2' }));
    const view = mount(fetchMock);
    const nextThumbnail = change === 'fileName' ? { ...thumbnail, fileName: 'replacement.png' }
      : change === 'updatedAt' ? { ...thumbnail, updatedAt: '2026-11-17T13:00:00Z' } : thumbnail;
    const nextContext = change === 'context' ? { ...context, listingId: '284' } : context;
    view.rerender(<ListingThumbnailGapControl {...view.values} context={nextContext} thumbnail={nextThumbnail} />);
    expect(await screen.findByText('New thumbnail is opaque.')).toBeTruthy();
    expect((fetchMock.mock.calls[0][1].signal as AbortSignal).aborted).toBe(true);
    await act(async () => old.resolve(json(eligible)));
    expect((screen.getByRole('button', { name: 'Adjust Gap' }) as HTMLButtonElement).disabled).toBe(true);
    expect(screen.getByText('New thumbnail is opaque.')).toBeTruthy();
    expect(view.onAdjusted).not.toHaveBeenCalled();
  });

  it.each(['thumbnail', 'context'])('ignores an old adjustment and releases busy state after the %s changes', async (change) => {
    const adjustment = deferred();
    const fetchMock = vi.fn().mockResolvedValueOnce(json(eligible)).mockReturnValueOnce(adjustment.promise)
      .mockResolvedValueOnce(json({ analysis: { eligible: false, reason: 'Replacement is not adjustable.' }, thumbnailVersion: 'version-2' }));
    const view = mount(fetchMock);
    fireEvent.click(await ready());
    view.rerender(<ListingThumbnailGapControl {...view.values}
      context={change === 'context' ? { ...context, listingId: '284' } : context}
      thumbnail={change === 'thumbnail' ? { ...thumbnail, updatedAt: '2026-11-17T13:00:00Z' } : thumbnail} />);
    expect(await screen.findByText('Replacement is not adjustable.')).toBeTruthy();
    expect((fetchMock.mock.calls[1][1].signal as AbortSignal).aborted).toBe(true);
    await act(async () => adjustment.resolve(json({ ...eligible, changed: true, data: { context, thumbnail } })));
    expect(view.onAdjusted).not.toHaveBeenCalled();
    expect(view.onAdjustingChange.mock.calls).toEqual([[true], [false]]);
    expect(screen.queryByText('Thumbnail gap adjusted.')).toBeNull();
  });

  it('aborts work on unmount and does not deliver an adjustment to an obsolete editor', async () => {
    const adjustment = deferred();
    const fetchMock = vi.fn().mockResolvedValueOnce(json(eligible)).mockReturnValueOnce(adjustment.promise);
    const view = mount(fetchMock);
    fireEvent.click(await ready());
    view.unmount();
    await act(async () => adjustment.resolve(json({ ...eligible, changed: true, data: { context, thumbnail } })));
    expect(view.onAdjusted).not.toHaveBeenCalled();
    expect(view.onAdjustingChange.mock.calls).toEqual([[true], [false]]);
  });

  it('respects the editor disabled state without blocking analysis', async () => {
    const fetchMock = vi.fn().mockResolvedValue(json(eligible));
    const view = mount(fetchMock, { disabled: true });
    await waitFor(() => expect(screen.queryByRole('status')).toBeNull());
    expect((screen.getByRole('button', { name: 'Adjust Gap' }) as HTMLButtonElement).disabled).toBe(true);
    view.rerender(<ListingThumbnailGapControl {...view.values} disabled={false} />);
    await ready();
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it.each([
    { fileName: 'replacement.png', updatedAt: thumbnail.updatedAt },
    { fileName: thumbnail.fileName, updatedAt: '2026-11-17T13:00:00Z' },
    null,
  ])('rejects server thumbnail identity that differs from the displayed preview: %j', async (thumbnailIdentity) => {
    const fetchMock = vi.fn().mockResolvedValue(json({ ...eligible, thumbnailIdentity }));
    const { onAdjusted } = mount(fetchMock);

    expect((await screen.findByRole('alert')).textContent).toContain('The thumbnail changed. Reload the listing before adjusting its gap.');
    fireEvent.click(screen.getByRole('button', { name: 'Adjust Gap' }));
    expect((screen.getByRole('button', { name: 'Adjust Gap' }) as HTMLButtonElement).disabled).toBe(true);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(onAdjusted).not.toHaveBeenCalled();
  });

  it('accepts a server thumbnail identity matching the displayed preview', async () => {
    const fetchMock = vi.fn().mockResolvedValue(json({ ...eligible, thumbnailIdentity: { fileName: thumbnail.fileName, updatedAt: thumbnail.updatedAt } }));
    mount(fetchMock);

    await ready();

    expect(screen.queryByRole('alert')).toBeNull();
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock).toHaveBeenCalledWith(expect.stringContaining(endpoint), expect.objectContaining({ cache: 'no-store' }));
  });

  it('keeps retry blocked after a stale POST until parent thumbnail identity catches up', async () => {
    let serverThumbnail = thumbnail;
    const fetchMock = vi.fn(async (_url: string, options?: RequestInit) => options?.method === 'POST'
      ? json({ error: 'The thumbnail changed. Retry the check.' }, 409)
      : json({ ...eligible, thumbnailVersion: serverThumbnail === thumbnail ? 'version-1' : 'version-2', thumbnailIdentity: { fileName: serverThumbnail.fileName, updatedAt: serverThumbnail.updatedAt } }));
    const view = mount(fetchMock);
    await ready();
    serverThumbnail = { ...thumbnail, updatedAt: '2026-11-17T13:00:00Z' };
    fireEvent.click(screen.getByRole('button', { name: 'Adjust Gap' }));
    await screen.findByRole('alert');

    for (let retry = 0; retry < 2; retry += 1) {
      fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
      expect((await screen.findByRole('alert')).textContent).toContain('Reload the listing before adjusting its gap.');
      expect((screen.getByRole('button', { name: 'Adjust Gap' }) as HTMLButtonElement).disabled).toBe(true);
    }
    expect(fetchMock.mock.calls.filter(([, options]) => options?.method === 'POST')).toHaveLength(1);
    expect(view.onAdjusted).not.toHaveBeenCalled();

    view.rerender(<ListingThumbnailGapControl {...view.values} thumbnail={serverThumbnail} />);
    await ready();
    expect(screen.queryByRole('alert')).toBeNull();
    expect(fetchMock.mock.calls.filter(([, options]) => options?.method === 'POST')).toHaveLength(1);
  });
});
