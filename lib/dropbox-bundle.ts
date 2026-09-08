import { randomUUID } from 'node:crypto';
import path from 'node:path';
import { ZipArchive } from 'archiver';
import PDFDocument from 'pdfkit';
import { getListingDirectoryPath } from '@/lib/local-shop-directory';
import { prisma } from '@/lib/prisma';
import { mkdir, readFile, rename, stat, unlink, writeFile } from '@/lib/s3-listing-storage';

type ListingContext = { shopId: string; sectionId: string; subSectionId: string; listingId: string };

let cachedDropboxToken: { value: string; expiresAt: number } | null = null;

async function getDropboxAccessToken() {
  const appKey = process.env.DROPBOX_APP_KEY;
  const appSecret = process.env.DROPBOX_APP_SECRET;
  const refreshToken = process.env.DROPBOX_REFRESH_TOKEN;
  const refreshSettings = [appKey, appSecret, refreshToken];

  if (refreshSettings.some(Boolean) && !refreshSettings.every(Boolean)) {
    throw new Error('Set DROPBOX_APP_KEY, DROPBOX_APP_SECRET, and DROPBOX_REFRESH_TOKEN together.');
  }

  if (appKey && appSecret && refreshToken) {
    if (cachedDropboxToken && cachedDropboxToken.expiresAt > Date.now() + 60_000) {
      return cachedDropboxToken.value;
    }
    const response = await fetch('https://api.dropboxapi.com/oauth2/token', {
      method: 'POST',
      headers: {
        Authorization: `Basic ${Buffer.from(`${appKey}:${appSecret}`).toString('base64')}`,
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: new URLSearchParams({ grant_type: 'refresh_token', refresh_token: refreshToken }),
    });
    const payload = await response.json() as { access_token?: string; expires_in?: number; error_description?: string; error?: string };
    if (!response.ok || !payload.access_token) {
      throw new Error(`Unable to refresh the Dropbox access token: ${payload.error_description ?? payload.error ?? response.statusText}`);
    }
    cachedDropboxToken = {
      value: payload.access_token,
      expiresAt: Date.now() + (payload.expires_in ?? 14_400) * 1000,
    };
    return cachedDropboxToken.value;
  }

  const accessToken = process.env.DROPBOX_ACCESS_TOKEN;
  if (!accessToken) {
    throw new Error('Set Dropbox refresh-token credentials or DROPBOX_ACCESS_TOKEN before creating the Dropbox bundle.');
  }
  return accessToken;
}

async function loadBundleListing(context: ListingContext) {
  const listing = await prisma.etsyListing.findFirst({
    where: { id: Number(context.listingId), subSectionId: Number(context.subSectionId) },
    include: {
      dropboxFiles: { orderBy: [{ groupNumber: 'asc' }, { id: 'asc' }] },
      dropboxBundle: true,
      files: true,
      subSection: { include: { shopSection: { include: { shop: true } } } },
    },
  });
  const section = listing?.subSection?.shopSection;
  const shop = section?.shop;
  if (!listing || !listing.subSection || !section || !shop || section.id !== Number(context.sectionId)
    || shop.etsyShopId.toString() !== context.shopId) throw new Error('Listing context not found.');
  const shopName = shop.shopName ?? shop.title ?? `Shop ${shop.etsyShopId}`;
  return {
    listing,
    listingPath: getListingDirectoryPath(shopName, section.title, listing.subSection.name, listing.localDirectoryName ?? `Listing-${listing.id}`),
  };
}

function safeName(value: string) {
  return value.replace(/[^a-zA-Z0-9._-]+/g, '-').replace(/^-+|-+$/g, '') || 'listing';
}

async function writeZip(targetPath: string, files: Array<{ path: string; name: string }>) {
  const archive = new ZipArchive({ zlib: { level: 9 } });
  const chunks: Buffer[] = [];
  const completed = new Promise<void>((resolve, reject) => {
    archive.on('data', (chunk: Buffer) => chunks.push(chunk));
    archive.on('end', resolve);
    archive.on('error', reject);
  });
  for (const file of files) archive.append(await readFile(file.path), { name: file.name });
  await archive.finalize();
  await completed;
  await writeFile(targetPath, Buffer.concat(chunks));
}

export async function createDropboxZips(context: ListingContext) {
  const { listing, listingPath } = await loadBundleListing(context);
  if (listing.dropboxFiles.length === 0) throw new Error('No Dropbox downloads were found.');
  const sourceDirectory = path.join(listingPath, 'dropboxDownloads');
  const targetDirectory = path.join(listingPath, 'dropboxZipped');
  await mkdir(targetDirectory, { recursive: true });
  const groups = [...new Set(listing.dropboxFiles.map((file) => file.groupNumber))].sort((a, b) => a - b);
  const zips = [];
  for (const groupNumber of groups) {
    const files = listing.dropboxFiles.filter((file) => file.groupNumber === groupNumber);
    const sourceName = files[0].sourceDirectoryName;
    const fileName = `${String(groupNumber).padStart(2, '0')}-${safeName(sourceName)}.zip`;
    const targetPath = path.join(targetDirectory, fileName);
    const temporaryPath = `${targetPath}.${randomUUID()}.tmp`;
    await writeZip(temporaryPath, files.map((file) => ({
      path: path.join(sourceDirectory, file.localFileName),
      name: file.originalFileName ?? file.localFileName,
    })));
    try { await unlink(targetPath); } catch (error) {
      if (!(error instanceof Error && 'code' in error && error.code === 'ENOENT')) throw error;
    }
    await rename(temporaryPath, targetPath);
    zips.push({ groupNumber, sourceDirectoryName: sourceName, fileName, sizeBytes: (await stat(targetPath)).size });
  }
  return { zips };
}

async function dropboxRpc(endpoint: string, token: string, body: unknown) {
  const response = await fetch(`https://api.dropboxapi.com/2/${endpoint}`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const payload = await response.json() as Record<string, unknown>;
  if (!response.ok) throw new Error(`Dropbox ${endpoint} failed: ${JSON.stringify(payload)}`);
  return payload;
}

export async function deleteDropboxBundleFolder(folderPath: string) {
  if (!folderPath.startsWith('/') || folderPath === '/') {
    throw new Error('Refusing to delete an invalid Dropbox bundle path.');
  }
  const token = await getDropboxAccessToken();
  const response = await fetch('https://api.dropboxapi.com/2/files/delete_v2', {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ path: folderPath }),
  });
  const payload = await response.json() as { error_summary?: string };
  if (response.ok || payload.error_summary?.includes('not_found')) return;
  throw new Error(`Unable to delete the Dropbox folder: ${payload.error_summary ?? response.statusText}`);
}

