import type { PersonalisationFont } from '@/lib/personalisation-fonts';

const loadedFontIds = new Set<string>();
const fontLoads = new Map<string, Promise<void>>();

export async function loadBundledPersonalisationFont(font: PersonalisationFont) {
  if (loadedFontIds.has(font.id)) return;
  const existingLoad = fontLoads.get(font.id);
  if (existingLoad) return existingLoad;

  const load = (async () => {
    if (typeof FontFace === 'undefined' || !document.fonts) {
      throw new Error('This browser cannot load the selected font for the prompt.');
    }
    const face = new FontFace(font.family, `url(${JSON.stringify(font.assetPath)})`, {
      style: 'normal',
      weight: String(font.weight),
    });
    const loadedFace = await face.load();
    document.fonts.add(loadedFace);
    await document.fonts.load(`${font.weight} 16px ${JSON.stringify(font.family)}`, 'Personalisation');
    if (loadedFace.status !== 'loaded') throw new Error(`${font.displayName} could not be loaded.`);
    loadedFontIds.add(font.id);
  })().catch((error) => {
    fontLoads.delete(font.id);
    throw new Error(error instanceof Error ? `Unable to load ${font.displayName}: ${error.message}` : `Unable to load ${font.displayName}.`);
  });
  fontLoads.set(font.id, load);
  return load;
}

export type PreparedClipboardImage = {
  blob: Blob;
  width: number;
  height: number;
};

export async function prepareClipboardImage(source: Blob): Promise<PreparedClipboardImage> {
  const bitmap = await createImageBitmap(source);
  try {
    const canvas = document.createElement('canvas');
    canvas.width = bitmap.width;
    canvas.height = bitmap.height;
    const context = canvas.getContext('2d');
    if (!context) throw new Error('Unable to prepare the thumbnail for the clipboard.');
    context.drawImage(bitmap, 0, 0);
    const blob = await new Promise<Blob>((resolve, reject) => {
      canvas.toBlob((value) => {
        if (value) resolve(value);
        else reject(new Error('Unable to prepare the thumbnail for the clipboard.'));
      }, 'image/png');
    });
    return { blob, width: bitmap.width, height: bitmap.height };
  } finally {
    bitmap.close();
  }
}
