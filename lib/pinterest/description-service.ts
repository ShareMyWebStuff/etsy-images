import type { Prisma } from '@prisma/client';
import { prisma } from '@/lib/prisma';
import type { PinterestDescriptionContext } from './bedrock-copy';

const listingSelect = {
  id: true, title: true, digitalTitle: true, listingItem: true, localDirectoryName: true,
  listingDescription: true, url: true, etsyDownloadUrl: true, etsyCustomisedUrl: true,
  etsyId: true, etsyDownloadId: true, etsyCustomisedId: true, etsyProductType: true,
  rawJson: true, etsyDownloadRawJson: true, etsyCustomisedRawJson: true,
  priceMappings: { select: { fulfilmentProvider: true, productKey: true } },
  products: { select: { productType: true } },
  productConfig: { select: { digitalDownload: true, printsFrames: true } },
} satisfies Prisma.EtsyListingSelect;

type DescriptionListing = Prisma.EtsyListingGetPayload<{ select: typeof listingSelect }>;
type Variant = 'print' | 'customised' | 'download';

function snapshot(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function etsyListingId(value: string | null): string | undefined {
  if (!value) return undefined;
  try {
    const url = new URL(value);
    if (url.protocol !== 'https:' || !['etsy.com', 'www.etsy.com'].includes(url.hostname.toLowerCase())) return undefined;
    return url.pathname.match(/^\/(?:[a-z]{2}(?:-[a-z]{2})?\/)?listing\/(\d+)(?:\/|$)/i)?.[1];
  } catch { return undefined; }
}

/** Resolve the actual destination, rather than inferring the offer from a title or template. */
export function buildPinterestDescriptionSource(
  listing: DescriptionListing, boardName: string, destinationUrl?: string | null, creativeType = 'STANDARD', allowUnsyncedDraft = false,
) {
  const variants: { variant: Variant; id: string | null; raw: unknown }[] = [
    { variant: 'print', id: listing.etsyId, raw: listing.rawJson },
    { variant: 'customised', id: listing.etsyCustomisedId, raw: listing.etsyCustomisedRawJson },
    { variant: 'download', id: listing.etsyDownloadId, raw: listing.etsyDownloadRawJson },
  ];
  const resolveDestination = (url: string) => {
    const destinationId = etsyListingId(url);
    if (!destinationId) throw new Error('A real Etsy listing URL is required to generate a Pinterest description. Sync the listing to Etsy first.');
    const matches = variants.filter(({ id }) => id === destinationId);
    if (matches.length !== 1) throw new Error('The Pin destination does not identify one of this artwork’s Etsy listings. Review its Etsy link before generating a description.');
    return matches[0];
  };
  const configuredUrls = [listing.url, listing.etsyDownloadUrl, listing.etsyCustomisedUrl]
    .filter((url): url is string => url !== null && url !== undefined);
  // A valid fallback must not hide an invalid or unrelated configured Etsy link.
  configuredUrls.forEach(resolveDestination);
  const resolvedUrl = destinationUrl === undefined ? configuredUrls[0] ?? null : destinationUrl;
  if (resolvedUrl === null && !allowUnsyncedDraft) {
    throw new Error('A real Etsy listing URL is required to generate a Pinterest description. Sync the listing to Etsy first.');
  }
  const selected = resolvedUrl === null ? null : resolveDestination(resolvedUrl);
  const raw = snapshot(selected?.raw);
  const remoteType = raw.listing_type ?? raw.type;
  let destinationType: 'digital' | 'physical';
  if (selected) {
    destinationType = selected.variant === 'download' || remoteType === 'download' || remoteType === 'digital' ? 'digital' : 'physical';
  } else {
    const productTypes = new Set(listing.products.map(({ productType }) => productType));
    const localDigital = productTypes.has('digital');
    const localPhysical = productTypes.has('physical');
    if (localDigital !== localPhysical) destinationType = localDigital ? 'digital' : 'physical';
    else if (productTypes.size === 0 && listing.productConfig
      && listing.productConfig.digitalDownload !== listing.productConfig.printsFrames) {
      destinationType = listing.productConfig.digitalDownload ? 'digital' : 'physical';
    } else destinationType = listing.etsyProductType === 'digital' ? 'digital' : 'physical';
  }
  if (selected?.variant === 'download' && remoteType === 'physical') throw new Error('The Etsy download destination has conflicting product information. Resync it before generating a description.');
  const listingTitle = typeof raw.title === 'string' && raw.title.trim()
    ? raw.title.trim() : (destinationType === 'digital' ? listing.digitalTitle?.trim() : undefined) || listing.title;
  const subject = listing.listingItem?.trim() || listing.localDirectoryName?.replace(/([a-z])([A-Z])/g, '$1 $2').trim() || listingTitle.split('|')[0].trim();
  const mappings = selected && destinationType === 'physical' ? listing.priceMappings.filter(({ fulfilmentProvider }) => fulfilmentProvider === `Etsy inventory:${selected.variant}`) : [];
  const context: PinterestDescriptionContext = {
    subject, boardName, destinationType, listingTitle, creativeType,
    productDescription: listing.listingDescription?.trim() || '',
    physicalOptions: {
      framed: mappings.some(({ productKey }) => productKey.startsWith('framed_')),
      unframed: mappings.some(({ productKey }) => productKey.startsWith('unframed_')),
    },
  };
  return { context, destinationUrl: resolvedUrl, title: listingTitle.replace(/\s+/g, ' ').trim().slice(0, 100) };
}

export async function loadPinterestDescriptionSource(listingId: number, boardId: number, destinationUrl?: string | null, creativeType?: string, allowUnsyncedDraft = false) {
  const [listing, board] = await Promise.all([
    prisma.etsyListing.findUnique({ where: { id: listingId }, select: listingSelect }),
    prisma.pinterestBoard.findUnique({ where: { id: boardId }, select: { name: true } }),
  ]);
  if (!listing) throw new Error('Listing not found.');
  if (!board) throw new Error('Pinterest board not found.');
  return buildPinterestDescriptionSource(listing, board.name, destinationUrl, creativeType, allowUnsyncedDraft);
}

export const EDITABLE_PIN_DESCRIPTION_STATUSES = ['DRAFT', 'PAUSED', 'FAILED'];
export function canEditPinDescription(pin: { status: string; pinterestPinId: string | null }) {
  return !pin.pinterestPinId && EDITABLE_PIN_DESCRIPTION_STATUSES.includes(pin.status);
}
