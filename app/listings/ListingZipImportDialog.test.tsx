import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ListingZipImportDialog } from '@/app/listings/ListingZipImportDialog';
import type { SubSectionListingsPageData } from '@/lib/listing-table';
import type { ListingZipReviewState } from '@/lib/listing-zip-review-types';
import {
  cropRegionToArtworkPlacement, defaultNativeListingPrintCropDraft,
  type ListingArtworkOrientation, type ListingPrintCropDraft,
} from '@/lib/listing-print-crops';

const endpoint = '/api/shops/listings/import';
const choices = [{ id: '15', name: 'Country living prints', templateType: 'single', itemCount: 1 }];
const data: SubSectionListingsPageData = {
  shop: { id: '123', shopName: 'Country Shop' }, section: { id: '3', sectionName: 'Wall Art' },
  subSection: { id: '8', name: 'Woodland', numberOfDownloads: 1, includeAllDownloads: false },
  templates: [{ ...choices[0], id: 15, templateType: 'single' }], listings: [],
};
const json = (payload: unknown, ok = true) => ({ ok, json: async () => payload });
function deferred<T>() { let resolve!: (value: T) => void; const promise = new Promise<T>((next) => { resolve = next; }); return { promise, resolve }; }
function setup(overrides = {}) {
  const props = { open: true, onOpenChange: vi.fn(), shopId: '123', sectionId: '3', subSectionId: '8',
    destinationName: 'Country Shop / Wall Art / Woodland', onInserted: vi.fn(), onFinished: vi.fn(), onImportingChange: vi.fn(), ...overrides };
  return { ...render(<ListingZipImportDialog {...props} />), props };
}
const zip = () => new File(['example ZIP'], 'woodland.zip', { type: 'application/zip' });
function upload(file = zip()) { fireEvent.change(screen.getByLabelText('ZIP archive'), { target: { files: [file] } }); return file; }
async function chooseTemplate() { await screen.findByRole('option', { name: choices[0].name }); fireEvent.change(screen.getByLabelText('Import template'), { target: { value: '15' } }); }
function review(cursor = 0, insertedCount = 0, skippedCount = 0): ListingZipReviewState {
  return { sessionId: 'review-1', templateName: choices[0].name, total: 2, cursor, insertedCount, skippedCount,
    expiresAt: '2026-11-21T19:00:00.000Z', current: cursor < 2 ? { index: cursor, rowNumber: cursor + 2,
      title: cursor === 0 ? 'Fox print' : 'Otter print', description: cursor === 0 ? 'A woodland fox.' : 'A river otter.',
      relativeFilename: cursor === 0 ? 'images/fox.png' : 'images/otter.png', originalFileName: cursor === 0 ? 'fox.png' : 'otter.png',
      width: 2000, height: 3000, orientation: 'portrait', error: null } : null };
}
async function beginReview() {
  await chooseTemplate(); upload(); fireEvent.click(screen.getByRole('button', { name: 'Import listings' }));
  await screen.findByText('Item 1 of 2');
}
function actions(fetchMock: ReturnType<typeof vi.fn>) {
  return fetchMock.mock.calls.filter(([, options]) => options?.method === 'POST' && typeof options.body === 'string')
    .map(([, options]) => JSON.parse(options.body));
}

function defaultCrops(width = 2000, height = 3000, orientation: ListingArtworkOrientation = 'portrait'): ListingPrintCropDraft {
  const { regions, placements } = defaultNativeListingPrintCropDraft(width, height, orientation);
  return { regions, placements };
}

function expectCrops(actual: ListingPrintCropDraft, expected: ListingPrintCropDraft) {
  expect(Object.keys(actual).sort()).toEqual(['placements', 'regions']);
  for (const kind of ['regions', 'placements'] as const) {
    expect(Object.keys(actual[kind]!).sort()).toEqual(Object.keys(expected[kind]!).sort());
    for (const ratio of Object.keys(expected.regions) as Array<keyof ListingPrintCropDraft['regions']>) {
      for (const coordinate of ['x', 'y', 'width', 'height'] as const) {
        expect(actual[kind]![ratio][coordinate]).toBeCloseTo(expected[kind]![ratio][coordinate], 12);
      }
    }
  }
}

function fourByFiveReview(cursor = 0, inserted = 0, skipped = 0) {
  const value = review(cursor, inserted, skipped);
  if (value.current) Object.assign(value.current, { width: 4000, height: 5000, initialCropSettings: defaultCrops(4000, 5000) });
  return value;
}

function dragCrop(deltaX: number, deltaY = 0) {
  vi.stubGlobal('PointerEvent', MouseEvent);
  vi.spyOn(screen.getByTestId('print-crop-source-frame'), 'getBoundingClientRect').mockReturnValue({
    x: 0, y: 0, left: 0, top: 0, width: 400, height: 500, right: 400, bottom: 500, toJSON: () => ({}),
  });
  const selection = screen.getByTestId('print-crop-selection');
  Object.assign(selection, { setPointerCapture: vi.fn(), hasPointerCapture: () => false });
  fireEvent.pointerDown(selection, { clientX: 100, clientY: 100, button: 0, pointerId: 1 });
  fireEvent.pointerMove(selection, { clientX: 100 + deltaX, clientY: 100 + deltaY, pointerId: 1 });
  fireEvent.pointerUp(selection, { pointerId: 1 });
}

afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); });