async function uploadDropboxFile(token: string, dropboxPath: string, contents: Buffer) {
  const response = await fetch('https://content.dropboxapi.com/2/files/upload', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/octet-stream',
      'Dropbox-API-Arg': JSON.stringify({ path: dropboxPath, mode: 'overwrite', autorename: false, mute: true }),
    },
    body: new Uint8Array(contents),
  });
  if (!response.ok) throw new Error(`Dropbox upload failed: ${await response.text()}`);
}

export async function createOrUpdateDropbox(context: ListingContext) {
  const token = await getDropboxAccessToken();
  const { listing, listingPath } = await loadBundleListing(context);
  const zippedDirectory = path.join(listingPath, 'dropboxZipped');
  const zipResult = await createDropboxZips(context);
  const folderPath = listing.dropboxBundle?.folderPath
    ?? `/${safeName(listing.localDirectoryName ?? listing.title)}-${randomUUID()}`;
  if (!listing.dropboxBundle) {
    await dropboxRpc('files/create_folder_v2', token, { path: folderPath, autorename: false });
  }
  for (const zip of zipResult.zips) {
    await uploadDropboxFile(token, `${folderPath}/${zip.fileName}`, await readFile(path.join(zippedDirectory, zip.fileName)));
  }
  try {
    const printGuide = await readFile(path.join(listingPath, 'dropboxDownloads', 'HowToPrintGuide.txt'));
    await uploadDropboxFile(token, `${folderPath}/HowToPrintGuide.txt`, printGuide);
  } catch (error) {
    if (!(error instanceof Error && 'code' in error && error.code === 'ENOENT')) throw error;
  }
  let sharedUrl = listing.dropboxBundle?.sharedUrl ?? null;
  if (!sharedUrl) {
    try {
      const shared = await dropboxRpc('sharing/create_shared_link_with_settings', token, {
        path: folderPath,
        settings: { requested_visibility: 'public', access: 'viewer' },
      });
      sharedUrl = typeof shared.url === 'string' ? shared.url : null;
    } catch (error) {
      const links = await dropboxRpc('sharing/list_shared_links', token, { path: folderPath, direct_only: true });
      const first = Array.isArray(links.links) ? links.links[0] as Record<string, unknown> | undefined : undefined;
      sharedUrl = typeof first?.url === 'string' ? first.url : null;
      if (!sharedUrl) throw error;
    }
  }
  if (!sharedUrl) throw new Error('Dropbox did not return a shared link.');
  const instructions = `Thank you for your purchase.\n\nDownload your files here:\n${sharedUrl}\n`;
  await writeFile(path.join(listingPath, 'download-instructions.txt'), instructions, 'utf8');
  await uploadDropboxFile(token, `${folderPath}/download-instructions.txt`, Buffer.from(instructions, 'utf8'));
  const bundle = await prisma.etsyListingDropboxBundle.upsert({
    where: { listingId: listing.id },
    create: { listingId: listing.id, folderPath, sharedUrl, instructions },
    update: { folderPath, sharedUrl, instructions },
  });
  return { folderPath: bundle.folderPath, sharedUrl: bundle.sharedUrl };
}

