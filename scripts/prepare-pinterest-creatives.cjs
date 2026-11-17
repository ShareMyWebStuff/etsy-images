// Builds native poster layouts around unchanged product photography and artwork.
// No product pixels are retouched, regenerated, or cropped.
const fs = require('node:fs');
const path = require('node:path');
const { createHash } = require('node:crypto');
const sharp = require('sharp');
const fontkit = require('fontkit');

const root = process.cwd();
const directory = path.resolve(process.argv[2] || 'output/pinterest/2026-11-nursery');
const copy = JSON.parse(fs.readFileSync(path.join(directory, 'copy.json'), 'utf8'));
const sources = JSON.parse(fs.readFileSync(path.join(directory, 'source-manifest.json'), 'utf8'));
const fonts = {
  display: fontkit.openSync(path.join(root, 'public/fonts/playfairdisplay/PlayfairDisplay-Regular.ttf')),
  body: fontkit.openSync(path.join(root, 'public/fonts/quicksand/Quicksand-Regular.ttf')),
};
if (fonts.body.variationAxes?.wght) fonts.body = fonts.body.getVariation({ wght: 600 });
const esc = value => String(value).replaceAll('&', '&amp;').replaceAll('"', '&quot;').replaceAll('<', '&lt;').replaceAll('>', '&gt;');
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const measure = (text, font, size) => font.layout(text).positions.reduce((width, glyph) => width + glyph.xAdvance, 0) * size / font.unitsPerEm;

function type(text, x, y, size, font, fill, anchor = 'start') {
  const run = font.layout(text);
  const scale = size / font.unitsPerEm;
  const width = measure(text, font, size);
  let cursor = anchor === 'middle' ? -width / 2 : anchor === 'end' ? -width : 0;
  return run.glyphs.map((glyph, i) => {
    const p = run.positions[i];
    const result = `<path d="${glyph.path.toSVG()}" fill="${fill}" transform="translate(${x + cursor + p.xOffset * scale} ${y - p.yOffset * scale}) scale(${scale} ${-scale})"/>`;
    cursor += p.xAdvance * scale;
    return result;
  }).join('');
}

function heading(text, x, y, width, fill) {
  let size = 64;
  let lines;
  do {
    lines = [''];
    for (const word of text.split(/\s+/)) {
      const last = lines.length - 1;
      const candidate = lines[last] ? `${lines[last]} ${word}` : word;
      if (measure(candidate, fonts.display, size) <= width) lines[last] = candidate;
      else lines.push(word);
    }
    if (lines.length <= 2 && lines.every(line => measure(line, fonts.display, size) <= width)) break;
    size -= 2;
  } while (size >= 44);
  if (lines.length > 2) throw new Error(`Heading does not fit: ${text}`);
  return lines.map((line, index) => type(line, x, y + index * (size + 12), size, fonts.display, fill)).join('');
}

function embed(file, x, y, width, height) {
  const bytes = fs.readFileSync(path.resolve(root, file));
  return `<image x="${x}" y="${y}" width="${width}" height="${height}" preserveAspectRatio="xMidYMid meet" href="data:image/png;base64,${bytes.toString('base64')}"/>`;
}

