import { createHash } from 'node:crypto';
import { getEtsyKeystring, getValidEtsyAccessToken } from '@/lib/etsy-oauth';

type EtsyCollection<T> = { results?: T[] };
type EtsyRecord = Record<string, unknown>;

export type CompareRow = { field: string; first: string; second: string; matches: boolean };

export type EtsyListingComparison = {
  firstId: string;
  secondId: string;
  setup: CompareRow[];
  properties: CompareRow[];
  images: Array<{ position: number; first: string; second: string; firstUrl: string | null; secondUrl: string | null; matches: boolean }>;
  downloads: Array<{ position: number; first: string; second: string; matches: boolean }>;
};

function apiKey() {
  const secret = process.env.ETSY_SHARED_SECRET;
  if (!secret) throw new Error('Missing ETSY_SHARED_SECRET environment variable.');
  return `${getEtsyKeystring()}:${secret}`;
}

async function fetchEtsy<T>(path: string) {
  const token = await getValidEtsyAccessToken();
  const response = await fetch(`https://openapi.etsy.com/v3/application${path}`, {
    headers: { Accept: 'application/json', Authorization: `Bearer ${token}`, 'x-api-key': apiKey() },
    signal: AbortSignal.timeout(30_000),
    cache: 'no-store',
  });
  const text = await response.text();
  if (!response.ok) throw new Error(`Etsy API returned ${response.status} ${response.statusText}${text ? `: ${text}` : ''}`);
  return (text ? JSON.parse(text) : null) as T;
}

function results<T>(payload: EtsyCollection<T> | T[]) {
  return Array.isArray(payload) ? payload : payload.results ?? [];
}

function format(value: unknown) {
  if (value === null || value === undefined || value === '') return '—';
  if (Array.isArray(value)) return value.map((item) => typeof item === 'object' ? JSON.stringify(item) : String(item)).join(', ');
  if (typeof value === 'object') return JSON.stringify(value);
  return String(value);
}

function compareRows(first: EtsyRecord, second: EtsyRecord, fields: Array<[string, string]>) {
  return fields.map(([key, label]) => {
    const firstValue = format(first[key]);
    const secondValue = format(second[key]);
    return { field: label, first: firstValue, second: secondValue, matches: firstValue === secondValue };
  });
}

async function imageHash(url: unknown) {
  if (typeof url !== 'string' || !url) return null;
  const response = await fetch(url, { signal: AbortSignal.timeout(30_000), cache: 'no-store' });
  if (!response.ok) throw new Error(`Unable to download Etsy image (${response.status}).`);
  return createHash('sha256').update(Buffer.from(await response.arrayBuffer())).digest('hex');
}

async function loadListing(listingId: string) {
  const listing = await fetchEtsy<EtsyRecord>(`/listings/${encodeURIComponent(listingId)}`);
  const shopId = format(listing.shop_id);
  if (shopId === '—') throw new Error(`Etsy listing ${listingId} does not include a shop id.`);

  const [imagesPayload, filesPayload, propertiesPayload] = await Promise.all([
    fetchEtsy<EtsyCollection<EtsyRecord> | EtsyRecord[]>(`/listings/${encodeURIComponent(listingId)}/images`),
    fetchEtsy<EtsyCollection<EtsyRecord> | EtsyRecord[]>(`/shops/${encodeURIComponent(shopId)}/listings/${encodeURIComponent(listingId)}/files`),
    fetchEtsy<EtsyCollection<EtsyRecord> | EtsyRecord[]>(`/shops/${encodeURIComponent(shopId)}/listings/${encodeURIComponent(listingId)}/properties`),
  ]);
  const images = results(imagesPayload).sort((a, b) => Number(a.rank ?? 0) - Number(b.rank ?? 0));
  const files = results(filesPayload).sort((a, b) => Number(a.rank ?? 0) - Number(b.rank ?? 0));
  const properties = results(propertiesPayload).sort((a, b) => Number(a.property_id ?? 0) - Number(b.property_id ?? 0));
  const hashes = await Promise.all(images.map((image) => imageHash(image.url_fullxfull)));

  return { listing, images, files, properties, hashes };
}

export async function compareEtsyListings(firstId: string, secondId: string): Promise<EtsyListingComparison> {
  const [first, second] = await Promise.all([loadListing(firstId), loadListing(secondId)]);
  const setup = compareRows(first.listing, second.listing, [
    ['title', 'Title'], ['description', 'Description'], ['state', 'State'], ['quantity', 'Quantity'],
    ['price', 'Price'], ['taxonomy_id', 'Taxonomy ID'], ['shop_section_id', 'Shop section ID'],
    ['listing_type', 'Listing type'], ['who_made', 'Who made it'], ['when_made', 'When made'],
    ['is_supply', 'Is supply'], ['should_auto_renew', 'Auto renew'], ['is_personalizable', 'Personalizable'],
    ['language', 'Language'], ['tags', 'Tags'], ['materials', 'Materials'],
  ]);

  const propertyIds = [...new Set([...first.properties, ...second.properties].map((property) => String(property.property_id)))];
  const properties = propertyIds.map((id) => {
    const firstProperty = first.properties.find((property) => String(property.property_id) === id);
    const secondProperty = second.properties.find((property) => String(property.property_id) === id);
    const firstValue = format(firstProperty?.values);
    const secondValue = format(secondProperty?.values);
    return {
      field: `${format(firstProperty?.property_name ?? secondProperty?.property_name)} (${id})`,
      first: firstValue,
      second: secondValue,
      matches: firstValue === secondValue,
    };
  });

  const imageCount = Math.max(first.images.length, second.images.length);
  const images = Array.from({ length: imageCount }, (_, index) => {
    const firstImage = first.images[index];
    const secondImage = second.images[index];
    const firstHash = first.hashes[index] ?? null;
    const secondHash = second.hashes[index] ?? null;
    return {
      position: index + 1,
      first: firstImage ? `${format(firstImage.full_width)}×${format(firstImage.full_height)} · ${firstHash?.slice(0, 12) ?? 'no hash'}` : '—',
      second: secondImage ? `${format(secondImage.full_width)}×${format(secondImage.full_height)} · ${secondHash?.slice(0, 12) ?? 'no hash'}` : '—',
      firstUrl: typeof firstImage?.url_170x135 === 'string' ? firstImage.url_170x135 : null,
      secondUrl: typeof secondImage?.url_170x135 === 'string' ? secondImage.url_170x135 : null,
      matches: firstHash !== null && firstHash === secondHash,
    };
  });

  const fileCount = Math.max(first.files.length, second.files.length);
  const downloads = Array.from({ length: fileCount }, (_, index) => {
    const firstFile = first.files[index];
    const secondFile = second.files[index];
    const firstValue = firstFile ? `${format(firstFile.filename)} · ${format(firstFile.size_bytes)} bytes` : '—';
    const secondValue = secondFile ? `${format(secondFile.filename)} · ${format(secondFile.size_bytes)} bytes` : '—';
    return { position: index + 1, first: firstValue, second: secondValue, matches: firstValue === secondValue };
  });

  return { firstId, secondId, setup, properties, images, downloads };
}
