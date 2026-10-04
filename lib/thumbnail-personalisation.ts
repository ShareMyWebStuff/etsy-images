import sharp from 'sharp';
import { create as createFont, type FontkitFont, type FontkitRun } from 'fontkit';
import {
  THUMBNAIL_PRINT_MASTER_HEIGHT_PX,
  THUMBNAIL_PRINT_MASTER_WIDTH_PX,
} from '@/lib/thumbnail-generate-prompt';

export type LocalPersonalisationSpec = {
  headerText: string;
  footerText: string;
  textTransform: 'UPPERCASE' | 'NONE';
};

export type PersonalisationRenderOptions = {
  width?: number;
  height?: number;
  density?: number;
  targetTextWidthPercent?: number;
  maxFontSizePercent?: number;
  curveRisePercent?: number;
  requireSourceAlpha?: boolean;
  fontFamily?: string;
  fontWeight?: number;
};

export type PersonalisationRenderResult = {
  buffer: Buffer;
  width: number;
  height: number;
  density: number;
  fontSize: number;
  textColour: string;
  headerText: string;
  footerText: string;
};

type Bounds = { minX: number; minY: number; maxX: number; maxY: number };
type CurvedLine = { paths: string; bounds: Bounds };

function transformedText(text: string, transform: LocalPersonalisationSpec['textTransform']) {
  return transform === 'UPPERCASE' ? text.toLocaleUpperCase() : text;
}

function emptyBounds(): Bounds {
  return { minX: Number.POSITIVE_INFINITY, minY: Number.POSITIVE_INFINITY, maxX: Number.NEGATIVE_INFINITY, maxY: Number.NEGATIVE_INFINITY };
}

function includePoint(bounds: Bounds, x: number, y: number) {
  bounds.minX = Math.min(bounds.minX, x);
  bounds.minY = Math.min(bounds.minY, y);
  bounds.maxX = Math.max(bounds.maxX, x);
  bounds.maxY = Math.max(bounds.maxY, y);
}

function curvedLine(
  run: FontkitRun,
  font: FontkitFont,
  fontSize: number,
  direction: 'up' | 'down',
  curveRisePercent: number,
) {
  const scale = fontSize / font.unitsPerEm;
  const lineWidth = run.advanceWidth * scale;
  const rise = Math.max(0.01, lineWidth * (curveRisePercent / 100));
  const radius = ((lineWidth * lineWidth) / (8 * rise)) + (rise / 2);
  const directionSign = direction === 'up' ? 1 : -1;
  const bounds = emptyBounds();
  const paths: string[] = [];
  let cursor = 0;

  for (let index = 0; index < run.glyphs.length; index += 1) {
    const glyph = run.glyphs[index];
    const position = run.positions[index];
    const advance = position.xAdvance * scale;
    const centreX = (-lineWidth / 2) + cursor + (advance / 2);
    const circleY = radius - Math.sqrt(Math.max(0, (radius * radius) - (centreX * centreX)));
    const centreY = directionSign * circleY;
    const slope = directionSign * centreX / Math.sqrt(Math.max(0.0001, (radius * radius) - (centreX * centreX)));
    const angleRadians = Math.atan(slope);
    const angleDegrees = angleRadians * (180 / Math.PI);
    const localX = (-position.xAdvance / 2) + position.xOffset;
    const localY = position.yOffset;
    const cos = Math.cos(angleRadians);
    const sin = Math.sin(angleRadians);

    const pathData = glyph.path.toSVG();
    const hasVisibleBounds = [glyph.bbox.minX, glyph.bbox.minY, glyph.bbox.maxX, glyph.bbox.maxY]
      .every(Number.isFinite);
    if (pathData && hasVisibleBounds) {
      for (const [glyphX, glyphY] of [
        [glyph.bbox.minX, glyph.bbox.minY],
        [glyph.bbox.minX, glyph.bbox.maxY],
        [glyph.bbox.maxX, glyph.bbox.minY],
        [glyph.bbox.maxX, glyph.bbox.maxY],
      ] as const) {
        const scaledX = (glyphX + localX) * scale;
        const scaledY = -(glyphY + localY) * scale;
        includePoint(
          bounds,
          centreX + (scaledX * cos) - (scaledY * sin),
          centreY + (scaledX * sin) + (scaledY * cos),
        );
      }
      paths.push(
        `<path d="${pathData}" transform="translate(${centreX.toFixed(4)} ${centreY.toFixed(4)}) rotate(${angleDegrees.toFixed(6)}) scale(${scale.toFixed(8)} ${(-scale).toFixed(8)}) translate(${localX.toFixed(4)} ${localY.toFixed(4)})"/>`,
      );
    }
    cursor += advance;
  }

  if (!Number.isFinite(bounds.minX)) throw new Error('The requested personalisation text contains no renderable glyphs.');
  return { paths: paths.join(''), bounds } satisfies CurvedLine;
}

