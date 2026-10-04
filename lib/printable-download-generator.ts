import path from 'node:path';
import PDFDocument from 'pdfkit';
import sharp from 'sharp';
import {
  PRINTABLE_DOWNLOAD_GUIDE_FILE_NAME,
  PRINTABLE_DOWNLOAD_SPECS,
  printableDownloadDimensions,
  type PrintableDownloadOrientation,
  type PrintableDownloadRatio,
} from '@/lib/printable-download-specs';
import { createThumbnailPrintMaster } from '@/lib/thumbnail-print-master';

const JPEG_QUALITY = 95;

export type GeneratedPrintableDownload = {
  buffer: Buffer;
  originalFileName: string;
  width: number;
  height: number;
  density: number;
  fileType: 'jpeg';
  orientation: PrintableDownloadOrientation;
  ratio: PrintableDownloadRatio;
};

function animalTitle(value: string) {
  const words = value.normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .match(/[A-Za-z0-9]+/g) ?? [];
  const resolved = words.map((word) => `${word.charAt(0).toLocaleUpperCase()}${word.slice(1)}`).join('_');
  return resolved || 'Nursery_Artwork';
}

async function normalizedSource(source: Buffer) {
  return sharp(source, { failOn: 'error' })
    .rotate()
    .toColourspace('srgb')
    .ensureAlpha()
    .png()
    .toBuffer({ resolveWithObject: true });
}

async function sampledCornerBackground(source: Buffer) {
  const { data, info } = await sharp(source, { failOn: 'error' })
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  const points = [
    [0, 0],
    [info.width - 1, 0],
    [0, info.height - 1],
    [info.width - 1, info.height - 1],
  ];
  const opaque = points.map(([x, y]) => {
    const offset = ((y * info.width) + x) * info.channels;
    return { r: data[offset], g: data[offset + 1], b: data[offset + 2], alpha: data[offset + 3] };
  }).filter((colour) => colour.alpha > 245);
  if (opaque.length === 0) return { r: 255, g: 255, b: 255 };
  return {
    r: Math.round(opaque.reduce((sum, colour) => sum + colour.r, 0) / opaque.length),
    g: Math.round(opaque.reduce((sum, colour) => sum + colour.g, 0) / opaque.length),
    b: Math.round(opaque.reduce((sum, colour) => sum + colour.b, 0) / opaque.length),
  };
}

async function createOpaqueFallback(source: Buffer, width: number, height: number) {
  const background = await sampledCornerBackground(source);
  const safeWidth = Math.max(1, Math.floor(width * 0.85));
  const safeHeight = Math.max(1, Math.floor(height * 0.70));
  const contained = await sharp(source, { failOn: 'error' })
    .resize({ width: safeWidth, height: safeHeight, fit: 'inside', withoutEnlargement: false, kernel: sharp.kernel.lanczos3 })
    .flatten({ background })
    .png({ compressionLevel: 9 })
    .toBuffer({ resolveWithObject: true });
  const left = Math.floor((width - contained.info.width) / 2);
  const top = Math.floor((height - contained.info.height) / 2);
  return sharp({ create: { width, height, channels: 3, background } })
    .composite([{ input: contained.data, left, top }])
    .toColourspace('srgb')
    .jpeg({ quality: JPEG_QUALITY, chromaSubsampling: '4:4:4' })
    .withMetadata({ density: 300 })
    .toBuffer();
}

