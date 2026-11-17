// Builds 2:3 layouts from unchanged artwork/product sources. Does not change Etsy images or publish Pins.
const fs = require('node:fs/promises');
const path = require('node:path');
const { createHash } = require('node:crypto');
const sharp = require('sharp');
const fontkit = require('fontkit');
const { PrismaClient } = require('@prisma/client');
const { S3Client, GetObjectCommand } = require('@aws-sdk/client-s3');
const { NodeHttpHandler } = require('@smithy/node-http-handler');

const directory = path.resolve('output/pinterest/2026-11-launch');
const sha = value => createHash('sha256').update(value).digest('hex');
const json = value => JSON.stringify(value, null, 2);
const esc = value => String(value).replaceAll('&', '&amp;').replaceAll('"', '&quot;').replaceAll('<', '&lt;').replaceAll('>', '&gt;');
const fonts = {
  display: fontkit.openSync(path.resolve('public/fonts/playfairdisplay/PlayfairDisplay-Regular.ttf')),
  body: fontkit.openSync(path.resolve('public/fonts/quicksand/Quicksand-Regular.ttf')),
};
if (fonts.body.variationAxes?.wght) fonts.body = fonts.body.getVariation({ wght: 600 });
const width = (text, font, size) => font.layout(text).positions.reduce((total, item) => total + item.xAdvance, 0) * size / font.unitsPerEm;

function type(text, x, y, size, font, fill, centered = false) {
  const run = font.layout(text); const scale = size / font.unitsPerEm;
  let cursor = centered ? -width(text, font, size) / 2 : 0;
  return run.glyphs.map((glyph, index) => {
    const position = run.positions[index];
    const element = `<path d="${glyph.path.toSVG()}" fill="${fill}" transform="translate(${x + cursor + position.xOffset * scale} ${y - position.yOffset * scale}) scale(${scale} ${-scale})"/>`;
    cursor += position.xAdvance * scale; return element;
  }).join('');
}

function heading(text, colour) {
  for (let size = 62; size >= 24; size -= 2) {
    const lines = [''];
    for (const word of text.split(/\s+/)) {
      const index = lines.length - 1;
      const combined = lines[index] ? `${lines[index]} ${word}` : word;
      if (width(combined, fonts.display, size) <= 872) lines[index] = combined; else lines.push(word);
    }
    if (lines.length <= 2 && lines.every(line => width(line, fonts.display, size) <= 872)) return lines.map((line, index) => type(line, 64, 250 + index * (size + 10), size, fonts.display, colour)).join('');
  }
  throw new Error(`The artwork heading does not fit: ${text}`);
}

function poster(pin, bytes) {
  const digital = pin.destinationVariant === 'digital';
  const colour = digital ? { bg: '#EAF0E9', ink: '#304B3F', accent: '#526A56' } : { bg: '#F5EDE2', ink: '#45382F', accent: '#976345' };
  const theme = { bugs: 'BUGS & INSECT WALL ART', dinosaurs: 'DINOSAUR WALL ART', safari: 'SAFARI ANIMAL WALL ART', woodland: 'WOODLAND WALL ART', farm: 'FARM ANIMAL WALL ART', sea: 'SEA CREATURE WALL ART', scarecrows: 'SCARECROW & AUTUMN WALL ART' }[pin.boardKey];
  const format = digital ? 'DIGITAL DOWNLOAD' : 'PHYSICAL ART PRINT';
  let svg = `<svg xmlns="http://www.w3.org/2000/svg" width="1000" height="1500" viewBox="0 0 1000 1500"><title>${esc(pin.title)}</title><rect width="1000" height="1500" fill="${colour.bg}"/>`;
  svg += type('CosyHousePrints', 64, 74, 27, fonts.body, colour.ink);
  svg += `<line x1="64" y1="108" x2="936" y2="108" stroke="${colour.accent}" stroke-opacity=".35"/>`;
  svg += type(theme, 64, 161, 22, fonts.body, colour.accent);
  svg += heading(pin.context.subject, colour.ink);
  const imageY = digital ? 350 : 365;
  const imageHeight = digital ? 870 : 850;
  svg += `<rect x="63" y="${imageY - 1}" width="874" height="${imageHeight + 2}" fill="#FFFFFF"/><image x="64" y="${imageY}" width="872" height="${imageHeight}" preserveAspectRatio="xMidYMid meet" href="data:image/png;base64,${bytes.toString('base64')}"/>`;
  svg += `<rect x="180" y="1270" width="640" height="62" rx="31" fill="${colour.accent}"/>`;
  svg += type(format, 500, 1310, 27, fonts.body, '#FFFFFF', true);
  const caption = digital ? 'No physical print or frame included' : pin.context.physicalOptions.framed && pin.context.physicalOptions.unframed ? 'Framed and unframed options on Etsy' : 'Explore this physical print on Etsy';
  svg += type(caption, 500, 1390, 26, fonts.body, colour.ink, true);
  svg += type(digital ? 'Explore the digital artwork on Etsy' : 'Discover the artwork on Etsy', 500, 1450, 24, fonts.body, colour.accent, true);
  return `${svg}</svg>`;
}