function boundsWidth(bounds: Bounds) {
  return bounds.maxX - bounds.minX;
}

function boundsHeight(bounds: Bounds) {
  return bounds.maxY - bounds.minY;
}

function chooseSharedFontSize(
  lines: Array<{ run: FontkitRun; direction: 'up' | 'down' }>,
  font: FontkitFont,
  maxWidth: number,
  maxHeight: number,
  maximumFontSize: number,
  curveRisePercent: number,
) {
  let low = 1;
  let high = maximumFontSize;
  let selected = 0;
  while (low <= high) {
    const candidate = Math.floor((low + high) / 2);
    const fits = lines.every(({ run, direction }) => {
      const line = curvedLine(run, font, candidate, direction, curveRisePercent);
      return boundsWidth(line.bounds) <= maxWidth && boundsHeight(line.bounds) <= maxHeight;
    });
    if (fits) {
      selected = candidate;
      low = candidate + 1;
    } else {
      high = candidate - 1;
    }
  }
  if (selected < 1) throw new Error('The personalisation text cannot fit inside the reserved text area.');
  return selected;
}

function relativeLuminance(red: number, green: number, blue: number) {
  const channels = [red, green, blue].map((channel) => {
    const value = channel / 255;
    return value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
  });
  return (0.2126 * channels[0]) + (0.7152 * channels[1]) + (0.0722 * channels[2]);
}

function colourHex(red: number, green: number, blue: number) {
  return `#${[red, green, blue].map((value) => Math.max(0, Math.min(255, Math.round(value))).toString(16).padStart(2, '0')).join('')}`;
}

async function artworkTextColour(source: Buffer) {
  const { data, info } = await sharp(source, { failOn: 'error' })
    .resize({ width: 240, height: 240, fit: 'inside' })
    .toColourspace('srgb')
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  let red = 0;
  let green = 0;
  let blue = 0;
  let weight = 0;
  let fallbackRed = 0;
  let fallbackGreen = 0;
  let fallbackBlue = 0;
  let fallbackWeight = 0;

  for (let offset = 0; offset < data.length; offset += info.channels) {
    const alpha = data[offset + info.channels - 1] / 255;
    if (alpha < 0.2) continue;
    const pixelRed = data[offset];
    const pixelGreen = data[offset + 1];
    const pixelBlue = data[offset + 2];
    fallbackRed += pixelRed * alpha;
    fallbackGreen += pixelGreen * alpha;
    fallbackBlue += pixelBlue * alpha;
    fallbackWeight += alpha;
    if (pixelGreen >= pixelRed * 0.78 && pixelGreen >= pixelBlue * 0.9) {
      red += pixelRed * alpha;
      green += pixelGreen * alpha;
      blue += pixelBlue * alpha;
      weight += alpha;
    }
  }

  if (weight === 0) {
    red = fallbackWeight ? fallbackRed / fallbackWeight : 63;
    green = fallbackWeight ? fallbackGreen / fallbackWeight : 81;
    blue = fallbackWeight ? fallbackBlue / fallbackWeight : 66;
  } else {
    red /= weight;
    green /= weight;
    blue /= weight;
  }

  // Preserve the sampled hue while darkening it to strong contrast on the
  // pure-white background used behind transparent print areas.
  let luminance = relativeLuminance(red, green, blue);
  while (((1.05) / (luminance + 0.05)) < 7) {
    red *= 0.88;
    green *= 0.88;
    blue *= 0.88;
    luminance = relativeLuminance(red, green, blue);
  }
  return colourHex(red, green, blue);
}

