import sharp from 'sharp';
import {
  THUMBNAIL_PRINT_MASTER_HEIGHT_PX,
  THUMBNAIL_PRINT_MASTER_WIDTH_PX,
} from '@/lib/thumbnail-generate-prompt';

export type PrintMasterOptions = {
  width?: number;
  height?: number;
  density?: number;
  sideMarginPercent?: number;
  topMarginPercent?: number;
  bottomMarginPercent?: number;
};

export type PrintMasterResult = {
  buffer: Buffer;
  width: number;
  height: number;
  density: number;
  artworkWidth: number;
  artworkHeight: number;
  upscaled: boolean;
  margins: {
    left: number;
    right: number;
    top: number;
    bottom: number;
  };
};

type AlphaBounds = {
  left: number;
  top: number;
  right: number;
  bottom: number;
  width: number;
  height: number;
};

async function alphaBounds(source: Buffer): Promise<AlphaBounds | null> {
  const { data, info } = await sharp(source, { failOn: 'error' })
    .toColourspace('srgb')
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  const alphaChannel = info.channels - 1;
  let left = info.width;
  let top = info.height;
  let right = -1;
  let bottom = -1;

  for (let y = 0; y < info.height; y += 1) {
    const rowOffset = y * info.width * info.channels;
    for (let x = 0; x < info.width; x += 1) {
      if (data[rowOffset + (x * info.channels) + alphaChannel] === 0) continue;
      if (x < left) left = x;
      if (x > right) right = x;
      if (y < top) top = y;
      if (y > bottom) bottom = y;
    }
  }

  if (right < left || bottom < top) return null;
  return {
    left,
    top,
    right: right + 1,
    bottom: bottom + 1,
    width: right - left + 1,
    height: bottom - top + 1,
  };
}

async function cropToAlphaBounds(source: Buffer) {
  const bounds = await alphaBounds(source);
  if (!bounds) throw new Error('The source illustration is fully transparent.');
  return {
    bounds,
    buffer: await sharp(source, { failOn: 'error' })
      .toColourspace('srgb')
      .ensureAlpha()
      .extract({
        left: bounds.left,
        top: bounds.top,
        width: bounds.width,
        height: bounds.height,
      })
      .png()
      .toBuffer(),
  };
}

function validateOptions(options: Required<PrintMasterOptions>) {
  if (!Number.isSafeInteger(options.width) || options.width < 1) throw new Error('Print-master width must be a positive whole number.');
  if (!Number.isSafeInteger(options.height) || options.height < 1) throw new Error('Print-master height must be a positive whole number.');
  if (!Number.isFinite(options.density) || options.density <= 0) throw new Error('Print-master DPI must be positive.');
  for (const [label, value] of [
    ['side', options.sideMarginPercent],
    ['top', options.topMarginPercent],
    ['bottom', options.bottomMarginPercent],
  ] as const) {
    if (!Number.isFinite(value) || value < 0 || value >= 50) {
      throw new Error(`The ${label} margin percentage must be between 0 and 50.`);
    }
  }
}