function poster(pin, source) {
  const digital = pin.creativeType === 'digital_download';
  const detail = pin.creativeType === 'product_detail';
  const colour = digital ? { bg: '#EAF0E9', ink: '#304B3F', accent: '#526A56' }
    : detail ? { bg: '#F5EDE2', ink: '#45382F', accent: '#976345' }
      : { bg: '#F8F4ED', ink: '#35463C', accent: '#6C7C68' };
  const theme = { safari: 'SAFARI', woodland: 'WOODLAND', farm: 'FARM ANIMAL' }[pin.boardKey];
  let svg = `<svg xmlns="http://www.w3.org/2000/svg" width="1000" height="1500" viewBox="0 0 1000 1500"><title>${esc(pin.title)}</title><rect width="1000" height="1500" fill="${colour.bg}"/>`;
  svg += type('CosyHousePrints', 64, 74, 27, fonts.body, colour.ink);
  svg += `<line x1="64" y1="108" x2="936" y2="108" stroke="${colour.accent}" stroke-opacity=".35"/>`;
  if (digital) {
    svg += `<rect x="64" y="140" width="282" height="46" rx="23" fill="${colour.ink}"/>`;
    svg += type('DIGITAL DOWNLOAD', 205, 170, 21, fonts.body, '#FFFFFF', 'middle');
    svg += heading(pin.onImageText, 64, 263, 872, colour.ink);
    svg += '<rect x="198" y="376" width="620" height="775" fill="#D4DACF"/>';
    svg += '<rect x="190" y="365" width="620" height="775" fill="#FFFFFF"/>';
    svg += embed(source.thumbnailFile, 190, 365, 620, 775);
    svg += type(`${pin.designName} nursery art`, 500, 1224, 34, fonts.body, colour.ink, 'middle');
    svg += type('Print at home or with a print service', 500, 1301, 29, fonts.body, colour.ink, 'middle');
    svg += type('No physical print or frame included', 500, 1362, 26, fonts.body, colour.ink, 'middle');
    svg += type('Explore the digital artwork on Etsy', 500, 1440, 24, fonts.body, colour.ink, 'middle');
  } else {
    svg += type(`${theme} ${detail ? 'PRINT COLLECTION' : 'NURSERY IDEAS'}`, 64, 161, 23, fonts.body, colour.accent);
    svg += heading(pin.onImageText, 64, 246, 872, colour.ink);
    const rank = detail ? 1 : 2;
    const image = source.sources.find(item => item.rank === rank);
    if (!image) throw new Error(`Missing source for ${pin.id}`);
    svg += '<rect x="51" y="355" width="898" height="898" fill="#FFFFFF"/>';
    svg += embed(image.localFile, 52, 356, 896, 896);
    if (detail) {
      svg += `<rect x="180" y="1300" width="640" height="66" rx="33" fill="${colour.accent}"/>`;
      svg += type('FRAMED OR UNFRAMED', 500, 1343, 28, fonts.body, '#FFFFFF', 'middle');
      svg += type('Choose your size and finish on Etsy', 500, 1421, 26, fonts.body, colour.ink, 'middle');
    } else {
      svg += type(`${pin.designName} nursery print`, 500, 1332, 36, fonts.body, colour.ink, 'middle');
      svg += type('A little character for their room', 500, 1403, 28, fonts.body, colour.ink, 'middle');
      svg += type('Discover the print on Etsy', 500, 1457, 23, fonts.body, colour.accent, 'middle');
    }
  }
  return `${svg}</svg>`;
}

