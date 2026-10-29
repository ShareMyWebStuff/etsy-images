import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { EtsyOrderProcessingQueue } from './EtsyOrderProcessingQueue';

function details(id: string, type = 'Normal', artwork = false) {
  return {
    order: { id, etsyReceiptId: `100${id}`, name: `Buyer ${id}`, processingStatus: 'UNPROCESSED', items: [{
      id: `item-${id}`, title: `Print ${id}`, quantity: 1, size: 'A4', productType: 'Print', frameColour: '',
      topText: type === 'Normal' ? '' : 'Oliver', bottomText: '', border: type === 'Customised',
      fontStyle: type === 'In Error' ? 'No Customisation' : 'Nunito', orderType: type,
      error: type === 'In Error' ? 'Message the buyer on Etsy to confirm their font.' : null,
      isCustomised: type === 'Customised', artworkUrl: artwork ? 'https://example.com/custom.jpg' : null,
    }] },
    orderType: type, isCustomised: type === 'Customised', canCreate: type === 'Normal' || artwork,
    missing: [], payload: {},
  };
}
const queue = { orders: [
  { id: '2', etsyReceiptId: '1002', name: 'Buyer 2', orderedAt: '2026-10-27T12:00:00Z' },
  { id: '1', etsyReceiptId: '1001', name: 'Buyer 1', orderedAt: '2026-10-26T12:00:00Z' },
] };
afterEach(() => vi.unstubAllGlobals());

describe('processing new Etsy orders', () => {
  it('reviews the newest order first, skips to the next and cancels on the last', async () => {
    const close = vi.fn();
    vi.stubGlobal('fetch', vi.fn(async (url: string) => Response.json(url.endsWith('/queue') ? queue : details(url.endsWith('/2') ? '2' : '1'))));
    render(<EtsyOrderProcessingQueue onClose={close} onProcessed={vi.fn()} hasWriteScope />);
    expect(await screen.findByRole('heading', { name: 'Process Etsy order 1002' })).toBeTruthy();
    await screen.findByText('This order is normal. Press Create Order to create the order in PrintShrimp.');
    fireEvent.click(screen.getByRole('button', { name: 'Skip' }));
    await screen.findByRole('heading', { name: 'Process Etsy order 1001' });
    await waitFor(() => expect((screen.getByRole('button', { name: 'Cancel' }) as HTMLButtonElement).disabled).toBe(false));
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(close).toHaveBeenCalledOnce();
  });

  it('generates and displays customised artwork before enabling Create Order', async () => {
    const fetchMock = vi.fn(async (url: string) => Response.json(url.endsWith('/queue') ? { orders: [queue.orders[0]] }
      : url.endsWith('/artwork') ? { details: details('2', 'Customised', true) } : details('2', 'Customised')));
    vi.stubGlobal('fetch', fetchMock);
    render(<EtsyOrderProcessingQueue onClose={vi.fn()} onProcessed={vi.fn()} hasWriteScope />);
    expect(await screen.findByRole('img', { name: 'Print 2 preview at A4' })).toBeTruthy();
    expect(screen.getByText('Print size: A4 · White border')).toBeTruthy();
    expect((screen.getByRole('button', { name: 'Create Order' }) as HTMLButtonElement).disabled).toBe(false);
    expect(fetchMock).toHaveBeenCalledWith('/api/etsy/orders/2/artwork', expect.objectContaining({ method: 'POST' }));
  });

  it('shows a contact-buyer error and prevents generation or submission for an invalid font', async () => {
    const fetchMock = vi.fn(async (url: string) => Response.json(url.endsWith('/queue') ? { orders: [queue.orders[0]] } : details('2', 'In Error')));
    vi.stubGlobal('fetch', fetchMock);
    render(<EtsyOrderProcessingQueue onClose={vi.fn()} onProcessed={vi.fn()} hasWriteScope />);
    await screen.findByText('Message the buyer on Etsy to confirm their font.');
    expect((screen.getByRole('button', { name: 'Create Order' }) as HTMLButtonElement).disabled).toBe(true);
    expect(fetchMock.mock.calls.every(([url]) => !url.endsWith('/artwork') && !url.endsWith('/process'))).toBe(true);
  });

  it('refreshes existing customised artwork before approval so old previews cannot omit the requested border', async () => {
    const fetchMock = vi.fn(async (url: string) => Response.json(url.endsWith('/queue') ? { orders: [queue.orders[0]] }
      : url.endsWith('/artwork') ? { details: details('2', 'Customised', true) } : details('2', 'Customised', true)));
    vi.stubGlobal('fetch', fetchMock);
    render(<EtsyOrderProcessingQueue onClose={vi.fn()} onProcessed={vi.fn()} hasWriteScope />);
    await waitFor(() => expect(fetchMock).toHaveBeenCalledWith('/api/etsy/orders/2/artwork', expect.objectContaining({ method: 'POST' })));
    await waitFor(() => expect((screen.getByRole('button', { name: 'Create Order' }) as HTMLButtonElement).disabled).toBe(false));
  });

  it('waits for Continue before loading the next receipt after submission', async () => {
    const fetchMock = vi.fn(async (url: string) => Response.json(url.endsWith('/queue') ? queue
      : url.endsWith('/process') ? { submitted: true } : details(url.endsWith('/2') ? '2' : '1')));
    vi.stubGlobal('fetch', fetchMock);
    render(<EtsyOrderProcessingQueue onClose={vi.fn()} onProcessed={vi.fn().mockResolvedValue(undefined)} hasWriteScope />);
    await waitFor(() => expect((screen.getByRole('button', { name: 'Create Order' }) as HTMLButtonElement).disabled).toBe(false));
    fireEvent.click(screen.getByRole('button', { name: 'Create Order' }));
    await screen.findByText('PrintShrimp order created.');
    expect(fetchMock.mock.calls.some(([url]) => url === '/api/etsy/orders/1')).toBe(false);
    fireEvent.click(screen.getByRole('button', { name: 'Continue' }));
    await screen.findByRole('heading', { name: 'Process Etsy order 1001' });
    await screen.findByText('This order is normal. Press Create Order to create the order in PrintShrimp.');
  });

  it.each([true, false])('keeps the PrintShrimp result visible until Continue (success %s)', async (success) => {
    const close = vi.fn();
    const refresh = vi.fn().mockResolvedValue(undefined);
    const fetchMock = vi.fn(async (url: string) => url.endsWith('/process')
      ? Response.json(success ? { submitted: true, response: { order: { order_id: 'PS-1', status: 'Pending' } } } : { error: 'PrintShrimp rejected the address.' }, { status: success ? 200 : 400 })
      : Response.json(url.endsWith('/queue') ? { orders: [queue.orders[0]] } : details('2')));
    vi.stubGlobal('fetch', fetchMock);
    render(<EtsyOrderProcessingQueue onClose={close} onProcessed={refresh} hasWriteScope />);
    await waitFor(() => expect((screen.getByRole('button', { name: 'Create Order' }) as HTMLButtonElement).disabled).toBe(false));
    fireEvent.click(screen.getByRole('button', { name: 'Create Order' }));
    await screen.findByText(success ? 'PrintShrimp order PS-1 created.' : 'PrintShrimp rejected the address.');
    expect(close).not.toHaveBeenCalled();
    expect(screen.queryByRole('button', { name: 'Create Order' })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Continue' }));
    expect(close).toHaveBeenCalledOnce();
    expect(fetchMock.mock.calls.filter(([url]) => url.endsWith('/process'))).toHaveLength(1);
    expect(refresh).toHaveBeenCalledOnce();
  });
});
