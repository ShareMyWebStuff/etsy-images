import { readFile } from 'node:fs/promises';
import path from 'node:path';

import { create as createFont, type FontkitFont } from 'fontkit';
import sharp from 'sharp';

import { PRINTSHRIMP_CUSTOM_FONTS } from '@/lib/printshrimp/custom-fonts';

export const FONT_SHOWCASE_WIDTH = 2000;
export const FONT_SHOWCASE_HEIGHT = 2000;

const CARD_CENTRES = [
  { x: 555, y: 520 },
  { x: 1445, y: 520 },
  { x: 555, y: 1000 },
  { x: 1445, y: 1000 },
  { x: 555, y: 1480 },
  { x: 1445, y: 1480 },
] as const;

function glyphPaths(font: FontkitFont, text: string, centreX: number, centreY: number) {
  const run = font.layout(text);
  const maximumWidth = 650;
  const maximumHeight = 190;
  const verticalBounds = run.glyphs.reduce((bounds, glyph, index) => ({
    minY: Math.min(bounds.minY, glyph.bbox.minY + run.positions[index].yOffset),
    maxY: Math.max(bounds.maxY, glyph.bbox.maxY + run.positions[index].yOffset),
  }), { minY: Number.POSITIVE_INFINITY, maxY: Number.NEGATIVE_INFINITY });
  const glyphHeight = Math.max(1, verticalBounds.maxY - verticalBounds.minY);
  const fontSize = Math.min(
    176,
    maximumWidth * font.unitsPerEm / Math.max(1, run.advanceWidth),
    maximumHeight * font.unitsPerEm / glyphHeight,
  );
  const scale = fontSize / font.unitsPerEm;
  const lineWidth = run.advanceWidth * scale;
  const baseline = centreY + ((verticalBounds.maxY + verticalBounds.minY) * scale / 2);
  let cursor = centreX - lineWidth / 2;
  const paths: string[] = [];

  for (let index = 0; index < run.glyphs.length; index += 1) {
    const glyph = run.glyphs[index];
    const position = run.positions[index];
    const pathData = glyph.path.toSVG();
    if (pathData) {
      paths.push(
        `<path d="${pathData}" transform="translate(${(cursor + position.xOffset * scale).toFixed(4)} ${(baseline - position.yOffset * scale).toFixed(4)}) scale(${scale.toFixed(8)} ${(-scale).toFixed(8)})"/>`,
      );
    }
    cursor += position.xAdvance * scale;
  }

  return `<g fill="#111111" fill-rule="nonzero">${paths.join('')}</g>`;
}

export async function createFontShowcaseImage() {
  const fontPaths = await Promise.all(PRINTSHRIMP_CUSTOM_FONTS.map(async (font, index) => {
    const contents = await readFile(path.join(process.cwd(), 'public', 'fonts', ...font.relativePath));
    const loadedFont = createFont(contents);
    return glyphPaths(
      loadedFont,
      font.family,
      CARD_CENTRES[index].x,
      CARD_CENTRES[index].y,
    );
  }));

  const svg = Buffer.from(`
    <svg xmlns="http://www.w3.org/2000/svg" width="${FONT_SHOWCASE_WIDTH}" height="${FONT_SHOWCASE_HEIGHT}" viewBox="0 0 ${FONT_SHOWCASE_WIDTH} ${FONT_SHOWCASE_HEIGHT}">
      <rect width="${FONT_SHOWCASE_WIDTH}" height="${FONT_SHOWCASE_HEIGHT}" fill="#FFFFFF"/>
      ${fontPaths.join('')}
    </svg>
  `);

  return sharp(svg)
    .removeAlpha()
    .png({ compressionLevel: 9 })
    .withMetadata({ density: 300 })
    .toBuffer();
}
