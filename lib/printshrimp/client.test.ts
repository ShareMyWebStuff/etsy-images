import { describe, expect, it, vi } from 'vitest';

import {
  createPrintShrimpArtworkClient,
  PrintShrimpAdapterError,
  type PrintShrimpClientConfig,
  type PrintShrimpProductSync,
} from '@/lib/printshrimp/client';
import { PRINTSHRIMP_RATIOS } from '@/lib/printshrimp/artwork';

const config: PrintShrimpClientConfig = {
  apiKey: 'secret-test-key',
  timeoutMilliseconds: 5_000,
};

function productSync(overrides: Partial<PrintShrimpProductSync> = {}): PrintShrimpProductSync {
  return {
    productName: 'Green Sea Turtle Print',
    sku: 'SEA-TURTLE',
    previousSkus: [],
    existingExternalItemId: null,
    artwork: PRINTSHRIMP_RATIOS.map((ratio) => ({
      ratio,
      fileName: `SEA-TURTLE_${ratio}.jpg`,
      filePath: `C:/temp/SEA-TURTLE_${ratio}.jpg`,
      width: 4800,
      height: 6000,
      density: 300,
    })),
    ratiosToUpdate: [...PRINTSHRIMP_RATIOS],
    ...overrides,
  };
}

function json(status: number, body: unknown) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

function dependencies(fetchMock: ReturnType<typeof vi.fn>) {
  return {
    fetch: fetchMock as typeof fetch,
    readFile: vi.fn(async () => Buffer.from('jpeg')),
    stage: vi.fn(async (filePath: string) => `https://bucket.example.test/${filePath.split(/[\\/]/).at(-1)}`),
    cleanup: vi.fn(async () => undefined),
    createStagingPath: vi.fn((fileName: string) => `D:/Etsy/EtsyListings/.printshrimp-staging/id/${fileName}`),
  };
}

describe('PrintShrimp API product client', () => {
  it('creates one base-SKU product containing variants for all six Digital Download ratios', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(json(404, { success: false, error: 'Not found' }))
      .mockResolvedValueOnce(json(201, { success: true, product: { product_id: 'product-1', sku: 'SEA-TURTLE' } }));
    const deps = dependencies(fetchMock);
    const client = createPrintShrimpArtworkClient(config, deps);

    await expect(client.syncProduct(productSync())).resolves.toEqual({
      externalItemId: 'product-1',
      synchronizedRatios: PRINTSHRIMP_RATIOS,
    });
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(String(fetchMock.mock.calls[0][0])).toBe('https://api.printshrimp.com/functions/v1/api-get-product?sku=SEA-TURTLE');
    expect(String(fetchMock.mock.calls[1][0])).toBe('https://api.printshrimp.com/functions/v1/api-create-product');
    const createOptions = fetchMock.mock.calls[1][1] as RequestInit;
    expect(createOptions.method).toBe('POST');
    expect(createOptions.headers).toMatchObject({ 'x-api-key': 'secret-test-key' });
    const body = JSON.parse(String(createOptions.body)) as { name: string; sku: string; variants: Array<{ size: string; image_url: string }> };
    expect(body.name).toBe('Green Sea Turtle Print');
    expect(body.sku).toBe('SEA-TURTLE');
    expect(body.variants.map((variant) => variant.size)).toEqual([
      'A1', 'A2', 'A3', 'A4', 'A5',
      '5x7', '50x70cm',
      '8x10', '16x20',
      '11x14',
      '6x8', '18x24', '30x40cm',
      '12x18', '16x24', '20x30', '24x36',
    ]);
    expect(new Set(body.variants.map((variant) => variant.image_url)).size).toBe(6);
    expect(deps.cleanup).toHaveBeenCalledTimes(6);
  });

  it('updates only the sizes belonging to changed artwork on an existing product', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(json(200, { success: true, product: { product_id: 'product-1', sku: 'SEA-TURTLE' } }))
      .mockResolvedValueOnce(json(200, { success: true, product: { product_id: 'product-1', sku: 'SEA-TURTLE' } }));
    const deps = dependencies(fetchMock);
    const client = createPrintShrimpArtworkClient(config, deps);

    await expect(client.syncProduct(productSync({
      existingExternalItemId: 'product-1',
      ratiosToUpdate: ['4x5'],
    }))).resolves.toEqual({ externalItemId: 'product-1', synchronizedRatios: ['4x5'] });
    const updateBody = JSON.parse(String((fetchMock.mock.calls[1][1] as RequestInit).body)) as { sku: string; variants: Array<{ size: string }> };
    expect(updateBody.sku).toBe('SEA-TURTLE');
    expect(updateBody.variants.map((variant) => variant.size)).toEqual(['8x10', '16x20']);
    expect(deps.stage).toHaveBeenCalledOnce();
  });

  it('renames one prior ratio-SKU product to the base SKU without creating another product', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(json(404, { success: false, error: 'Not found' }))
      .mockResolvedValueOnce(json(200, { success: true, product: { product_id: 'old-product', sku: 'SEA-TURTLE_A' } }))
      .mockResolvedValueOnce(json(200, { success: true, product: { product_id: 'old-product', sku: 'SEA-TURTLE' } }));
    const client = createPrintShrimpArtworkClient(config, dependencies(fetchMock));

    await client.syncProduct(productSync({ previousSkus: ['SEA-TURTLE_A'], existingExternalItemId: 'old-product' }));
    const updateBody = JSON.parse(String((fetchMock.mock.calls[2][1] as RequestInit).body));
    expect(updateBody).toMatchObject({ sku: 'SEA-TURTLE_A', new_sku: 'SEA-TURTLE' });
    expect(fetchMock.mock.calls[2][1]).toMatchObject({ method: 'PUT' });
  });

  it('checks the base product ID and expected size variants', async () => {
    const variants = [
      'A1', 'A2', 'A3', 'A4', 'A5', '5x7', '50x70cm', '8x10', '16x20',
      '11x14', '6x8', '18x24', '30x40cm', '12x18', '16x24', '20x30', '24x36',
    ].map((size) => ({ size }));
    const fetchMock = vi.fn().mockResolvedValue(json(200, {
      success: true,
      product: { product_id: 'product-1', sku: 'SEA-TURTLE', variants },
    }));
    const client = createPrintShrimpArtworkClient(config, dependencies(fetchMock));

    await expect(client.productExists!({
      externalItemId: 'product-1',
      sku: 'SEA-TURTLE',
      ratios: [...PRINTSHRIMP_RATIOS],
    })).resolves.toBe(true);
  });

  it('classifies server errors as transient and cleans up every staged file', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(json(404, { success: false, error: 'Not found' }))
      .mockResolvedValueOnce(json(503, { error: 'Try later' }));
    const deps = dependencies(fetchMock);
    const client = createPrintShrimpArtworkClient(config, deps);

    await expect(client.syncProduct(productSync())).rejects.toMatchObject<Partial<PrintShrimpAdapterError>>({ transient: true });
    expect(deps.cleanup).toHaveBeenCalledTimes(6);
  });

  it('does not expose the configured API key in a remote error', async () => {
    const fetchMock = vi.fn().mockResolvedValue(json(401, { error: 'Invalid key secret-test-key' }));
    const client = createPrintShrimpArtworkClient(config, dependencies(fetchMock));

    const error = await client.syncProduct(productSync()).catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(PrintShrimpAdapterError);
    expect((error as Error).message).toContain('[redacted]');
    expect((error as Error).message).not.toContain('secret-test-key');
  });
});