async function createLinkedPdf(title: string, url: string) {
  return new Promise<Buffer>((resolve, reject) => {
    const chunks: Buffer[] = [];
    const document = new PDFDocument({ size: 'A4', margin: 64 });
    const pageWidth = document.page.width;
    const sage = '#68755A';
    const darkSage = '#536149';
    const terracotta = '#C9764E';
    const cream = '#FCF8F1';
    const border = '#D8C8B4';
    const text = '#3E3935';
    const muted = '#6B645E';
    const headerPath = path.join(process.cwd(), 'public', 'pdf-assets', 'cosyhouseprints-header.png');

    document.on('data', (chunk: Buffer) => chunks.push(chunk));
    document.on('end', () => resolve(Buffer.concat(chunks)));
    document.on('error', reject);

    document.rect(0, 0, document.page.width, document.page.height).fill(cream);
    document.image(headerPath, 20, 18, { width: pageWidth - 40, height: 158 });
    document.fillColor(darkSage).font('Times-Roman').fontSize(30)
      .text('CosyHousePrints', 120, 48, { width: pageWidth - 240, align: 'center' });
    document.fillColor(terracotta).font('Times-Roman').fontSize(12)
      .text('~  *  ~', 180, 86, { width: pageWidth - 360, align: 'center' });
    document.fillColor(muted).font('Helvetica').fontSize(11)
      .text('Printable Wall Art for Cosy Homes', 150, 106, { width: pageWidth - 300, align: 'center' });

    let titleSize = 30;
    document.font('Times-Roman');
    document.fontSize(titleSize);
    while (titleSize > 18 && document.widthOfString(title) > pageWidth - 120) {
      titleSize -= 1;
      document.fontSize(titleSize);
    }
    document.fillColor(darkSage).fontSize(titleSize)
      .text(title, 55, 190, { width: pageWidth - 110, align: 'center', height: 42, ellipsis: true });
    document.fillColor(terracotta).fontSize(12)
      .text('~  *  ~', 180, 230, { width: pageWidth - 360, align: 'center' });
    document.font('Times-Roman').fontSize(14)
      .text('Thank you for purchasing from CosyHousePrints', 55, 254, { width: pageWidth - 110, align: 'center' });
    document.fillColor(text).font('Helvetica').fontSize(10)
      .text('Your digital files are available using the secure Dropbox link below.', 55, 279, { width: pageWidth - 110, align: 'center' });

    const buttonX = 145;
    const buttonY = 305;
    const buttonWidth = pageWidth - 290;
    document.roundedRect(buttonX, buttonY, buttonWidth, 45, 8).fill(sage);
    document.fillColor('#FFFFFF').font('Helvetica-Bold').fontSize(15)
      .text('DOWNLOAD YOUR FILES', buttonX, buttonY + 14, { width: buttonWidth, align: 'center' });
    document.link(buttonX, buttonY, buttonWidth, 45, url);

    document.roundedRect(80, 370, pageWidth - 160, 67, 7).lineWidth(1).strokeColor(border).stroke();
    document.circle(111, 403, 20).fillAndStroke('#F1EDE3', border);
    document.fillColor(sage).font('Helvetica-Bold').fontSize(13).text('>>', 99, 395, { width: 24, align: 'center' });
    document.fillColor(text).font('Helvetica-Bold').fontSize(9)
      .text('Button not working? Copy and paste this link into your browser:', 140, 382, { width: pageWidth - 240 });
    document.fillColor(muted).font('Helvetica').fontSize(8)
      .text(url, 140, 399, { width: pageWidth - 240, height: 30, link: url, underline: false });

    const columnY = 470;
    const columnWidth = 145;
    const columns = [
      {
        x: 52,
        heading: 'How to download',
        body: '1. Click the download button above.\n\n2. You will be taken to Dropbox.\n\n3. Use the download icon to save your files.',
      },
      {
        x: 225,
        heading: 'Your purchase includes',
        body: '- High-resolution JPEG files\n\n- Multiple print ratios and sizes\n\n- Ready for high-quality printing\n\n- Personal-use licence',
      },
      {
        x: 398,
        heading: 'Printing recommendation',
        body: 'For best results, print on matte photo paper or heavyweight cardstock using a high-quality printer.\n\nThis will bring out the colours and fine details beautifully.',
      },
    ];
    document.moveTo(210, columnY).lineTo(210, 650).strokeColor(border).stroke();
    document.moveTo(383, columnY).lineTo(383, 650).strokeColor(border).stroke();
    for (const column of columns) {
      document.circle(column.x + columnWidth / 2, columnY + 18, 17).fill('#F1EDE3');
      document.fillColor(sage).font('Times-Roman').fontSize(12)
        .text(column.heading, column.x, columnY + 45, { width: columnWidth, align: 'center' });
      document.fillColor(text).font('Helvetica').fontSize(8.5)
        .text(column.body, column.x + 5, columnY + 70, { width: columnWidth - 10, lineGap: 1.5 });
    }

    document.roundedRect(62, 685, pageWidth - 124, 68, 7).fillAndStroke('#F8F4EA', border);
    document.circle(101, 719, 22).fill('#E8E7DA');
    document.fillColor(sage).font('Helvetica').fontSize(18).text('@', 89, 708, { width: 24, align: 'center' });
    document.fillColor(darkSage).font('Times-Roman').fontSize(14).text('Need help?', 140, 699);
    document.fillColor(text).font('Helvetica').fontSize(9)
      .text('Please contact CosyHousePrints through Etsy messages and include your order number.', 140, 721, { width: pageWidth - 240 });

    document.moveTo(80, 785).lineTo(pageWidth - 80, 785).strokeColor(border).stroke();
    document.fillColor(muted).font('Helvetica').fontSize(8)
      .text('Digital product only   |   No physical item will be shipped   |   Personal use only', 55, 801, { width: pageWidth - 110, align: 'center' });
    document.end();
  });
}

