import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { PrintShrimpOrdersClient } from '@/app/printshrimp/orders/PrintShrimpOrdersClient';
import type { PrintShrimpOrdersPageData } from '@/lib/printshrimp/orders';

const data: PrintShrimpOrdersPageData = {
  configured: true,
  configurationMessage: 'PrintShrimp API is configured.',
  sizes: ['A4'],
  products: [{
    listingId: '339',
    name: 'Green Sea Turtle',
    sku: 'SEA_CREATURES_GREEN_SEA_TURTLE',
    sectionId: '10',
    sectionName: 'Sea Creatures Wall Art Listings',
    dropboxFolderUrl: 'https://www.dropbox.com/folder',
    availableSizes: ['A4'],
    artworkFileNames: { A4: 'Green_Turtle_ISO_A1.png' },
    ready: true,
    unavailableReason: null,
  }],
};

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('PrintShrimp Orders page', () => {
  it('submits a SKU-mode order with the requested address defaults when no custom text is entered', async () => {
    const fetchMock = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      expect(String(input)).toBe('/api/printshrimp/orders');
      expect(init?.method).toBe('POST');
      expect(JSON.parse(String(init?.body))).toMatchObject({
        listingId: '339',
        topText: '',
        bottomText: '',
        size: 'A4',
        address2: '',
        city: 'Woking',
        state: 'Surrey',
        zip: 'GU21 4DS',
      });
      return new Response(JSON.stringify({
        custom: false,
        folderUrl: null,
        artworkUrl: null,
        fileName: null,
        payload: {
          external_order_number: 'ORD-123',
          products: [{
            sku: 'SEA_CREATURES_GREEN_SEA_TURTLE',
            size: 'A4',
            type: 'Print',
            paper_type: 'Matte',
          }],
        },
        order: { order_id: 'order-123', status: 'Pending', external_order_number: 'ORD-123' },
        response: {
          success: true,
          order: { order_id: 'order-123', status: 'Pending', external_order_number: 'ORD-123' },
        },
      }), { status: 201, headers: { 'Content-Type': 'application/json' } });
    });
    vi.stubGlobal('fetch', fetchMock);
    const user = userEvent.setup();
    render(<PrintShrimpOrdersClient initialData={data} />);

    const createButton = screen.getByRole('button', { name: 'Create Order' });
    expect((createButton as HTMLButtonElement).disabled).toBe(false);
    await user.click(createButton);

    expect(await screen.findByText('PrintShrimp payload')).toBeTruthy();
    const payloadJson = screen.getByLabelText('PrintShrimp payload JSON').textContent ?? '';
    expect(payloadJson).toContain('"external_order_number": "ORD-123"');
    expect(payloadJson).toContain('"sku": "SEA_CREATURES_GREEN_SEA_TURTLE"');
    expect(payloadJson).toContain('"paper_type": "Matte"');
    expect(screen.queryByText(/artwork_url/)).toBeNull();
    expect(screen.getByText('PrintShrimp order created successfully.')).toBeTruthy();
    expect(screen.getByText('PrintShrimp API response')).toBeTruthy();
    expect(screen.getByLabelText('PrintShrimp API response JSON').textContent).toContain('"success": true');
    expect(screen.getByText(/order-123 · Pending/)).toBeTruthy();
  });

  it('creates custom artwork and shows its permanent S3 link when text is entered', async () => {
    vi.stubGlobal('fetch', vi.fn(async (_input: string | URL | Request, init?: RequestInit) => {
      expect(JSON.parse(String(init?.body))).toMatchObject({ topText: "Cameron's room", bottomText: '' });
      return new Response(JSON.stringify({
        custom: true,
        folderUrl: null,
        artworkUrl: 'https://etsy-listings-printshrimp-upload-eu-west-2.s3.eu-west-2.amazonaws.com/printshrimp-staging/custom-orders/ORD-123/custom.jpg',
        fileName: 'ORD-123-SEA_CREATURES_GREEN_SEA_TURTLE-A4-custom.jpg',
        payload: {
          products: [{
            size: 'A4',
            type: 'Print',
            paper_type: 'Matte',
            image: { artwork_url: 'https://etsy-listings-printshrimp-upload-eu-west-2.s3.eu-west-2.amazonaws.com/printshrimp-staging/custom-orders/ORD-123/custom.jpg' },
          }],
        },
        order: { order_id: 'custom-order-123', status: 'Pending' },
        response: { success: true, order: { order_id: 'custom-order-123', status: 'Pending' } },
      }), { status: 201, headers: { 'Content-Type': 'application/json' } });
    }));
    const user = userEvent.setup();
    render(<PrintShrimpOrdersClient initialData={data} />);

    const topText = screen.getByLabelText('Top text') as HTMLInputElement;
    expect(topText.maxLength).toBe(40);
    expect((screen.getByLabelText('Bottom text') as HTMLInputElement).maxLength).toBe(40);
    await user.type(topText, "Cameron's room");
    await user.click(screen.getByRole('button', { name: 'Create Order' }));

    expect((await screen.findByText(/Custom artwork stored in S3/)).textContent).toContain('ORD-123-SEA_CREATURES_GREEN_SEA_TURTLE-A4-custom.jpg');
    expect(screen.getByRole('link', { name: /Open custom artwork/ }).getAttribute('href')).toContain('s3.eu-west-2.amazonaws.com/printshrimp-staging/custom-orders/ORD-123/custom.jpg');
    expect(screen.getByText(/"artwork_url": "https:\/\/etsy-listings-printshrimp-upload-eu-west-2\.s3\.eu-west-2\.amazonaws\.com/)).toBeTruthy();
    expect(screen.queryByText(/"sku"/)).toBeNull();
  });

  it('keeps the S3 artwork link visible when PrintShrimp rejects a custom order', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({
      error: 'PrintShrimp API returned 400: we could not verify the supplied artwork URL.',
      custom: true,
      folderUrl: null,
      artworkUrl: 'https://etsy-listings-printshrimp-upload-eu-west-2.s3.eu-west-2.amazonaws.com/printshrimp-staging/custom-orders/ORD-123/custom.jpg',
      fileName: 'ORD-123-custom.jpg',
      payload: {
        products: [{
          size: 'A4',
          type: 'Print',
          paper_type: 'Matte',
          image: { artwork_url: 'https://etsy-listings-printshrimp-upload-eu-west-2.s3.eu-west-2.amazonaws.com/printshrimp-staging/custom-orders/ORD-123/custom.jpg' },
        }],
      },
      response: {
        success: false,
        error: 'Product 1: we could not verify the supplied artwork URL.',
      },
    }), { status: 400, headers: { 'Content-Type': 'application/json' } })));
    const user = userEvent.setup();
    render(<PrintShrimpOrdersClient initialData={data} />);

    await user.type(screen.getByLabelText('Top text'), 'Welcome');
    await user.click(screen.getByRole('button', { name: 'Create Order' }));

    expect((await screen.findByRole('alert')).textContent).toContain('could not verify the supplied artwork URL');
    expect(screen.getByRole('link', { name: /Open custom artwork/ }).getAttribute('href')).toContain('s3.eu-west-2.amazonaws.com/printshrimp-staging/custom-orders/ORD-123/custom.jpg');
    expect(screen.getByLabelText('PrintShrimp API response JSON').textContent).toContain('"success": false');
    expect(screen.queryByText('PrintShrimp order created successfully.')).toBeNull();
  });

  it('enables Generate only for custom text and displays the generated image in a popup', async () => {
    const createObjectUrl = vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:custom-preview');
    const fetchMock = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      expect(String(input)).toBe('/api/printshrimp/orders/custom-preview');
      expect(JSON.parse(String(init?.body))).toMatchObject({
        listingId: '339',
        size: 'A4',
        topText: 'Welcome',
        bottomText: '',
        fontId: 'nunito-semibold',
      });
      return new Response(Buffer.from('jpeg preview'), {
        status: 200,
        headers: { 'Content-Type': 'image/jpeg' },
      });
    });
    vi.stubGlobal('fetch', fetchMock);
    const user = userEvent.setup();
    render(<PrintShrimpOrdersClient initialData={data} />);

    const generateButton = screen.getByRole('button', { name: 'Generate' }) as HTMLButtonElement;
    expect(generateButton.disabled).toBe(true);
    await user.type(screen.getByLabelText('Top text'), 'Welcome');
    expect(generateButton.disabled).toBe(false);
    await user.click(generateButton);

    expect(await screen.findByRole('dialog', { name: 'Custom artwork preview' })).toBeTruthy();
    const preview = screen.getByRole('img', { name: 'Generated custom PrintShrimp artwork preview' });
    expect(preview.getAttribute('src')).toBe('blob:custom-preview');
    expect(createObjectUrl).toHaveBeenCalledOnce();
  });

  it('retrieves orders and opens all returned information in the Info dialog', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => {
      return new Response(JSON.stringify({
        orders: [{
          order_id: 'order-1',
          external_order_number: 'ORD-123',
          status: 'Shipped',
          paid: true,
          tracking: 'RM1234567GB',
          items: [{ size: 'A4', type: 'Print', paper_type: 'Matte' }],
        }],
      }), { status: 200, headers: { 'Content-Type': 'application/json' } });
    }));
    const user = userEvent.setup();
    render(<PrintShrimpOrdersClient initialData={data} />);

    await user.click(screen.getByRole('tab', { name: 'List Orders' }));
    await user.click(screen.getByRole('button', { name: 'Retrieve Orders' }));
    expect(await screen.findByText('Shipped')).toBeTruthy();
    expect(screen.getByText('Yes')).toBeTruthy();
    await user.click(screen.getByRole('button', { name: 'Info' }));

    expect(screen.getByRole('dialog')).toBeTruthy();
    expect(screen.getByText(/RM1234567GB/)).toBeTruthy();
    expect(screen.getByText(/"paper_type": "Matte"/)).toBeTruthy();
  });
});