async function main() {
  const plan = JSON.parse(await fs.readFile(path.join(directory, 'plan.json'), 'utf8'));
  const prisma = new PrismaClient();
  if (!process.env.AWS_PROFILE && !process.env.AWS_ACCESS_KEY_ID) process.env.AWS_PROFILE = 'etsy-listings-app';
  const s3 = new S3Client({ region: process.env.AWS_REGION || 'eu-west-2', maxAttempts: 3,
    requestHandler: new NodeHttpHandler({ connectionTimeout: 5000, requestTimeout: 30000, socketTimeout: 30000, throwOnRequestTimeout: true }) });
  const bucket = process.env.ETSY_LISTINGS_S3_BUCKET || 'etsy-listings-216211142709-eu-west-2';
  await fs.mkdir(path.join(directory, 'sources'), { recursive: true });
  await fs.mkdir(path.join(directory, 'images'), { recursive: true });
  try {
    const rows = await prisma.etsyListing.findMany({ where: { id: { in: [...new Set(plan.pins.map(pin => pin.listingId))] } }, include: { images: true, subSection: { include: { shopSection: { include: { shop: true } } } } } });
    const existing = await fs.readFile(path.join(directory, 'creative-manifest.json'), 'utf8').then(JSON.parse).catch(() => ({ pins: [] }));
    const completed = new Map(existing.pins.map(pin => [pin.key, pin]));
    const candidates = plan.pins.filter(pin => pin.needsCreative);
    let cursor = 0; let count = 0;
    const failures = [];
    await Promise.all(Array.from({ length: 4 }, async () => {
      for (;;) {
        const index = cursor++; if (index >= candidates.length) break;
        const pin = candidates[index];
        try {
          const listing = rows.find(row => row.id === pin.listingId);
          const section = listing.subSection?.shopSection;
          const image = listing.images.find(image => image.id === pin.imageId);
          if (!section?.shop?.shopName || !listing.localDirectoryName || !image) throw new Error('The owned artwork source is missing.');
          const digital = pin.destinationVariant === 'digital';
          const sourceKey = !digital && !image.localFileName ? image.urlFullxFull : [section.shop.shopName, section.title, listing.localDirectoryName, ...(digital ? ['thumbnail', listing.thumbnailFileName] : [image.localFileName])].join('/');
          if (!sourceKey) throw new Error('The artwork source is missing.');
          if (!sourceKey.startsWith('https://') && sourceKey.split('/').some(part => !part || part === '..' || part === '.')) throw new Error('The artwork source path is invalid.');
          const sourceIdentity = { sourceKey, sourceImageUpdatedAt: image.updatedAt.toISOString(), thumbnailUpdatedAt: digital ? listing.thumbnailUpdatedAt?.toISOString() ?? null : null };
          const sourceIdentityHash = sha(json(sourceIdentity));
          const inputHash = sha(json({ layoutVersion: 2, listingId: pin.listingId, imageId: pin.imageId, title: pin.title, context: pin.context, boardKey: pin.boardKey, destinationVariant: pin.destinationVariant, sourceIdentity }));
          const saved = completed.get(pin.key);
          if (saved?.inputHash === inputHash && sha(await fs.readFile(path.join(directory, saved.imageFile))) === saved.sha256) { count++; continue; }
          const sourceFile = path.join('sources', `${pin.key}.png`);
          const sourceMetaFile = path.join(directory, 'sources', `${pin.key}.json`);
          let bytes;
          try {
            bytes = await fs.readFile(path.join(directory, sourceFile));
            const meta = await fs.readFile(sourceMetaFile, 'utf8').then(JSON.parse).catch(() => null);
            const validMeta = meta?.sourceIdentityHash === sourceIdentityHash && meta.sha256 === sha(bytes);
            const validPrevious = saved?.sourceKey === sourceKey && new Date(saved.sourceImageUpdatedAt).toISOString() === sourceIdentity.sourceImageUpdatedAt
              && (!digital || (saved.thumbnailUpdatedAt ?? null) === sourceIdentity.thumbnailUpdatedAt) && saved.sourceSha256 === sha(bytes);
            if (!validMeta && !validPrevious) throw new Error('The cached source needs revalidation.');
          }
          catch {
            if (!digital && !image.localFileName && image.urlFullxFull) {
              const url = new URL(image.urlFullxFull);
              if (url.protocol !== 'https:' || !url.hostname.endsWith('.etsystatic.com')) throw new Error('Unexpected public image host.');
              const response = await fetch(url, { signal: AbortSignal.timeout(30000) });
              if (!response.ok) throw new Error(`Public image failed (${response.status}).`);
              bytes = Buffer.from(await response.arrayBuffer());
            } else {
              const result = await s3.send(new GetObjectCommand({ Bucket: bucket, Key: sourceKey }));
              if (!result.Body) throw new Error('The stored artwork source is empty.');
              bytes = Buffer.from(await result.Body.transformToByteArray());
            }
            await fs.writeFile(path.join(directory, sourceFile), bytes);
          }
          await fs.writeFile(sourceMetaFile, json({ sourceIdentityHash, sha256: sha(bytes) }));
          // The output only uses an 872px image region. Resize a copy to that region before
          // embedding so original high-resolution downloads cannot exceed SVG attribute limits.
          const displayBytes = await sharp(bytes).rotate().resize({ width: 872, height: digital ? 870 : 850, fit: 'inside', withoutEnlargement: true }).png().toBuffer();
          const rendered = await sharp(Buffer.from(poster(pin, displayBytes))).png({ compressionLevel: 8 }).toBuffer();
          const metadata = await sharp(rendered).metadata();
          if (metadata.width !== 1000 || metadata.height !== 1500) throw new Error('Creative dimensions are incorrect.');
          const checksum = sha(rendered);
          const imageFile = `images/${pin.key}.png`;
          await fs.writeFile(path.join(directory, imageFile), rendered);
          completed.set(pin.key, { key: pin.key, listingId: pin.listingId, imageId: pin.imageId, imageFile, sha256: checksum,
            creativeStorageKey: `.pinterest-creatives/${pin.listingId}/${checksum}.png`, width: 1000, height: 1500,
            inputHash, layoutVersion: 2, sourceIdentityHash, sourceFile, sourceKey, sourceSha256: sha(bytes),
            sourceImageUpdatedAt: sourceIdentity.sourceImageUpdatedAt, thumbnailUpdatedAt: sourceIdentity.thumbnailUpdatedAt });
          count++;
          if (count % 20 === 0 || count === candidates.length) {
            await fs.writeFile(path.join(directory, 'creative-manifest.json'), json({ preparedAt: new Date().toISOString(), pins: [...completed.values()] }));
            console.log(JSON.stringify({ stage: 'creatives', completed: count, total: candidates.length }));
          }
        } catch (error) { failures.push({ key: pin.key, message: error.message }); console.log(JSON.stringify({ stage: 'creative-failed', key: pin.key, message: error.message })); }
      }
    }));
    await fs.writeFile(path.join(directory, 'creative-manifest.json'), json({ preparedAt: new Date().toISOString(), pins: [...completed.values()] }));
    await fs.writeFile(path.join(directory, 'creative-status.json'), json({ completed: count, failures }));
    if (failures.length) throw new Error(`${failures.length} creatives need attention. Existing valid files are retained.`);
    console.log(JSON.stringify({ stage: 'creatives-complete', completed: count, total: candidates.length }));
  } finally { await prisma.$disconnect(); s3.destroy(); }
}

main().catch(error => { console.error(error.message); process.exitCode = 1; });
