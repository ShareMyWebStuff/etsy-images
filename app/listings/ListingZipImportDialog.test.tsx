import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ListingZipImportDialog } from '@/app/listings/ListingZipImportDialog';
import type { SubSectionListingsPageData } from '@/lib/listing-table';

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
    destinationName: 'Country Shop / Wall Art / Woodland', onImported: vi.fn(), onImportingChange: vi.fn(), ...overrides };
  return { ...render(<ListingZipImportDialog {...props} />), props };
}
const zip = () => new File(['example ZIP'], 'woodland.zip', { type: 'application/zip' });
function upload(file = zip()) { fireEvent.change(screen.getByLabelText('ZIP archive'), { target: { files: [file] } }); return file; }
async function chooseTemplate() { await screen.findByRole('option', { name: choices[0].name }); fireEvent.change(screen.getByLabelText('Import template'), { target: { value: '15' } }); }

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
    expect(fetchMock).toHaveBeenCalledWith(`${endpoint}?shopId=123&sectionId=3&subSectionId=8`, expect.objectContaining({ cache: 'no-store' }));
    expect((screen.getByRole('button', { name: 'Import listings' }) as HTMLButtonElement).disabled).toBe(true);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('requires both choices, submits the exact multipart context once and reports the returned data/count', async () => {
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
    expect(screen.getByRole('status').textContent).toContain('Importing listings');
    expect((screen.getByRole('button', { name: 'Cancel' }) as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(screen.getByRole('button', { name: 'Close' }));
    fireEvent.keyDown(screen.getByRole('dialog'), { key: 'Escape' });
    expect(props.onOpenChange).not.toHaveBeenCalled();
    await act(async () => pending.resolve(json({ data, importedCount: 2, listingIds: ['601', '602'] })));
    expect(props.onImported).toHaveBeenCalledWith(data, 2);
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
    const large = zip(); Object.defineProperty(large, 'size', { value: 400 * 1024 * 1024 + 1 });
    upload(large); expect(screen.getByRole('alert').textContent).toContain('400 MB or smaller');
    expect((screen.getByRole('button', { name: 'Import listings' }) as HTMLButtonElement).disabled).toBe(true);
    const boundary = zip(); Object.defineProperty(boundary, 'size', { value: 400 * 1024 * 1024 });
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

  it('keeps row validation errors in the dialog and preserves the choices for retry', async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce(json({ templates: choices }))
      .mockResolvedValueOnce(json({ error: 'CSV row 4: image images/otter.png is missing.' }, false))
      .mockResolvedValueOnce(json({ data, importedCount: 1, listingIds: ['601'] }));
    vi.stubGlobal('fetch', fetchMock);
    const { props } = setup(); await chooseTemplate(); upload();
    fireEvent.click(screen.getByRole('button', { name: 'Import listings' }));
    expect((await screen.findByRole('alert')).textContent).toContain('CSV row 4');
    expect(props.onImported).not.toHaveBeenCalled(); expect(props.onOpenChange).not.toHaveBeenCalled();
    expect((screen.getByLabelText('Import template') as HTMLSelectElement).value).toBe('15');
    expect(screen.getByText('Selected ZIP: woodland.zip')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Import listings' }));
    await waitFor(() => expect(props.onImported).toHaveBeenCalledWith(data, 1));
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

  it('does not apply a completed import to another destination', async () => {
    const pending = deferred<ReturnType<typeof json>>();
    const fetchMock = vi.fn().mockResolvedValueOnce(json({ templates: choices })).mockReturnValueOnce(pending.promise)
      .mockResolvedValueOnce(json({ templates: choices }));
    vi.stubGlobal('fetch', fetchMock);
    const { props, rerender } = setup(); await chooseTemplate(); upload();
    fireEvent.click(screen.getByRole('button', { name: 'Import listings' }));
    rerender(<ListingZipImportDialog {...props} subSectionId="9" />);
    await act(async () => pending.resolve(json({ data, importedCount: 1, listingIds: ['601'] })));
    expect(props.onImported).not.toHaveBeenCalled();
    expect(props.onImportingChange).toHaveBeenLastCalledWith(false);
  });

  it('rejects a successful response for the wrong destination', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValueOnce(json({ templates: choices }))
      .mockResolvedValueOnce(json({ data: { ...data, subSection: { ...data.subSection, id: '9' } }, importedCount: 1, listingIds: ['601'] })));
    const { props } = setup(); await chooseTemplate(); upload();
    fireEvent.click(screen.getByRole('button', { name: 'Import listings' }));
    expect((await screen.findByRole('alert')).textContent).toContain('Reload this section');
    expect(props.onImported).not.toHaveBeenCalled();
  });
});
