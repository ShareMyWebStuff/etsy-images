'use client';

import { useEffect, useState } from 'react';

import { rasterizeForegroundMask } from '@/lib/our-template-image-foreground-mask';
import type { OurTemplateImageDefinition } from '@/lib/our-template-image-types';
import { polygonPoints } from './scene-preview';

/** Restore protected original scene pixels over the editor's artwork preview. */
export function ForegroundMaskPreview({ definition, imageUrl, transparentOpeningIds }: {
  definition: OurTemplateImageDefinition;
  imageUrl: string;
  transparentOpeningIds: ReadonlySet<string>;
}) {
  const [maskUrl, setMaskUrl] = useState('');
  useEffect(() => {
    if (!definition.foregroundMask?.strokes.length || !definition.width || !definition.height) { setMaskUrl(''); return; }
    const scale = Math.min(1, 1024 / Math.max(definition.width, definition.height));
    const width = Math.max(1, Math.round(definition.width * scale));
    const height = Math.max(1, Math.round(definition.height * scale));
    const raster = rasterizeForegroundMask(definition.foregroundMask, width, height, { sourceWidth: definition.width, sourceHeight: definition.height });
    const canvas = document.createElement('canvas'); canvas.width = width; canvas.height = height;
    const context = canvas.getContext('2d');
    if (!context) return;
    const pixels = context.createImageData(width, height);
    for (let index = 0; index < raster.alpha.length; index++) {
      pixels.data[index * 4] = pixels.data[index * 4 + 1] = pixels.data[index * 4 + 2] = 255;
      pixels.data[index * 4 + 3] = raster.alpha[index];
    }
    context.putImageData(pixels, 0, 0);
    setMaskUrl(canvas.toDataURL('image/png'));
  }, [definition.foregroundMask, definition.width, definition.height]);
  if (!maskUrl) return null;
  // Transparent openings already show the complete foreground, including its
  // soft pixels; drawing those pixels again would strengthen their shadows.
  const openings = definition.openings.filter((opening) => definition.lightingMode !== 'auto' || !transparentOpeningIds.has(opening.id));
  return <svg viewBox={`0 0 ${definition.width} ${definition.height}`} className="absolute inset-0 h-full w-full" aria-hidden="true">
    <defs>
      <mask id="manual-foreground-mask" maskUnits="userSpaceOnUse" x="0" y="0" width={definition.width} height={definition.height}>
        <image href={maskUrl} width={definition.width} height={definition.height} />
      </mask>
      <clipPath id="manual-foreground-openings">{openings.map((opening) => <polygon key={opening.id} points={polygonPoints(opening.corners)} />)}</clipPath>
    </defs>
    <image href={imageUrl} width={definition.width} height={definition.height} mask="url(#manual-foreground-mask)" clipPath="url(#manual-foreground-openings)" />
  </svg>;
}