export async function createPrintableDownload(
  source: Buffer,
  ratio: PrintableDownloadRatio,
  animalName: string,
  dimensionsOverride?: { width: number; height: number },
): Promise<GeneratedPrintableDownload> {
  const normalized = await normalizedSource(source);
  const orientation: PrintableDownloadOrientation = normalized.info.width > normalized.info.height ? 'landscape' : 'portrait';
  const dimensions = dimensionsOverride ?? printableDownloadDimensions(ratio, orientation);
  const stats = await sharp(normalized.data).stats();
  const hasTransparency = stats.channels.length >= 4 && stats.channels[3].min < 255;
  let buffer: Buffer;

  if (hasTransparency) {
    try {
      const master = await createThumbnailPrintMaster(normalized.data, {
        width: dimensions.width,
        height: dimensions.height,
        density: 300,
        sideMarginPercent: 7.5,
        topMarginPercent: 15,
        bottomMarginPercent: 15,
      });
      buffer = await sharp(master.buffer, { failOn: 'error' })
        .flatten({ background: { r: 255, g: 255, b: 255 } })
        .toColourspace('srgb')
        .jpeg({ quality: JPEG_QUALITY, chromaSubsampling: '4:4:4' })
        .withMetadata({ density: 300 })
        .toBuffer();
    } catch (error) {
      if (!(error instanceof Error) || !error.message.includes('transparent outer padding')) throw error;
      buffer = await createOpaqueFallback(normalized.data, dimensions.width, dimensions.height);
    }
  } else {
    buffer = await createOpaqueFallback(normalized.data, dimensions.width, dimensions.height);
  }

  const metadata = await sharp(buffer, { failOn: 'error' }).metadata();
  if (metadata.width !== dimensions.width || metadata.height !== dimensions.height) {
    throw new Error('The printable download failed its exact-dimension verification.');
  }
  if (metadata.format !== 'jpeg' || metadata.hasAlpha) {
    throw new Error('The printable download failed its JPEG colour-mode verification.');
  }
  if (!metadata.density || Math.abs(metadata.density - 300) > 1) {
    throw new Error('The printable download failed its 300 DPI verification.');
  }

  const spec = PRINTABLE_DOWNLOAD_SPECS.find((candidate) => candidate.key === ratio)!;
  const parts = [animalTitle(animalName), spec.fileToken, spec.masterToken, `${dimensions.width}x${dimensions.height}`, '300DPI']
    .filter(Boolean);
  return {
    buffer,
    originalFileName: `${parts.join('_')}.jpeg`,
    width: dimensions.width,
    height: dimensions.height,
    density: 300,
    fileType: 'jpeg',
    orientation,
    ratio,
  };
}

function orientedSizes(sizes: readonly string[], orientation: PrintableDownloadOrientation) {
  if (orientation === 'portrait') return sizes;
  return sizes.map((size) => size.replace(/(\d+) x (\d+)/, '$2 x $1'));
}

