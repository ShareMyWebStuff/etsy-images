import { randomUUID } from 'node:crypto';
import { readFile as readLocalFile } from 'node:fs/promises';

import { getPrintShrimpVariantSizes, type PrintShrimpRatio } from '@/lib/printshrimp/artwork';
import {
  removeStagedPrintShrimpArtwork,
  stagePrintShrimpArtwork,
} from '@/lib/printshrimp/s3-staging';

export type PrintShrimpProductArtwork = {
  ratio: PrintShrimpRatio;
  fileName: string;
  filePath: string;
  width: number;
  height: number;
  density: number;
};

export type PrintShrimpProductSync = {
  productName: string;
  sku: string;
  previousSkus: string[];
  existingExternalItemId: string | null;
  artwork: PrintShrimpProductArtwork[];
  ratiosToUpdate: PrintShrimpRatio[];
};

export type PrintShrimpProductSyncResult = {
  externalItemId: string | null;
  synchronizedRatios: PrintShrimpRatio[];
};

export type PrintShrimpProductLookup = {
  externalItemId: string | null;
  sku: string;
  ratios: PrintShrimpRatio[];
};

export interface PrintShrimpArtworkClient {
  syncProduct(input: PrintShrimpProductSync): Promise<PrintShrimpProductSyncResult>;
  productExists?(input: PrintShrimpProductLookup): Promise<boolean>;
}

export class PrintShrimpConfigurationError extends Error {}

export class PrintShrimpAdapterError extends Error {
  constructor(message: string, readonly transient = false) {
    super(message);
  }
}

export type PrintShrimpClientConfig = {
  apiKey: string;
  timeoutMilliseconds: number;
};

type PrintShrimpProduct = {
  product_id?: string;
  sku?: string;
  variants?: Array<{ size?: string }>;
};

type PrintShrimpProductResponse = {
  success?: boolean;
  product?: PrintShrimpProduct;
  error?: string;
};

type PrintShrimpClientDependencies = {
  fetch: typeof fetch;
  readFile(filePath: string): Promise<Buffer>;
  stage(filePath: string, contents: Buffer): Promise<string>;
  cleanup(filePath: string): Promise<void>;
  createStagingPath(fileName: string): string;
};

class PrintShrimpHttpError extends PrintShrimpAdapterError {
  constructor(message: string, readonly status: number, transient: boolean) {
    super(message, transient);
  }
}

const TRANSIENT_STATUS_CODES = new Set([408, 425, 429, 500, 502, 503, 504]);
const MAX_ARTWORK_BYTES = 50 * 1024 * 1024;
const PRINTSHRIMP_API_BASE_URL = 'https://api.printshrimp.com/functions/v1/';
const PRINTSHRIMP_API_KEY_HEADER = 'x-api-key';
const PRINTSHRIMP_CREATE_PRODUCT_PATH = 'api-create-product';
const PRINTSHRIMP_UPDATE_PRODUCT_PATH = 'api-update-product';
const PRINTSHRIMP_GET_PRODUCT_PATH = 'api-get-product';

export function getPrintShrimpClientConfig(): PrintShrimpClientConfig | null {
  const apiKey = process.env.PRINTSHRIMP_API_KEY?.trim();
  if (!apiKey) return null;

  const timeout = Number(process.env.PRINTSHRIMP_API_TIMEOUT_MS ?? 120_000);
  if (!Number.isFinite(timeout) || timeout < 1_000) {
    throw new PrintShrimpConfigurationError('PRINTSHRIMP_API_TIMEOUT_MS must be at least 1000 milliseconds.');
  }
  return { apiKey, timeoutMilliseconds: timeout };
}

function missingConfigurationMessage() {
  return 'Set PRINTSHRIMP_API_KEY before syncing. The application uploads temporary artwork to the configured public-read PrintShrimp S3 bucket.';
}