function reviewHtml(manifest) {
  const boards = copy.boards.map(board => `<section><h2>${esc(board.name)}</h2><p class="board-description">${esc(board.description)}</p><div class="grid">${manifest.filter(pin => pin.boardKey === board.key).map(pin => `<article><a href="${esc(pin.imageFile)}" target="_blank"><img loading="lazy" src="${esc(pin.imageFile)}" alt="${esc(pin.title)}" width="1000" height="1500"></a><div class="copy"><span class="badge">DRAFT · ${esc(pin.destinationVariant === 'digital' ? 'DIGITAL DOWNLOAD' : 'PHYSICAL PRINT')}</span><h3>${esc(pin.title)}</h3><p>${esc(pin.description)}</p><a href="${esc(pin.destinationUrl)}" target="_blank" rel="noopener noreferrer">Review the Etsy product ↗</a></div></article>`).join('')}</div></section>`).join('');
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>CosyHousePrints · 45 Pinterest drafts</title><style>*{box-sizing:border-box}body{margin:0;background:#f7f4ee;color:#283c32;font:16px/1.6 system-ui,sans-serif}header,main{max-width:1440px;margin:auto;padding:32px}header{padding-top:64px}h1{font:clamp(32px,5vw,58px)/1.15 Georgia,serif;margin:12px 0}h2{font:32px Georgia,serif;margin-top:44px}.intro{max-width:760px}.meta,.badge{font-size:12px;font-weight:650;letter-spacing:.06em}.meta{color:#61705d}.board-description{max-width:850px}.grid{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:24px}article{background:#fff;border:1px solid #deded3;border-radius:12px;overflow:hidden}img{display:block;width:100%;height:auto;aspect-ratio:2/3}.copy{padding:22px}h3{font-size:19px;line-height:1.4;margin:14px 0}.copy p{color:#535d52;font-size:14px}a{color:#345d46}.badge{display:block;color:#7d573c}footer{padding:32px;text-align:center;color:#66705e}@media(max-width:900px){.grid{grid-template-columns:repeat(2,minmax(0,1fr))}}@media(max-width:580px){header,main{padding:20px}.grid{grid-template-columns:1fr}}</style></head><body><header><div class="meta">COSYHOUSEPRINTS · PINTEREST REVIEW</div><h1>Little characters.<br>Rooms full of imagination.</h1><p class="intro">45 draft Pins across Safari, Woodland and Farm Animals. Each design has a room idea, a physical-print Pin and a separately labelled digital-download Pin. All artwork and room photographs come from your existing product assets.</p><p class="meta">1000 × 1500 PX · 3 BOARDS · 15 DESIGNS · NOTHING SCHEDULED OR PUBLISHED</p></header><main>${boards}</main><footer>Prepared for review. Pins remain drafts until you choose to publish or schedule them.</footer></body></html>`;
}

async function main() {
  if (copy.pins.length !== 45 || sources.length !== 15) throw new Error('Expected 45 Pins and 15 source designs.');
  const imagesDirectory = path.join(directory, 'images');
  fs.mkdirSync(imagesDirectory, { recursive: true });
  const manifest = [];
  for (const pin of copy.pins) {
    if (!/^[a-z]+-\d+-(room_inspiration|product_detail|digital_download)$/.test(pin.id)) throw new Error('Unsafe Pin identifier.');
    const source = sources.find(item => item.listingId === pin.listingId);
    if (!source?.thumbnailFile) throw new Error(`Missing original artwork for ${pin.id}`);
    const bytes = await sharp(Buffer.from(poster(pin, source))).png().toBuffer();
    const metadata = await sharp(bytes).metadata();
    if (metadata.width !== 1000 || metadata.height !== 1500) throw new Error('Creative dimensions are incorrect.');
    const fileName = `${pin.id}.png`;
    fs.writeFileSync(path.join(imagesDirectory, fileName), bytes);
    const rank = pin.creativeType === 'room_inspiration' ? 2 : pin.creativeType === 'product_detail' ? 1 : 14;
    const image = source.sources.find(item => item.rank === rank);
    const checksum = hash(bytes);
    manifest.push({ ...pin, imageId: image.imageId, imageFile: `images/${fileName}`, width: 1000, height: 1500,
      sha256: checksum, creativeStorageKey: `.pinterest-creatives/${pin.listingId}/${checksum}.png`,
      sourceImageFile: pin.destinationVariant === 'digital' ? source.thumbnailFile : image.localFile });
  }
  fs.writeFileSync(path.join(directory, 'creative-manifest.json'), JSON.stringify({ schemaVersion: 1, preparedAt: new Date().toISOString(), boards: copy.boards, pins: manifest }, null, 2));
  fs.writeFileSync(path.join(directory, 'review.html'), reviewHtml(manifest));
  console.log(JSON.stringify({ directory: path.relative(root, directory), creatives: manifest.length, dimensions: '1000x1500', review: path.join(directory, 'review.html') }));
}

main().catch(error => { console.error(error.message); process.exitCode = 1; });