export function createHowToPrintGuide(animalName: string, orientation: PrintableDownloadOrientation) {
  const artworkName = animalName.trim() || 'Nursery artwork';
  const rows = PRINTABLE_DOWNLOAD_SPECS.map((spec) => ({
    label: spec.label.replace(/\s*\([^)]*\)\s*$/, ''),
    file: [spec.fileToken, spec.masterToken].filter(Boolean).join(' / '),
    sizes: orientedSizes(spec.supportedSizes, orientation).join(', '),
  }));

  return new Promise<{ buffer: Buffer; originalFileName: string }>((resolve, reject) => {
    const chunks: Buffer[] = [];
    const document = new PDFDocument({
      size: 'A4',
      margin: 0,
      info: {
        Title: `How to print ${artworkName}`,
        Author: 'CosyHousePrints',
        Subject: 'Printing instructions for digital nursery wall art',
      },
    });
    const pageWidth = document.page.width;
    const pageHeight = document.page.height;
    const sage = '#68755A';
    const darkSage = '#536149';
    const terracotta = '#C9764E';
    const cream = '#FCF8F1';
    const softCream = '#F8F4EA';
    const paleSage = '#EDF0E8';
    const border = '#D8C8B4';
    const text = '#3E3935';
    const muted = '#6B645E';
    const headerPath = path.join(process.cwd(), 'public', 'pdf-assets', 'cosyhouseprints-header.png');

    document.on('data', (chunk: Buffer) => chunks.push(chunk));
    document.on('end', () => resolve({
      buffer: Buffer.concat(chunks),
      originalFileName: PRINTABLE_DOWNLOAD_GUIDE_FILE_NAME,
    }));
    document.on('error', reject);

    document.rect(0, 0, pageWidth, pageHeight).fill(cream);
    document.image(headerPath, 20, 18, { width: pageWidth - 40, height: 158 });
    document.fillColor(darkSage).font('Times-Roman').fontSize(30)
      .text('CosyHousePrints', 120, 48, { width: pageWidth - 240, align: 'center' });
    document.fillColor(terracotta).font('Times-Roman').fontSize(12)
      .text('~  *  ~', 180, 86, { width: pageWidth - 360, align: 'center' });
    document.fillColor(muted).font('Helvetica').fontSize(11)
      .text('Printable Wall Art for Cosy Homes', 150, 106, { width: pageWidth - 300, align: 'center' });

    document.fillColor(darkSage).font('Times-Roman').fontSize(28)
      .text('How to print your artwork', 55, 184, { width: pageWidth - 110, align: 'center' });
    document.fillColor(text).font('Helvetica').fontSize(9.5)
      .text(`Use this guide to print your ${artworkName} artwork at home or with a professional printer.`, 70, 221, {
        width: pageWidth - 140,
        align: 'center',
      });

    const sectionHeading = (number: string, title: string, x: number, y: number, width: number) => {
      document.circle(x + 13, y + 13, 13).fill(terracotta);
      document.fillColor('#FFFFFF').font('Helvetica-Bold').fontSize(10)
        .text(number, x + 4, y + 7, { width: 18, align: 'center' });
      document.fillColor(darkSage).font('Times-Roman').fontSize(15)
        .text(title, x + 34, y + 4, { width: width - 34 });
    };

    const fileBoxX = 48;
    const fileBoxY = 252;
    const fileBoxWidth = pageWidth - 96;
    const fileBoxHeight = 228;
    document.roundedRect(fileBoxX, fileBoxY, fileBoxWidth, fileBoxHeight, 8)
      .lineWidth(1).fillAndStroke(softCream, border);
    sectionHeading('1', 'Choose the file that matches your paper or frame', fileBoxX + 16, fileBoxY + 14, fileBoxWidth - 32);
    document.fillColor(muted).font('Helvetica').fontSize(8)
      .text('Use the ratio family shown in the file name. You may print at any of the listed sizes without cropping.', fileBoxX + 16, fileBoxY + 46, {
        width: fileBoxWidth - 32,
      });

    const rowTop = fileBoxY + 71;
    const rowHeight = 24;
    rows.forEach((row, index) => {
      const y = rowTop + (index * rowHeight);
      if (index % 2 === 0) document.rect(fileBoxX + 12, y - 2, fileBoxWidth - 24, rowHeight).fill(paleSage);
      document.fillColor(darkSage).font('Helvetica-Bold').fontSize(8)
        .text(row.label, fileBoxX + 20, y + 5, { width: 55 });
      document.fillColor(terracotta).font('Helvetica-Bold').fontSize(7.5)
        .text(row.file, fileBoxX + 80, y + 5, { width: 78 });
      document.fillColor(text).font('Helvetica').fontSize(7.5)
        .text(row.sizes, fileBoxX + 162, y + 5, { width: fileBoxWidth - 190, height: 18, ellipsis: true });
    });

    const cardY = 498;
    const cardGap = 14;
    const cardWidth = (pageWidth - 96 - cardGap) / 2;
    const cardHeight = 137;
    const cards = [
      {
        number: '2',
        title: 'Choose where to print',
        lines: [
          'Home: use a good-quality colour printer for smaller sizes.',
          'Local print shop: take the matching JPEG on a USB drive or upload it online.',
          'Online service: upload the full-resolution JPEG and select the exact size and units.',
        ],
      },
      {
        number: '3',
        title: 'Check the print settings',
        lines: [
          `Select ${orientation} orientation and the intended physical size.`,
          'Keep the original aspect ratio. Never stretch the artwork.',
          'Check the preview and turn off automatic cropping or “fill page” if it removes artwork.',
        ],
      },
    ];
    cards.forEach((card, index) => {
      const x = 48 + (index * (cardWidth + cardGap));
      document.roundedRect(x, cardY, cardWidth, cardHeight, 8).lineWidth(1).fillAndStroke('#FFFFFF', border);
      sectionHeading(card.number, card.title, x + 14, cardY + 13, cardWidth - 28);
      let y = cardY + 49;
      card.lines.forEach((line) => {
        document.circle(x + 22, y + 4, 2.2).fill(sage);
        document.fillColor(text).font('Helvetica').fontSize(8.2)
          .text(line, x + 31, y, { width: cardWidth - 48, lineGap: 1 });
        y += 27;
      });
    });

    const finishY = 653;
    document.roundedRect(48, finishY, pageWidth - 96, 112, 8).lineWidth(1).fillAndStroke(paleSage, border);
    sectionHeading('4', 'Choose your paper and make a final check', 64, finishY + 14, pageWidth - 128);
    document.fillColor(text).font('Helvetica').fontSize(8.7)
      .text(
        'For a soft premium finish, use matte photo paper or heavyweight archival paper. Select the printer setting recommended for your paper, use the highest suitable quality, and print one small test before ordering or printing a large size.',
        66,
        finishY + 50,
        { width: pageWidth - 132, lineGap: 2 },
      );
    document.fillColor(muted).font('Helvetica-Oblique').fontSize(8)
      .text(
        'Colour note: colours can vary slightly between monitors, printers, inks and papers. This is normal for digital artwork.',
        66,
        finishY + 87,
        { width: pageWidth - 132, align: 'center' },
      );

    document.moveTo(80, 790).lineTo(pageWidth - 80, 790).strokeColor(border).stroke();
    document.fillColor(muted).font('Helvetica').fontSize(8)
      .text('Digital artwork printing guide   |   CosyHousePrints', 55, 805, { width: pageWidth - 110, align: 'center' });
    document.end();
  });
}
