import { afterEach, describe, expect, it, vi } from 'vitest';
import { prepareClipboardImage } from '@/lib/browser-personalisation';

describe('personalisation clipboard image', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('returns a lossless PNG at the exact dimensions used by prompt measurement', async () => {
    const close = vi.fn();
    vi.stubGlobal('createImageBitmap', vi.fn().mockResolvedValue({ width: 3000, height: 4000, close }));
    const drawImage = vi.fn();
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue({ drawImage } as unknown as CanvasRenderingContext2D);
    vi.spyOn(HTMLCanvasElement.prototype, 'toBlob').mockImplementation((callback, type) => {
      callback(new Blob(['png'], { type: type ?? 'image/png' }));
    });

    const prepared = await prepareClipboardImage(new Blob(['source'], { type: 'image/jpeg' }));

    expect([prepared.width, prepared.height]).toEqual([3000, 4000]);
    expect(prepared.blob.type).toBe('image/png');
    expect(drawImage).toHaveBeenCalledOnce();
    expect(close).toHaveBeenCalledOnce();
  });
});