describe('Listing ZIP import dialog', () => {
  it('loads fresh same-shop choices and explains the destination, CSV paths and single-artwork format', async () => {
    const fetchMock = vi.fn().mockResolvedValue(json({ templates: [...choices,
      { id: '16', name: 'Set of three', templateType: 'multiple', itemCount: 3 },
      { id: '17', name: 'Invalid single count', templateType: 'single', itemCount: 3 },
    ] }));
    vi.stubGlobal('fetch', fetchMock);
    setup();
    expect(await screen.findByRole('option', { name: choices[0].name })).toBeTruthy();
    expect(screen.queryByRole('option', { name: 'Set of three' })).toBeNull();
    expect(screen.queryByRole('option', { name: 'Invalid single count' })).toBeNull();
    expect(screen.getByText(/Country Shop \/ Wall Art \/ Woodland/)).toBeTruthy();
    expect(screen.getByText(/first row is skipped as the header/)).toBeTruthy();
    expect(screen.getByText(/Title, Description, Image filename/)).toBeTruthy();
    expect(screen.getByText('images/fox.png')).toBeTruthy();
    expect(screen.getByText(/Images larger than 60 MB are displayed for review/)).toBeTruthy();
    expect(fetchMock).toHaveBeenCalledWith(`${endpoint}?shopId=123&sectionId=3&subSectionId=8`, expect.objectContaining({ cache: 'no-store' }));
    expect((screen.getByRole('button', { name: 'Import listings' }) as HTMLButtonElement).disabled).toBe(true);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('requires both choices and prepares one scoped review without creating a listing', async () => {
    const pending = deferred<ReturnType<typeof json>>();
    const fetchMock = vi.fn().mockResolvedValueOnce(json({ templates: choices })).mockReturnValueOnce(pending.promise);
    vi.stubGlobal('fetch', fetchMock);
    const { props } = setup();
    await chooseTemplate();
    expect((screen.getByRole('button', { name: 'Import listings' }) as HTMLButtonElement).disabled).toBe(true);
    const file = upload();
    expect(screen.getByText('Selected ZIP: woodland.zip')).toBeTruthy();
    const submit = screen.getByRole('button', { name: 'Import listings' });
    expect((submit as HTMLButtonElement).disabled).toBe(false);
    fireEvent.submit(submit.closest('form')!);
    fireEvent.submit(submit.closest('form')!);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    const request = fetchMock.mock.calls[1][1];
    expect(request.method).toBe('POST'); expect(request.headers).toBeUndefined();
    expect(request.body).toBeInstanceOf(FormData);
    expect(Object.fromEntries((request.body as FormData).entries())).toEqual({ shopId: '123', sectionId: '3', subSectionId: '8', templateId: '15', file });
    expect(props.onImportingChange).toHaveBeenCalledWith(true);
    expect(screen.getByRole('status').textContent).toContain('No listings are being created');
    expect((screen.getByRole('button', { name: 'Cancel' }) as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(screen.getByRole('button', { name: 'Close' }));
    fireEvent.keyDown(screen.getByRole('dialog'), { key: 'Escape' });
    expect(props.onOpenChange).not.toHaveBeenCalled();
    await act(async () => pending.resolve(json({ review: review() })));
    expect(screen.getByText('Fox print')).toBeTruthy();
    expect(screen.getByText('A woodland fox.')).toBeTruthy();
    expect(screen.getByText(/CSV row 2/)).toBeTruthy();
    const image = screen.getByRole('img', { name: 'Fox print import artwork' }) as HTMLImageElement;
    const imageUrl = new URL(image.src);
    expect(imageUrl.pathname).toBe(endpoint);
    expect(Object.fromEntries(imageUrl.searchParams)).toEqual({ shopId: '123', sectionId: '3', subSectionId: '8', action: 'image', sessionId: 'review-1', rowIndex: '0' });
    expect(props.onInserted).not.toHaveBeenCalled();
    expect(props.onFinished).not.toHaveBeenCalled();
    expect(actions(fetchMock)).toEqual([]);
    expect(props.onImportingChange).toHaveBeenLastCalledWith(false);
  });

  it('opens the native ZIP picker in Downloads and handles a cancellation quietly before retry', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(json({ templates: choices })));
    const file = zip();
    const picker = vi.fn().mockRejectedValueOnce(new DOMException('Cancelled', 'AbortError'))
      .mockResolvedValueOnce([{ getFile: async () => file }]);
    vi.stubGlobal('showOpenFilePicker', picker);
    setup(); await chooseTemplate();
    fireEvent.click(screen.getByRole('button', { name: 'Choose ZIP' }));
    await waitFor(() => expect((screen.getByRole('button', { name: 'Choose ZIP' }) as HTMLButtonElement).disabled).toBe(false));
    expect(screen.queryByRole('alert')).toBeNull();
    expect(screen.getByText('No ZIP selected.')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Choose ZIP' }));
    expect(await screen.findByText('Selected ZIP: woodland.zip')).toBeTruthy();
    expect(picker).toHaveBeenLastCalledWith({ startIn: 'downloads', multiple: false,
      types: [{ description: 'ZIP archive', accept: { 'application/zip': ['.zip'] } }] });
  });

  it('uses the native file-input fallback when the browser picker is unavailable and validates ZIP size/type', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(json({ templates: choices })));
    vi.stubGlobal('showOpenFilePicker', undefined);
    setup(); await chooseTemplate();
    const input = screen.getByLabelText('ZIP archive') as HTMLInputElement;
    const click = vi.spyOn(input, 'click');
    fireEvent.click(screen.getByRole('button', { name: 'Choose ZIP' }));
    expect(click).toHaveBeenCalledOnce(); expect(input.accept).toContain('.zip');
    upload(new File(['CSV'], 'listings.csv'));
    expect(screen.getByRole('alert').textContent).toBe('Choose a ZIP archive (.zip).');
    upload(new File([], 'empty.zip'));
    expect(screen.getByRole('alert').textContent).toContain('empty');
    const large = zip(); Object.defineProperty(large, 'size', { value: 500 * 1024 * 1024 + 1 });
    upload(large); expect(screen.getByRole('alert').textContent).toContain('500 MB or smaller');
    expect((screen.getByRole('button', { name: 'Import listings' }) as HTMLButtonElement).disabled).toBe(true);
    const boundary = zip(); Object.defineProperty(boundary, 'size', { value: 500 * 1024 * 1024 });
    upload(boundary); expect(screen.queryByRole('alert')).toBeNull();
    expect((screen.getByRole('button', { name: 'Import listings' }) as HTMLButtonElement).disabled).toBe(false);
  });

  it('offers the file field after a native picker error', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(json({ templates: choices })));
    vi.stubGlobal('showOpenFilePicker', vi.fn().mockRejectedValue(new DOMException('Not allowed', 'SecurityError')));
    setup(); await chooseTemplate();
    fireEvent.click(screen.getByRole('button', { name: 'Choose ZIP' }));
    expect((await screen.findByRole('alert')).textContent).toContain('file field below');
    expect(screen.getByLabelText('ZIP archive').className).not.toContain('hidden');
    upload(); expect(screen.queryByRole('alert')).toBeNull();
    expect(screen.getByText('Selected ZIP: woodland.zip')).toBeTruthy();
  });

  it('keeps archive validation errors in setup and preserves the choices for retry', async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce(json({ templates: choices }))
      .mockResolvedValueOnce(json({ error: 'CSV row 4: image images/otter.png is missing.' }, false))
      .mockResolvedValueOnce(json({ review: review() }));
    vi.stubGlobal('fetch', fetchMock);
    const { props } = setup(); await chooseTemplate(); upload();
    fireEvent.click(screen.getByRole('button', { name: 'Import listings' }));
    expect((await screen.findByRole('alert')).textContent).toContain('CSV row 4');
    expect(props.onInserted).not.toHaveBeenCalled(); expect(props.onOpenChange).not.toHaveBeenCalled();
    expect((screen.getByLabelText('Import template') as HTMLSelectElement).value).toBe('15');
    expect(screen.getByText('Selected ZIP: woodland.zip')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Import listings' }));
    await screen.findByText('Item 1 of 2');
    expect(props.onInserted).not.toHaveBeenCalled();
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('reports missing single-artwork choices and retries a failed template load', async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce(json({ error: 'Templates unavailable.' }, false))
      .mockResolvedValueOnce(json({ templates: [{ id: '20', name: 'Only sets', templateType: 'multiple', itemCount: 3 }] }));
    vi.stubGlobal('fetch', fetchMock);
    setup();
    expect((await screen.findByRole('alert')).textContent).toContain('Templates unavailable.');
    fireEvent.click(screen.getByRole('button', { name: 'Retry templates' }));
    expect(await screen.findByText(/No single-artwork templates are available/)).toBeTruthy();
    expect(screen.queryByRole('option', { name: 'Only sets' })).toBeNull();
    expect((screen.getByRole('button', { name: 'Import listings' }) as HTMLButtonElement).disabled).toBe(true);
  });

  it('ignores stale template responses after the destination changes', async () => {
    const oldLoad = deferred<ReturnType<typeof json>>();
    const fetchMock = vi.fn().mockReturnValueOnce(oldLoad.promise).mockResolvedValueOnce(json({ templates: [
      { id: '30', name: 'New shop print', templateType: 'single', itemCount: 1 },
    ] }));
    vi.stubGlobal('fetch', fetchMock);
    const { props, rerender } = setup();
    rerender(<ListingZipImportDialog {...props} shopId="456" />);
    expect(await screen.findByRole('option', { name: 'New shop print' })).toBeTruthy();
    await act(async () => oldLoad.resolve(json({ templates: choices })));
    expect(screen.queryByRole('option', { name: choices[0].name })).toBeNull();
    expect((fetchMock.mock.calls[0][1].signal as AbortSignal).aborted).toBe(true);
  });

  it('cleans up a review prepared after the destination changes without showing it', async () => {
    const pending = deferred<ReturnType<typeof json>>();
    const fetchMock = vi.fn().mockResolvedValueOnce(json({ templates: choices })).mockReturnValueOnce(pending.promise)
      .mockResolvedValueOnce(json({ templates: choices }));
    vi.stubGlobal('fetch', fetchMock);
    const { props, rerender } = setup(); await chooseTemplate(); upload();
    fireEvent.click(screen.getByRole('button', { name: 'Import listings' }));
    rerender(<ListingZipImportDialog {...props} subSectionId="9" />);
    await act(async () => pending.resolve(json({ review: review() })));
    expect(props.onInserted).not.toHaveBeenCalled();
    expect(screen.queryByText('Fox print')).toBeNull();
    expect(fetchMock).toHaveBeenCalledWith(endpoint, expect.objectContaining({ method: 'DELETE',
      body: JSON.stringify({ shopId: '123', sectionId: '3', subSectionId: '8', sessionId: 'review-1' }) }));
    expect(props.onImportingChange).toHaveBeenLastCalledWith(false);
  });

  it('keeps acknowledged progress while rejecting table data from the wrong destination', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValueOnce(json({ templates: choices }))
      .mockResolvedValueOnce(json({ review: review() }))
      .mockResolvedValueOnce(json({ review: review(1, 1), data: { ...data, subSection: { ...data.subSection, id: '9' } } })));
    const { props } = setup(); await beginReview();
    fireEvent.click(screen.getByRole('button', { name: 'Insert' }));
    expect((await screen.findByRole('alert')).textContent).toContain('table could not be refreshed');
    expect(screen.getByText('Otter print')).toBeTruthy();
    expect(props.onInserted).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Finish' }));
    expect(props.onFinished).toHaveBeenCalledWith({ insertedCount: 1, skippedCount: 0, totalCount: 2 });
  });

  it('inserts and skips one item at a time, updates progress, then keeps the summary open until Done', async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce(json({ templates: choices })).mockResolvedValueOnce(json({ review: review() }))
      .mockResolvedValueOnce(json({ review: review(1, 1), data })).mockResolvedValueOnce(json({ review: review(2, 1, 1) }))
      .mockResolvedValue(json({ closed: true }));
    vi.stubGlobal('fetch', fetchMock);
    const { props } = setup(); await beginReview();
    const initialProgress = screen.getByRole('progressbar', { name: 'Import progress' }) as HTMLProgressElement;
    expect(initialProgress.value).toBe(0); expect(initialProgress.max).toBe(2);
    fireEvent.click(screen.getByRole('button', { name: 'Insert' }));
    await screen.findByText('Otter print');
    expect(props.onInserted).toHaveBeenCalledExactlyOnceWith(data);
    expect((screen.getByRole('progressbar') as HTMLProgressElement).value).toBe(1);
    fireEvent.click(screen.getByRole('button', { name: 'Skip' }));
    expect(await screen.findByText('Review complete')).toBeTruthy();
    expect(screen.getByText('1 listing inserted. 1 skipped.')).toBeTruthy();
    expect((screen.getByRole('progressbar') as HTMLProgressElement).value).toBe(2);
    expect(screen.queryByRole('img')).toBeNull();
    expect(screen.queryByRole('button', { name: 'Insert' })).toBeNull();
    expect(props.onOpenChange).not.toHaveBeenCalled(); expect(props.onFinished).not.toHaveBeenCalled();
    expect(actions(fetchMock)).toEqual([
      { shopId: '123', sectionId: '3', subSectionId: '8', sessionId: 'review-1', rowIndex: 0, action: 'insert', cropSettings: defaultCrops() },
      { shopId: '123', sectionId: '3', subSectionId: '8', sessionId: 'review-1', rowIndex: 1, action: 'skip' },
    ]);
    fireEvent.click(screen.getByRole('button', { name: 'Done' }));
    expect(props.onFinished).toHaveBeenCalledExactlyOnceWith({ insertedCount: 1, skippedCount: 1, totalCount: 2 });
    expect(props.onOpenChange).toHaveBeenCalledWith(false);
    expect(fetchMock).toHaveBeenLastCalledWith(endpoint, expect.objectContaining({ method: 'DELETE',
      body: JSON.stringify({ shopId: '123', sectionId: '3', subSectionId: '8', sessionId: 'review-1' }) }));
  });

  it('prevents duplicate Insert requests and dismissal while an item is being saved', async () => {
    const pending = deferred<ReturnType<typeof json>>();
    const fetchMock = vi.fn().mockResolvedValueOnce(json({ templates: choices })).mockResolvedValueOnce(json({ review: review() }))
      .mockReturnValueOnce(pending.promise);
    vi.stubGlobal('fetch', fetchMock);
    const { props } = setup(); await beginReview();
    const insert = screen.getByRole('button', { name: 'Insert' });
    fireEvent.click(insert); fireEvent.click(insert);
    expect(actions(fetchMock)).toHaveLength(1);
    expect((screen.getByRole('button', { name: 'Skip' }) as HTMLButtonElement).disabled).toBe(true);
    expect((screen.getByRole('button', { name: 'Finish' }) as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(screen.getByRole('button', { name: 'Close' })); fireEvent.keyDown(screen.getByRole('dialog'), { key: 'Escape' });
    expect(props.onOpenChange).not.toHaveBeenCalled();
    await act(async () => pending.resolve(json({ review: review(1, 1), data })));
    expect(screen.getByText('Item 2 of 2')).toBeTruthy();
    expect(props.onInserted).toHaveBeenCalledOnce();
  });

  it('allows invalid rows to be skipped and never sends an Insert for them', async () => {
    const invalid = review(); invalid.current!.error = 'CSV row 2: the artwork could not be decoded.';
    const fetchMock = vi.fn().mockResolvedValueOnce(json({ templates: choices })).mockResolvedValueOnce(json({ review: invalid }))
      .mockResolvedValueOnce(json({ review: review(1, 0, 1) }));
    vi.stubGlobal('fetch', fetchMock);
    const { props } = setup(); await beginReview();
    expect(screen.getByRole('alert').textContent).toContain('CSV row 2');
    const insert = screen.getByRole('button', { name: 'Insert' }) as HTMLButtonElement;
    expect(insert.disabled).toBe(true); fireEvent.click(insert);
    expect(actions(fetchMock)).toEqual([]);
    fireEvent.click(screen.getByRole('button', { name: 'Skip' }));
    await screen.findByText('Otter print');
    expect(actions(fetchMock).map((body) => body.action)).toEqual(['skip']);
    expect(props.onInserted).not.toHaveBeenCalled();
    expect(screen.getAllByRole('status').some((element) => element.textContent?.includes('0 inserted'))).toBe(true);
  });

  it.each([
    { scenario: 'oversized artwork', warning: 'CSV row 2: Skipping this image because it exceeds the 60 MB per-image limit (62.4 MB). Choose Skip to continue.' },
    { scenario: 'a duplicate listing title', warning: 'CSV row 2: A listing or folder named "Fox print" already exists in this section. Choose Skip to continue.' },
  ])('shows artwork and the warning for $scenario, blocks Insert, and lets Skip continue to an insertable item', async ({ warning }) => {
    const blocked = review();
    blocked.current!.error = warning;
    const fetchMock = vi.fn().mockResolvedValueOnce(json({ templates: choices })).mockResolvedValueOnce(json({ review: blocked }))
      .mockResolvedValueOnce(json({ review: review(1, 0, 1) }));
    vi.stubGlobal('fetch', fetchMock);
    const { props } = setup(); await beginReview();
    expect(screen.getByText('Fox print')).toBeTruthy();
    expect(screen.getByText('A woodland fox.')).toBeTruthy();
    expect(screen.getByRole('alert').textContent).toBe(warning);
    const image = screen.getByRole('img', { name: 'Fox print import artwork' }) as HTMLImageElement;
    expect(new URL(image.src).searchParams.get('action')).toBe('image');
    expect(new URL(image.src).searchParams.get('rowIndex')).toBe('0');
    fireEvent.load(image);
    expect(image.className).not.toContain('invisible');
    const insert = screen.getByRole('button', { name: 'Insert' }) as HTMLButtonElement;
    expect(insert.disabled).toBe(true); fireEvent.click(insert);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(actions(fetchMock)).toEqual([]); expect(props.onInserted).not.toHaveBeenCalled();
    const skip = screen.getByRole('button', { name: 'Skip' }) as HTMLButtonElement;
    expect(skip.disabled).toBe(false); fireEvent.click(skip);
    await screen.findByText('Otter print');
    expect(screen.getByRole('img', { name: 'Otter print import artwork' })).toBeTruthy();
    expect(screen.queryByRole('alert')).toBeNull();
    expect((screen.getByRole('button', { name: 'Insert' }) as HTMLButtonElement).disabled).toBe(false);
    expect((screen.getByRole('progressbar') as HTMLProgressElement).value).toBe(1);
    expect(actions(fetchMock)).toEqual([{ shopId: '123', sectionId: '3', subSectionId: '8', sessionId: 'review-1', rowIndex: 0, action: 'skip' }]);
  });

  it('keeps Insert available when only the browser artwork preview fails', async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce(json({ templates: choices })).mockResolvedValueOnce(json({ review: review() }))
      .mockResolvedValueOnce(json({ review: review(1, 1), data }));
    vi.stubGlobal('fetch', fetchMock);
    setup(); await beginReview();
    fireEvent.error(screen.getByRole('img', { name: 'Fox print import artwork' }));
    expect(screen.getByText(/Unable to load the artwork preview/)).toBeTruthy();
    expect((screen.getByRole('button', { name: 'Insert' }) as HTMLButtonElement).disabled).toBe(false);
    expect((screen.getByRole('button', { name: 'Skip' }) as HTMLButtonElement).disabled).toBe(false);
    fireEvent.click(screen.getByRole('button', { name: 'Insert' }));
    await screen.findByText('Otter print');
    expect(actions(fetchMock)[0]).toMatchObject({ action: 'insert', cropSettings: defaultCrops() });
  });

  it('edits the real six-ratio crop editor and sends complete source-based settings only on Insert', async () => {
    const initial = defaultCrops(4000, 5000);
    initial.regions['2x3'].x = 0.02;
    initial.placements!['2x3'] = cropRegionToArtworkPlacement(initial.regions['2x3']);
    const first = fourByFiveReview(); Object.assign(first.current!, { initialCropSettings: initial });
    const fetchMock = vi.fn().mockResolvedValueOnce(json({ templates: choices })).mockResolvedValueOnce(json({ review: first }))
      .mockResolvedValueOnce(json({ review: review(1, 1), data }));
    vi.stubGlobal('fetch', fetchMock);
    const { props } = setup(); await beginReview();
    expect(screen.getAllByRole('tab')).toHaveLength(6);
    expect(screen.getByRole('tab', { name: /^2:3/ }).getAttribute('aria-selected')).toBe('true');
    expect(screen.getByText('A woodland fox.')).toBeTruthy();
    const image = screen.getByRole('img', { name: 'Fox print import artwork' }) as HTMLImageElement;
    Object.defineProperties(image, { naturalWidth: { configurable: true, value: 410 }, naturalHeight: { configurable: true, value: 512 } });
    fireEvent.load(image);
    const crop = screen.getByRole('slider', { name: '2:3 crop area' });
    expect(Number.parseFloat(crop.style.width)).toBeCloseTo(100 * 5 / 6);
    expect(Number.parseFloat(crop.style.left)).toBeCloseTo(2);
    expect(crop.style.boxShadow).toContain('100vmax');
    dragCrop(40, 200); // The original-width geometry uses +0.1 horizontally and ignores vertical movement.
    fireEvent.click(screen.getByRole('tab', { name: /^3:4/ }));
    fireEvent.keyDown(screen.getByRole('slider', { name: '3:4 crop area' }), { key: 'ArrowLeft' });
    fireEvent.click(screen.getByRole('tab', { name: /^2:3/ }));
    expect(Number.parseFloat(screen.getByRole('slider', { name: '2:3 crop area' }).style.left)).toBeCloseTo(12);
    expect(actions(fetchMock)).toEqual([]);
    expect(props.onInserted).not.toHaveBeenCalled();
    expect(fetchMock).toHaveBeenCalledTimes(2);
    const expected = defaultCrops(4000, 5000);
    expected.regions['2x3'].x = 0.12;
    expected.regions['3x4'].x -= 0.01;
    expected.placements!['2x3'] = cropRegionToArtworkPlacement(expected.regions['2x3']);
    expected.placements!['3x4'] = cropRegionToArtworkPlacement(expected.regions['3x4']);
    fireEvent.click(screen.getByRole('button', { name: 'Insert' }));
    await screen.findByText('Otter print');
    const sent = actions(fetchMock)[0];
    expect(sent).toMatchObject({ shopId: '123', sectionId: '3', subSectionId: '8', sessionId: 'review-1', rowIndex: 0, action: 'insert' });
    expect(sent.cropSettings.regions['2x3'].x).toBeCloseTo(expected.regions['2x3'].x);
    expect(sent.cropSettings.regions['3x4'].x).toBeCloseTo(expected.regions['3x4'].x);
    expectCrops(sent.cropSettings, expected);
    expect(fetchMock.mock.calls.some(([url]) => String(url).includes('/editor/print-crops'))).toBe(false);
  });

  it('resets the active ratio and crop draft to the next artwork instead of carrying edits between rows', async () => {
    const next = fourByFiveReview(1, 1);
    const nextDraft = defaultCrops(4000, 5000);
    nextDraft.regions['2x3'].x = 0.025;
    nextDraft.placements!['2x3'] = cropRegionToArtworkPlacement(nextDraft.regions['2x3']);
    Object.assign(next.current!, { initialCropSettings: nextDraft });
    const fetchMock = vi.fn().mockResolvedValueOnce(json({ templates: choices })).mockResolvedValueOnce(json({ review: fourByFiveReview() }))
      .mockResolvedValueOnce(json({ review: next, data })).mockResolvedValueOnce(json({ review: review(2, 2), data }));
    vi.stubGlobal('fetch', fetchMock);
    setup(); await beginReview();
    fireEvent.keyDown(screen.getByRole('slider', { name: '2:3 crop area' }), { key: 'ArrowRight' });
    fireEvent.click(screen.getByRole('tab', { name: /^3:4/ }));
    fireEvent.keyDown(screen.getByRole('slider', { name: '3:4 crop area' }), { key: 'ArrowLeft' });
    fireEvent.click(screen.getByRole('button', { name: 'Insert' }));
    await screen.findByText('Otter print');
    expect(screen.getByRole('tab', { name: /^2:3/ }).getAttribute('aria-selected')).toBe('true');
    expect(Number.parseFloat(screen.getByRole('slider', { name: '2:3 crop area' }).style.left)).toBeCloseTo(2.5);
    expect((screen.getByRole('button', { name: 'Insert' }) as HTMLButtonElement).disabled).toBe(false);
    fireEvent.click(screen.getByRole('tab', { name: /^3:4/ }));
    expect(Number.parseFloat(screen.getByRole('slider', { name: '3:4 crop area' }).style.left)).toBeCloseTo(3.125);
    fireEvent.click(screen.getByRole('button', { name: 'Insert' }));
    await screen.findByText('Review complete');
    expect(actions(fetchMock)[1].rowIndex).toBe(1);
    expectCrops(actions(fetchMock)[1].cropSettings, nextDraft);
    expect(actions(fetchMock)[0].cropSettings).not.toEqual(actions(fetchMock)[1].cropSettings);
  });

  it('discards crop edits on Skip without submitting or persisting them', async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce(json({ templates: choices })).mockResolvedValueOnce(json({ review: fourByFiveReview() }))
      .mockResolvedValueOnce(json({ review: fourByFiveReview(1, 0, 1) })).mockResolvedValue(json({ closed: true }));
    vi.stubGlobal('fetch', fetchMock);
    const { props } = setup(); await beginReview();
    fireEvent.keyDown(screen.getByRole('slider', { name: '2:3 crop area' }), { key: 'ArrowRight' });
    fireEvent.click(screen.getByRole('tab', { name: /^3:4/ }));
    fireEvent.click(screen.getByRole('button', { name: 'Skip' }));
    await screen.findByText('Otter print');
    expect(actions(fetchMock)).toEqual([{ shopId: '123', sectionId: '3', subSectionId: '8', sessionId: 'review-1', rowIndex: 0, action: 'skip' }]);
    expect(screen.getByRole('tab', { name: /^2:3/ }).getAttribute('aria-selected')).toBe('true');
    expect(Number.parseFloat(screen.getByRole('slider', { name: '2:3 crop area' }).style.left)).toBeCloseTo(100 / 12);
    expect(props.onInserted).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Finish' }));
    expect(props.onFinished).toHaveBeenCalledWith({ insertedCount: 0, skippedCount: 1, totalCount: 2 });
  });

  it('keeps unsaved crop edits and the selected ratio when Refresh returns the same row', async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce(json({ templates: choices })).mockResolvedValueOnce(json({ review: fourByFiveReview() }))
      .mockResolvedValueOnce(json({ error: 'The Skip response could not be confirmed.' }, false))
      .mockResolvedValueOnce(json({ review: fourByFiveReview() })).mockResolvedValueOnce(json({ review: review(1, 1), data }));
    vi.stubGlobal('fetch', fetchMock);
    setup(); await beginReview();
    fireEvent.keyDown(screen.getByRole('slider', { name: '2:3 crop area' }), { key: 'ArrowRight' });
    fireEvent.click(screen.getByRole('tab', { name: /^3:4/ }));
    fireEvent.keyDown(screen.getByRole('slider', { name: '3:4 crop area' }), { key: 'ArrowLeft' });
    const before = screen.getByRole('slider', { name: '3:4 crop area' }).style.left;
    fireEvent.click(screen.getByRole('button', { name: 'Skip' }));
    await screen.findByRole('alert');
    fireEvent.click(screen.getByRole('button', { name: 'Refresh review' }));
    await waitFor(() => expect(screen.queryByRole('alert')).toBeNull());
    expect(screen.getByRole('tab', { name: /^3:4/ }).getAttribute('aria-selected')).toBe('true');
    expect(screen.getByRole('slider', { name: '3:4 crop area' }).style.left).toBe(before);
    fireEvent.click(screen.getByRole('button', { name: 'Insert' }));
    await screen.findByText('Otter print');
    expect(actions(fetchMock)[0]).not.toHaveProperty('cropSettings');
    const sent = actions(fetchMock)[1].cropSettings as ListingPrintCropDraft;
    expect(sent.regions['2x3'].x).toBeCloseTo(1 / 12 + 0.01);
    expect(sent.regions['3x4'].x).toBeCloseTo(0.03125 - 0.01);
    expect(fetchMock).toHaveBeenCalledWith(`${endpoint}?shopId=123&sectionId=3&subSectionId=8&action=review&sessionId=review-1`, { cache: 'no-store' });
  });

  it('freezes the first Insert crop intent and retries an uncertain response with the exact same payload', async () => {
    const pending = deferred<ReturnType<typeof json>>();
    const fetchMock = vi.fn().mockResolvedValueOnce(json({ templates: choices })).mockResolvedValueOnce(json({ review: fourByFiveReview() }))
      .mockReturnValueOnce(pending.promise).mockResolvedValueOnce(json({ review: review(1, 1), data }));
    vi.stubGlobal('fetch', fetchMock);
    setup(); await beginReview();
    fireEvent.keyDown(screen.getByRole('slider', { name: '2:3 crop area' }), { key: 'ArrowRight' });
    const crop = screen.getByRole('slider', { name: '2:3 crop area' });
    const frozenLeft = crop.style.left;
    fireEvent.click(screen.getByRole('button', { name: 'Insert' }));
    expect(crop.getAttribute('aria-disabled')).toBe('true');
    fireEvent.keyDown(crop, { key: 'ArrowRight' });
    dragCrop(40);
    expect(crop.style.left).toBe(frozenLeft);
    await act(async () => pending.resolve(json({ error: 'The previous Insert result is not confirmed. Retry Insert.' }, false)));
    await screen.findByRole('alert');
    expect(crop.getAttribute('aria-disabled')).toBe('true');
    fireEvent.keyDown(crop, { key: 'ArrowLeft' });
    expect(crop.style.left).toBe(frozenLeft);
    fireEvent.click(screen.getByRole('button', { name: 'Insert' }));
    await screen.findByText('Otter print');
    const sent = actions(fetchMock);
    expect(sent).toHaveLength(2);
    expect(sent[0]).toEqual(sent[1]);
    expect(sent[0].cropSettings.regions['2x3'].x).toBeCloseTo(1 / 12 + 0.01);
    expect(fetchMock.mock.calls.filter(([, options]) => options?.body instanceof FormData)).toHaveLength(1);
    expect((screen.getByRole('button', { name: 'Insert' }) as HTMLButtonElement).disabled).toBe(false);
  });

  it('retries a failed Insert with the same row index instead of advancing or repeating the ZIP upload', async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce(json({ templates: choices })).mockResolvedValueOnce(json({ review: review() }))
      .mockRejectedValueOnce(new TypeError('Network interrupted.')).mockResolvedValueOnce(json({ review: review(1, 1), data }));
    vi.stubGlobal('fetch', fetchMock);
    const { props } = setup(); await beginReview();
    fireEvent.click(screen.getByRole('button', { name: 'Insert' }));
    expect((await screen.findByRole('alert')).textContent).toBe('Network interrupted.');
    expect(screen.getByText('Fox print')).toBeTruthy();
    expect((screen.getByRole('progressbar') as HTMLProgressElement).value).toBe(0);
    fireEvent.click(screen.getByRole('button', { name: 'Insert' }));
    await screen.findByText('Otter print');
    expect(actions(fetchMock).map((body) => body.rowIndex)).toEqual([0, 0]);
    expect(fetchMock.mock.calls.filter(([, options]) => options?.body instanceof FormData)).toHaveLength(1);
    expect(props.onInserted).toHaveBeenCalledOnce();
  });

  it('resyncs acknowledged server progress after a lost response and reports it when finishing', async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce(json({ templates: choices })).mockResolvedValueOnce(json({ review: review() }))
      .mockRejectedValueOnce(new TypeError('Connection lost.')).mockResolvedValueOnce(json({ review: review(1, 1) }))
      .mockResolvedValue(json({ closed: true }));
    vi.stubGlobal('fetch', fetchMock);
    const { props } = setup(); await beginReview();
    fireEvent.click(screen.getByRole('button', { name: 'Insert' })); await screen.findByRole('alert');
    fireEvent.click(screen.getByRole('button', { name: 'Refresh review' }));
    await screen.findByText('Otter print');
    expect(fetchMock).toHaveBeenCalledWith(`${endpoint}?shopId=123&sectionId=3&subSectionId=8&action=review&sessionId=review-1`, { cache: 'no-store' });
    expect(screen.getByRole('alert').textContent).toContain('table could not be refreshed');
    fireEvent.click(screen.getByRole('button', { name: 'Finish' }));
    expect(props.onFinished).toHaveBeenCalledWith({ insertedCount: 1, skippedCount: 0, totalCount: 2 });
    expect(actions(fetchMock)).toHaveLength(1);
  });

  it('confirms a lost Insert response before Finish reports counts and removes the session', async () => {
    const confirmation = deferred<ReturnType<typeof json>>();
    const fetchMock = vi.fn().mockResolvedValueOnce(json({ templates: choices })).mockResolvedValueOnce(json({ review: review() }))
      .mockRejectedValueOnce(new TypeError('Insert response lost.')).mockReturnValueOnce(confirmation.promise)
      .mockResolvedValue(json({ closed: true }));
    vi.stubGlobal('fetch', fetchMock);
    const { props } = setup(); await beginReview();
    fireEvent.click(screen.getByRole('button', { name: 'Insert' })); await screen.findByRole('alert');
    fireEvent.click(screen.getByRole('button', { name: 'Finish' }));
    expect(screen.getByText('Checking the latest review progress…')).toBeTruthy();
    expect(props.onFinished).not.toHaveBeenCalled(); expect(props.onOpenChange).not.toHaveBeenCalled();
    expect(fetchMock.mock.calls.filter(([, options]) => options?.method === 'DELETE')).toHaveLength(0);
    expect(fetchMock).toHaveBeenCalledWith(`${endpoint}?shopId=123&sectionId=3&subSectionId=8&action=review&sessionId=review-1`, { cache: 'no-store' });
    await act(async () => confirmation.resolve(json({ review: review(1, 1) })));
    expect(props.onFinished).toHaveBeenCalledExactlyOnceWith({ insertedCount: 1, skippedCount: 0, totalCount: 2 });
    expect(props.onOpenChange).toHaveBeenCalledWith(false);
    expect(fetchMock.mock.calls.filter(([, options]) => options?.method === 'DELETE')).toHaveLength(1);
    expect(actions(fetchMock)).toHaveLength(1);
  });

  it('allows Finish with an unconfirmed summary when both the Insert response and resync fail', async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce(json({ templates: choices })).mockResolvedValueOnce(json({ review: review() }))
      .mockRejectedValueOnce(new TypeError('Insert response lost.')).mockResolvedValueOnce(json({ error: 'Review expired.' }, false))
      .mockResolvedValue(json({ closed: true }));
    vi.stubGlobal('fetch', fetchMock);
    const { props } = setup(); await beginReview();
    fireEvent.click(screen.getByRole('button', { name: 'Insert' })); await screen.findByRole('alert');
    fireEvent.click(screen.getByRole('button', { name: 'Finish' }));
    await waitFor(() => expect(props.onFinished).toHaveBeenCalledExactlyOnceWith({ insertedCount: 0, skippedCount: 0, totalCount: 2, unconfirmed: true }));
    expect(props.onOpenChange).toHaveBeenCalledWith(false);
    expect(fetchMock.mock.calls.filter(([, options]) => options?.method === 'DELETE')).toHaveLength(1);
    expect(actions(fetchMock)).toHaveLength(1);
    expect(props.onImportingChange).toHaveBeenLastCalledWith(false);
  });

  it('treats an unreadable successful Insert response as uncertain when closing', async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce(json({ templates: choices })).mockResolvedValueOnce(json({ review: review() }))
      .mockResolvedValueOnce(json({ review: null })).mockResolvedValueOnce(json({ review: review(1, 1) }))
      .mockResolvedValue(json({ closed: true }));
    vi.stubGlobal('fetch', fetchMock);
    const { props } = setup(); await beginReview();
    fireEvent.click(screen.getByRole('button', { name: 'Insert' })); await screen.findByRole('alert');
    fireEvent.click(screen.getByRole('button', { name: 'Close' }));
    await waitFor(() => expect(props.onFinished).toHaveBeenCalledExactlyOnceWith({ insertedCount: 1, skippedCount: 0, totalCount: 2 }));
    expect(props.onOpenChange).toHaveBeenCalledWith(false);
  });

  it('advances after a committed insertion even if refreshing the table fails', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValueOnce(json({ templates: choices })).mockResolvedValueOnce(json({ review: review() }))
      .mockResolvedValueOnce(json({ review: review(1, 1), data: null, refreshError: 'The listing was inserted; refresh the table when finished.' })));
    const { props } = setup(); await beginReview();
    fireEvent.click(screen.getByRole('button', { name: 'Insert' }));
    await screen.findByText('Otter print');
    expect(screen.getByRole('alert').textContent).toContain('was inserted');
    expect((screen.getByRole('progressbar') as HTMLProgressElement).value).toBe(1);
    expect(props.onInserted).not.toHaveBeenCalled();
    expect(screen.queryByRole('button', { name: 'Refresh review' })).toBeNull();
  });

  it.each(['Close', 'Escape'])('finishes a partial review through %s and removes the temporary session', async (method) => {
    const fetchMock = vi.fn().mockResolvedValueOnce(json({ templates: choices })).mockResolvedValueOnce(json({ review: review() }))
      .mockResolvedValueOnce(json({ review: review(1, 1), data })).mockResolvedValue(json({ closed: true }));
    vi.stubGlobal('fetch', fetchMock);
    const { props, unmount } = setup(); await beginReview();
    fireEvent.click(screen.getByRole('button', { name: 'Insert' })); await screen.findByText('Otter print');
    if (method === 'Close') fireEvent.click(screen.getByRole('button', { name: 'Close' }));
    else fireEvent.keyDown(screen.getByRole('dialog'), { key: 'Escape' });
    expect(props.onFinished).toHaveBeenCalledExactlyOnceWith({ insertedCount: 1, skippedCount: 0, totalCount: 2 });
    expect(props.onOpenChange).toHaveBeenCalledWith(false);
    unmount();
    expect(fetchMock.mock.calls.filter(([, options]) => options?.method === 'DELETE')).toHaveLength(1);
  });
});
