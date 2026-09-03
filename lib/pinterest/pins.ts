import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { prisma } from '@/lib/prisma';
import { getListingDirectoryPath } from '@/lib/local-shop-directory';
import { pinterestRequest } from './client';
import type { PinterestPinApi } from './types';

export async function imageMediaSource(listingId: number, imageId: number | null) {
  const listing = await prisma.etsyListing.findUnique({ where: { id: listingId }, include: { images: { orderBy: [{ rank: 'asc' }, { id: 'asc' }] }, subSection: { include: { shopSection: { include: { shop: true } } } } } });
  if (!listing) throw new Error('Listing was not found.');
  const image = imageId ? listing.images.find((item) => item.id === imageId) : listing.images[0];
  if (!image) throw new Error('The listing has no image.');
  if (image.urlFullxFull) return { source_type: 'image_url', url: image.urlFullxFull };
  if (!image.localFileName || !listing.subSection?.shopSection.shop) throw new Error('The selected image is not available locally.');
  const shop = listing.subSection.shopSection.shop;
  const filePath = path.join(getListingDirectoryPath(shop.shopName ?? String(shop.etsyShopId), listing.subSection.shopSection.title, listing.subSection.name, listing.localDirectoryName ?? `Listing-${listing.id}`), image.localFileName);
  const extension = path.extname(filePath).toLowerCase(); const mime = extension === '.png' ? 'image/png' : extension === '.webp' ? 'image/webp' : 'image/jpeg';
  return { source_type: 'image_base64', content_type: mime, data: (await readFile(filePath)).toString('base64') };
}
export async function publishPin(pinId: number) {
  const pin = await prisma.pinterestPin.findUnique({ where: { id: pinId }, include: { board: true, listing: true } });
  if (!pin) throw new Error('Pin was not found.');
  if (pin.pinterestPinId) return pin;
  if (!pin.destinationUrl || !/^https:\/\/(?:www\.)?etsy\.com\//i.test(pin.destinationUrl)) throw new Error('A real Etsy listing URL is required before publishing.');
  await prisma.pinterestPin.update({ where: { id: pin.id }, data: { status: 'PUBLISHING', error: null } });
  try {
    const created = await pinterestRequest<PinterestPinApi>('/pins', { method: 'POST', body: JSON.stringify({ board_id: pin.board.pinterestBoardId, title: pin.title, description: pin.description, link: pin.destinationUrl, media_source: await imageMediaSource(pin.listingId, pin.imageId) }) });
    return prisma.pinterestPin.update({ where: { id: pin.id }, data: { pinterestPinId: created.id, status: 'PUBLISHED', publishedAt: new Date(), error: null } });
  } catch (error) { await prisma.pinterestPin.update({ where: { id: pin.id }, data: { status: 'FAILED', retryCount: { increment: 1 }, error: error instanceof Error ? error.message : 'Publish failed.' } }); throw error; }
}

export async function deletePin(pinId: number) {
  const pin = await prisma.pinterestPin.findUnique({ where: { id: pinId } });
  if (!pin) throw new Error('Pin was not found.');
  if (pin.pinterestPinId) {
    await pinterestRequest<void>(`/pins/${encodeURIComponent(pin.pinterestPinId)}`, { method: 'DELETE' });
  }
  await prisma.pinterestPin.delete({ where: { id: pin.id } });
  return { deleted: true };
}

export async function processDuePins(limit = 20) {
  const pins = await prisma.pinterestPin.findMany({ where: { status: 'SCHEDULED', scheduledAt: { lte: new Date() } }, orderBy: { scheduledAt: 'asc' }, take: limit });
  const results = []; for (const pin of pins) { try { await publishPin(pin.id); results.push({ id: pin.id, ok: true }); } catch (error) { results.push({ id: pin.id, ok: false, error: error instanceof Error ? error.message : 'Failed' }); } } return results;
}