export async function createDropboxInstructionPdf(context: ListingContext) {
  const { listing, listingPath } = await loadBundleListing(context);
  const sharedUrl = listing.dropboxBundle?.sharedUrl;
  if (!sharedUrl) throw new Error('Create the Dropbox bundle before creating the PDF.');
  const downloadsDirectory = path.join(listingPath, 'downloads');
  await mkdir(downloadsDirectory, { recursive: true });
  const fileName = 'CosyHousePrints_Download_Instructions.pdf';
  const pdf = await createLinkedPdf(listing.title, sharedUrl);
  try {
    await unlink(path.join(downloadsDirectory, 'zip_1.pdf'));
  } catch (error) {
    if (!(error instanceof Error && 'code' in error && error.code === 'ENOENT')) throw error;
  }
  await writeFile(path.join(downloadsDirectory, fileName), pdf);
  await prisma.$transaction(async (tx) => {
    await tx.etsyListingFile.deleteMany({ where: { listingId: listing.id } });
    await tx.etsyListingFile.create({
      data: {
        listingId: listing.id,
        localFileName: fileName,
        originalFileName: fileName,
        filename: fileName,
        filetype: 'application/pdf',
        filesize: `${(pdf.length / (1024 * 1024)).toFixed(2)} MB`,
        sizeBytes: pdf.length,
        rank: 1,
        rawJson: { dropboxSharedUrl: sharedUrl },
      },
    });
    await tx.etsyListing.update({
      where: { id: listing.id },
      data: { downloadsChanged: true, lastLocalChangeAt: new Date() },
    });
  });
  return { fileName, sizeBytes: pdf.length };
}