export async function createThumbnailPrintMaster(
  source: Buffer,
  suppliedOptions: PrintMasterOptions = {},
): Promise<PrintMasterResult> {
  const options: Required<PrintMasterOptions> = {
    width: suppliedOptions.width ?? THUMBNAIL_PRINT_MASTER_WIDTH_PX,
    height: suppliedOptions.height ?? THUMBNAIL_PRINT_MASTER_HEIGHT_PX,
    density: suppliedOptions.density ?? 300,
    sideMarginPercent: suppliedOptions.sideMarginPercent ?? 7.5,
    topMarginPercent: suppliedOptions.topMarginPercent ?? 15,
    bottomMarginPercent: suppliedOptions.bottomMarginPercent ?? 15,
  };
  validateOptions(options);

  const metadata = await sharp(source, { failOn: 'error' }).metadata();
  if (!metadata.width || !metadata.height) throw new Error('The source illustration dimensions could not be read.');
  if (!metadata.hasAlpha) {
    throw new Error('The source illustration has no alpha channel. Supply a genuinely transparent PNG.');
  }

  const croppedSource = await cropToAlphaBounds(source);
  const sourceFillsCanvas = croppedSource.bounds.width === metadata.width
    && croppedSource.bounds.height === metadata.height;
  if (sourceFillsCanvas) {
    throw new Error('The source illustration has no transparent outer padding. Supply a genuinely transparent PNG.');
  }

  const minimumSideMargin = Math.ceil((options.sideMarginPercent / 100) * options.width);
  const minimumTopMargin = Math.ceil((options.topMarginPercent / 100) * options.height);
  const minimumBottomMargin = Math.ceil((options.bottomMarginPercent / 100) * options.height);
  const safeWidth = options.width - (2 * minimumSideMargin);
  const safeHeight = options.height - minimumTopMargin - minimumBottomMargin;
  if (safeWidth < 1 || safeHeight < 1) throw new Error('The configured print-master margins leave no space for the illustration.');

  const scale = Math.min(
    safeWidth / croppedSource.bounds.width,
    safeHeight / croppedSource.bounds.height,
  );
  const resizedWidth = Math.max(1, Math.floor(croppedSource.bounds.width * scale));
  const resizedHeight = Math.max(1, Math.floor(croppedSource.bounds.height * scale));
  const resized = await sharp(croppedSource.buffer, { failOn: 'error' })
    .resize({
      width: resizedWidth,
      height: resizedHeight,
      fit: 'fill',
      kernel: sharp.kernel.lanczos3,
    })
    .toColourspace('srgb')
    .ensureAlpha()
    .png()
    .toBuffer();

  // Lanczos resampling can add a fully transparent outer pixel. Re-measure and
  // remove only that transparent padding before calculating the final centre.
  const croppedResized = await cropToAlphaBounds(resized);
  if (croppedResized.bounds.width > safeWidth || croppedResized.bounds.height > safeHeight) {
    throw new Error('The resized illustration exceeds the configured safe area.');
  }

  const left = Math.floor((options.width - croppedResized.bounds.width) / 2);
  const top = Math.floor((options.height - croppedResized.bounds.height) / 2);
  const buffer = await sharp({
    create: {
      width: options.width,
      height: options.height,
      channels: 4,
      background: { r: 0, g: 0, b: 0, alpha: 0 },
    },
  })
    .composite([{ input: croppedResized.buffer, left, top }])
    .toColourspace('srgb')
    .png({ compressionLevel: 9 })
    .withMetadata({ density: options.density })
    .toBuffer();

  const outputMetadata = await sharp(buffer, { failOn: 'error' }).metadata();
  if (outputMetadata.width !== options.width || outputMetadata.height !== options.height || !outputMetadata.hasAlpha) {
    throw new Error('The exported print master failed its dimensions or transparency verification.');
  }
  const finalBounds = await alphaBounds(buffer);
  if (!finalBounds) throw new Error('The exported print master is fully transparent.');
  const margins = {
    left: finalBounds.left,
    right: options.width - finalBounds.right,
    top: finalBounds.top,
    bottom: options.height - finalBounds.bottom,
  };
  if (
    margins.left < minimumSideMargin
    || margins.right < minimumSideMargin
    || margins.top < minimumTopMargin
    || margins.bottom < minimumBottomMargin
    || Math.abs(margins.left - margins.right) > 1
    || Math.abs(margins.top - margins.bottom) > 1
  ) {
    throw new Error('The exported print master failed its safe-margin or centring verification.');
  }

  return {
    buffer,
    width: options.width,
    height: options.height,
    density: options.density,
    artworkWidth: finalBounds.width,
    artworkHeight: finalBounds.height,
    upscaled: scale > 1,
    margins,
  };
}