export function getPrintShrimpAdapterStatus() {
  try {
    const config = getPrintShrimpClientConfig();
    return config
      ? { configured: true, message: 'PrintShrimp API is configured.' }
      : { configured: false, message: missingConfigurationMessage() };
  } catch (error) {
    return {
      configured: false,
      message: error instanceof Error ? error.message : 'PrintShrimp API configuration is invalid.',
    };
  }
}

function endpointUrl(endpoint: string) {
  return new URL(endpoint.replace(/^\/+/, ''), PRINTSHRIMP_API_BASE_URL);
}

function safeRemoteMessage(value: unknown, secrets: string[] = []) {
  let message = typeof value === 'string' ? value : 'PrintShrimp rejected the request.';
  for (const secret of secrets) {
    if (secret) message = message.split(secret).join('[redacted]');
  }
  return message.replace(/https?:\/\/\S+/gi, '[remote URL]').slice(0, 800);
}

function productName(value: string) {
  const name = value.trim();
  if (!name) throw new PrintShrimpAdapterError('The listing name is required by PrintShrimp.');
  return name.slice(0, 200);
}

export function createPrintShrimpArtworkClient(
  config: PrintShrimpClientConfig,
  overrides: Partial<PrintShrimpClientDependencies> = {},
): PrintShrimpArtworkClient {
  const dependencies: PrintShrimpClientDependencies = {
    fetch,
    readFile: readLocalFile,
    stage: stagePrintShrimpArtwork,
    cleanup: removeStagedPrintShrimpArtwork,
    createStagingPath: (fileName) => `printshrimp-staging/${randomUUID()}-${fileName}`,
    ...overrides,
  };

  async function request<T>(method: string, url: URL, body?: unknown, allowNotFound = false): Promise<T | null> {
    let response: Response;
    try {
      response = await dependencies.fetch(url, {
        method,
        headers: {
          Accept: 'application/json',
          'Content-Type': 'application/json',
          [PRINTSHRIMP_API_KEY_HEADER]: config.apiKey,
        },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
        signal: AbortSignal.timeout(config.timeoutMilliseconds),
      });
    } catch (error) {
      const timedOut = error instanceof Error && (error.name === 'AbortError' || error.name === 'TimeoutError');
      throw new PrintShrimpAdapterError(
        timedOut ? 'The PrintShrimp API request timed out.' : 'The PrintShrimp API could not be reached.',
        true,
      );
    }

    const payload = await response.json().catch(() => ({})) as PrintShrimpProductResponse;
    if (allowNotFound && response.status === 404) return null;
    if (!response.ok || payload.success === false) {
      const remoteMessage = safeRemoteMessage(payload.error, [config.apiKey]);
      throw new PrintShrimpHttpError(
        `PrintShrimp API returned ${response.status}: ${remoteMessage}`,
        response.status,
        TRANSIENT_STATUS_CODES.has(response.status),
      );
    }
    return payload as T;
  }

  async function getProduct(sku: string) {
    const url = endpointUrl(PRINTSHRIMP_GET_PRODUCT_PATH);
    url.searchParams.set('sku', sku);
    const response = await request<PrintShrimpProductResponse>('GET', url, undefined, true);
    return response?.product ?? null;
  }

  async function resolveProduct(input: PrintShrimpProductSync) {
    const current = await getProduct(input.sku);
    if (current) return { mode: 'update' as const, product: current, selectedSku: input.sku };

    const previousSkus = [...new Set(input.previousSkus.map((sku) => sku.trim()))]
      .filter((sku) => sku && sku !== input.sku);
    for (const previousSku of previousSkus) {
      const previous = await getProduct(previousSku);
      if (previous) return { mode: 'rename' as const, product: previous, selectedSku: previousSku };
    }
    return { mode: 'create' as const, product: null, selectedSku: input.sku };
  }

  return {
    async syncProduct(input) {
      const resolved = await resolveProduct(input);
      const ratiosToUpdate = new Set(input.ratiosToUpdate);
      const selectedArtwork = resolved.mode === 'create'
        ? input.artwork
        : input.artwork.filter((artwork) => ratiosToUpdate.has(artwork.ratio));
      if (selectedArtwork.length === 0) {
        throw new PrintShrimpAdapterError('No changed PrintShrimp artwork was selected for synchronisation.');
      }

      const stagedPaths: string[] = [];
      try {
        const imageUrls = new Map<PrintShrimpRatio, string>();
        for (const artwork of selectedArtwork) {
          const contents = await dependencies.readFile(artwork.filePath);
          if (contents.byteLength > MAX_ARTWORK_BYTES) {
            throw new PrintShrimpAdapterError(`${artwork.fileName} exceeds PrintShrimp's 50 MB artwork limit.`);
          }
          const stagingPath = dependencies.createStagingPath(artwork.fileName);
          stagedPaths.push(stagingPath);
          const imageUrl = await dependencies.stage(stagingPath, contents);
          if (new URL(imageUrl).protocol !== 'https:') {
            throw new PrintShrimpAdapterError('The temporary PrintShrimp artwork URL must use HTTPS.');
          }
          imageUrls.set(artwork.ratio, imageUrl);
        }

        const variants = selectedArtwork.flatMap((artwork) => getPrintShrimpVariantSizes(artwork.ratio).map((size) => ({
          size,
          image_url: imageUrls.get(artwork.ratio)!,
        })));
        if (variants.length > 22) throw new PrintShrimpAdapterError('PrintShrimp accepts at most 22 variants per product request.');

        const name = productName(input.productName);
        let response: PrintShrimpProductResponse | null;
        if (resolved.mode === 'update') {
          response = await request<PrintShrimpProductResponse>('PUT', endpointUrl(PRINTSHRIMP_UPDATE_PRODUCT_PATH), {
            sku: input.sku,
            name,
            variants,
          });
        } else if (resolved.mode === 'rename') {
          response = await request<PrintShrimpProductResponse>('PUT', endpointUrl(PRINTSHRIMP_UPDATE_PRODUCT_PATH), {
            sku: resolved.selectedSku,
            name,
            new_sku: input.sku,
            variants,
          });
        } else {
          try {
            response = await request<PrintShrimpProductResponse>('POST', endpointUrl(PRINTSHRIMP_CREATE_PRODUCT_PATH), {
              name,
              sku: input.sku,
              variants,
            });
          } catch (error) {
            // A competing request may have created the same unique SKU. Confirm
            // it exists before safely switching to the documented update call.
            if (!(error instanceof PrintShrimpHttpError) || error.status !== 409 || !await getProduct(input.sku)) throw error;
            response = await request<PrintShrimpProductResponse>('PUT', endpointUrl(PRINTSHRIMP_UPDATE_PRODUCT_PATH), {
              sku: input.sku,
              name,
              variants,
            });
          }
        }

        return {
          externalItemId: response?.product?.product_id
            ?? resolved.product?.product_id
            ?? input.existingExternalItemId
            ?? null,
          synchronizedRatios: selectedArtwork.map((artwork) => artwork.ratio),
        };
      } finally {
        await Promise.all(stagedPaths.map((stagingPath) => dependencies.cleanup(stagingPath).catch(() => undefined)));
      }
    },

    async productExists(input) {
      const product = await getProduct(input.sku);
      if (!product) return false;
      if (input.externalItemId && product.product_id && product.product_id !== input.externalItemId) return false;
      if (!product.variants) return true;
      const actualSizes = new Set(product.variants.flatMap((variant) => variant.size ? [variant.size] : []));
      const expectedSizes = input.ratios.flatMap((ratio) => getPrintShrimpVariantSizes(ratio));
      return expectedSizes.every((size) => actualSizes.has(size));
    },
  };
}

export function getPrintShrimpArtworkClient(): PrintShrimpArtworkClient {
  const config = getPrintShrimpClientConfig();
  if (!config) throw new PrintShrimpConfigurationError(missingConfigurationMessage());
  return createPrintShrimpArtworkClient(config);
}