export async function createPersonalisedPrintMaster(
  source: Buffer,
  fontContents: Buffer,
  spec: LocalPersonalisationSpec,
  suppliedOptions: PersonalisationRenderOptions = {},
): Promise<PersonalisationRenderResult> {
  const width = suppliedOptions.width ?? THUMBNAIL_PRINT_MASTER_WIDTH_PX;
  const height = suppliedOptions.height ?? THUMBNAIL_PRINT_MASTER_HEIGHT_PX;
  const density = suppliedOptions.density ?? 300;
  const targetTextWidthPercent = suppliedOptions.targetTextWidthPercent ?? 65;
  const maxFontSizePercent = suppliedOptions.maxFontSizePercent ?? 18;
  const curveRisePercent = suppliedOptions.curveRisePercent ?? 5;
  const requireSourceAlpha = suppliedOptions.requireSourceAlpha ?? true;
  const expectedFontFamily = suppliedOptions.fontFamily ?? 'Nunito';
  const fontWeight = suppliedOptions.fontWeight ?? 400;
  const sourceMetadata = await sharp(source, { failOn: 'error' }).metadata();
  if (sourceMetadata.width !== width || sourceMetadata.height !== height) {
    throw new Error(`The print master is ${sourceMetadata.width ?? 0} × ${sourceMetadata.height ?? 0}px; stage 3 requires ${width} × ${height}px.`);
  }
  if (requireSourceAlpha && !sourceMetadata.hasAlpha) throw new Error('The print master must retain a genuine alpha channel before adding text.');

  const headerText = transformedText(spec.headerText.trim(), spec.textTransform);
  const footerText = transformedText(spec.footerText.trim(), spec.textTransform);
  if (!headerText && !footerText) throw new Error('Stage 3 requires header text, footer text, or both.');

  let font = createFont(fontContents);
  const fontIdentity = `${font.familyName} ${font.fullName} ${font.postscriptName}`;
  if (!fontIdentity.toLocaleLowerCase().includes(expectedFontFamily.toLocaleLowerCase())) {
    throw new Error(`The selected font file is not ${expectedFontFamily}.`);
  }
  if (font.getVariation && font.variationAxes && 'wght' in font.variationAxes) {
    const weightAxis = font.variationAxes.wght as { min: number; max: number };
    font = font.getVariation({ wght: Math.max(weightAxis.min, Math.min(weightAxis.max, fontWeight)) });
  }

  const activeLines = [
    headerText ? { text: headerText, direction: 'up' as const, run: font.layout(headerText) } : null,
    footerText ? { text: footerText, direction: 'down' as const, run: font.layout(footerText) } : null,
  ].filter((line): line is NonNullable<typeof line> => line !== null);
  const headerTop = Math.round(height * 0.05);
  const headerBottom = Math.round(height * 0.15);
  const footerTop = Math.round(height * 0.85);
  const footerBottom = height - Math.round(height * 0.05);
  let fontSize = chooseSharedFontSize(
    activeLines,
    font,
    Math.floor(width * (targetTextWidthPercent / 100)),
    Math.min(headerBottom - headerTop, footerBottom - footerTop),
    Math.floor(width * (maxFontSizePercent / 100)),
    curveRisePercent,
  );
  const colour = await artworkTextColour(source);
  const layoutTolerance = 0.5;
  const positionLine = (line: typeof activeLines[number], candidateFontSize: number) => {
    const geometry = curvedLine(line.run, font, candidateFontSize, line.direction, curveRisePercent);
    const translateX = (width / 2) - ((geometry.bounds.minX + geometry.bounds.maxX) / 2);
    const translateY = line.direction === 'up'
      ? headerTop - geometry.bounds.minY
      : footerBottom - geometry.bounds.maxY;
    const positionedBounds = {
      minX: geometry.bounds.minX + translateX,
      maxX: geometry.bounds.maxX + translateX,
      minY: geometry.bounds.minY + translateY,
      maxY: geometry.bounds.maxY + translateY,
    };
    const fits = positionedBounds.minX >= -layoutTolerance
      && positionedBounds.maxX <= width + layoutTolerance
      && (line.direction === 'up'
        ? positionedBounds.minY >= headerTop - layoutTolerance && positionedBounds.maxY <= headerBottom + layoutTolerance
        : positionedBounds.minY >= footerTop - layoutTolerance && positionedBounds.maxY <= footerBottom + layoutTolerance);
    return { geometry, translateX, translateY, fits };
  };

  let positionedLines = activeLines.map((line) => positionLine(line, fontSize));
  while (fontSize > 1 && positionedLines.some((line) => !line.fits)) {
    fontSize -= 1;
    positionedLines = activeLines.map((line) => positionLine(line, fontSize));
  }
  if (positionedLines.some((line) => !line.fits)) {
    throw new Error('The personalisation text cannot fit inside its reserved areas, even at the minimum font size.');
  }
  const svgLines = positionedLines.map(({ geometry, translateX, translateY }) => (
    `<g transform="translate(${translateX.toFixed(4)} ${translateY.toFixed(4)})">${geometry.paths}</g>`
  ));

  const svg = Buffer.from(
    `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}"><g fill="${colour}" fill-rule="nonzero">${svgLines.join('')}</g></svg>`,
  );
  const buffer = await sharp(source, { failOn: 'error' })
    .toColourspace('srgb')
    .ensureAlpha()
    .composite([{ input: svg, left: 0, top: 0 }])
    .png({ compressionLevel: 9 })
    .withMetadata({ density })
    .toBuffer();
  const outputMetadata = await sharp(buffer, { failOn: 'error' }).metadata();
  if (outputMetadata.width !== width || outputMetadata.height !== height || !outputMetadata.hasAlpha) {
    throw new Error('The personalised print master failed its dimensions or transparency verification.');
  }

  return { buffer, width, height, density, fontSize, textColour: colour, headerText, footerText };
}
