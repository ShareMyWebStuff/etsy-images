export type MockupRatio = 'iso-a' | '2x3' | '3x4' | '4x5' | '11x14' | '5x7';
export type MockupOrientation = 'portrait' | 'landscape';
export type MockupFrameFinish = 'unframed' | 'black' | 'white' | 'oak';
export type MockupPlacement = { x: number; y: number; width: number; height: number };
export type MockupPoint = { x: number; y: number };
export type MockupResizeCorner = 'top-left' | 'top-right' | 'bottom-right' | 'bottom-left';

export const MOCKUP_RATIO_OPTIONS: ReadonlyArray<{ key: MockupRatio; label: string; width: number; height: number }> = [
  { key: 'iso-a', label: 'ISO A', width: 1, height: Math.SQRT2 },
  { key: '2x3', label: '2:3', width: 2, height: 3 },
  { key: '3x4', label: '3:4', width: 3, height: 4 },
  { key: '4x5', label: '4:5', width: 4, height: 5 },
  { key: '11x14', label: '11:14', width: 11, height: 14 },
  { key: '5x7', label: '5:7', width: 5, height: 7 },
];

function finite(value: number, fallback: number) {
  return Number.isFinite(value) ? value : fallback;
}

function clamp(value: number, minimum: number, maximum: number) {
  return Math.max(minimum, Math.min(maximum, value));
}

export function mockupWidthHeightRatio(ratio: MockupRatio, orientation: MockupOrientation) {
  const spec = MOCKUP_RATIO_OPTIONS.find((candidate) => candidate.key === ratio);
  if (!spec) throw new Error('Choose a valid print ratio.');
  return orientation === 'portrait' ? spec.width / spec.height : spec.height / spec.width;
}

export function mockupHeightForWidth(width: number, ratio: MockupRatio, orientation: MockupOrientation) {
  const resolvedWidth = Math.max(1, Math.round(finite(width, 1)));
  if (ratio === 'iso-a') {
    return orientation === 'portrait'
      ? Math.round(resolvedWidth * Math.SQRT2)
      : Math.round(resolvedWidth / Math.SQRT2);
  }
  return Math.max(1, Math.round(resolvedWidth / mockupWidthHeightRatio(ratio, orientation)));
}

export function mockupFrameGeometry(
  placement: MockupPlacement,
  finish: MockupFrameFinish,
  thicknessPercent: number,
  shadowStrength: number,
  depthPercent = 3,
) {
  const shortEdge = Math.max(1, Math.min(placement.width, placement.height));
  const frameThickness = finish === 'unframed'
    ? 0
    : Math.max(1, Math.round(shortEdge * clamp(finite(thicknessPercent, 5), 2, 12) / 100));
  const frameDepth = finish === 'unframed'
    ? 0
    : Math.max(0, Math.round(shortEdge * clamp(finite(depthPercent, 3), 0, 5) / 100));
  const depthX = Math.round(frameDepth * 0.46);
  const depthY = Math.round(frameDepth * 0.75);
  const resolvedShadowStrength = clamp(finite(shadowStrength, 10), 0, 25);
  const shadowBlur = resolvedShadowStrength === 0
    ? 0
    : Math.max(1, Math.round(shortEdge * resolvedShadowStrength / 650));
  const shadowOffsetX = resolvedShadowStrength === 0 ? 0 : Math.round(shadowBlur * 0.42);
  const shadowOffsetY = resolvedShadowStrength === 0 ? 0 : Math.round(shadowBlur * 0.72);
  const safety = frameThickness + Math.max(depthX, depthY) + shadowBlur
    + Math.max(Math.abs(shadowOffsetX), Math.abs(shadowOffsetY)) + 2;
  const outer = {
    x: placement.x - frameThickness,
    y: placement.y - frameThickness,
    width: placement.width + (frameThickness * 2),
    height: placement.height + (frameThickness * 2),
  };
  return {
    frameThickness,
    frameDepth,
    depthX,
    depthY,
    shadowBlur,
    shadowOffset: shadowOffsetY,
    shadowOffsetX,
    shadowOffsetY,
    safety,
    outer,
    backOuter: {
      x: outer.x + depthX,
      y: outer.y + depthY,
      width: outer.width,
      height: outer.height,
    },
  };
}

export function constrainMockupPlacement(
  preferred: Pick<MockupPlacement, 'x' | 'y' | 'width'>,
  backgroundWidth: number,
  backgroundHeight: number,
  ratio: MockupRatio,
  orientation: MockupOrientation,
  finish: MockupFrameFinish,
  thicknessPercent: number,
  shadowStrength: number,
  depthPercent = 3,
): MockupPlacement {
  const canvasWidth = Math.max(1, Math.round(finite(backgroundWidth, 1)));
  const canvasHeight = Math.max(1, Math.round(finite(backgroundHeight, 1)));
  let width = clamp(Math.round(finite(preferred.width, canvasWidth / 4)), 1, canvasWidth);

  for (let attempt = 0; attempt < 8; attempt += 1) {
    const height = mockupHeightForWidth(width, ratio, orientation);
    const draft = { x: 0, y: 0, width, height };
    const { safety } = mockupFrameGeometry(draft, finish, thicknessPercent, shadowStrength, depthPercent);
    const widthScale = (canvasWidth - (safety * 2)) / width;
    const heightScale = (canvasHeight - (safety * 2)) / height;
    const scale = Math.min(1, widthScale, heightScale);
    if (scale >= 1) break;
    width = Math.max(1, Math.floor(width * Math.max(0.1, scale)));
  }

  const height = mockupHeightForWidth(width, ratio, orientation);
  const draft = { x: 0, y: 0, width, height };
  const { safety } = mockupFrameGeometry(draft, finish, thicknessPercent, shadowStrength, depthPercent);
  const maximumX = Math.max(safety, canvasWidth - safety - width);
  const maximumY = Math.max(safety, canvasHeight - safety - height);
  return {
    x: Math.round(clamp(finite(preferred.x, safety), safety, maximumX)),
    y: Math.round(clamp(finite(preferred.y, safety), safety, maximumY)),
    width,
    height,
  };
}

export function defaultMockupPlacement(
  backgroundWidth: number,
  backgroundHeight: number,
  ratio: MockupRatio,
  orientation: MockupOrientation,
  finish: MockupFrameFinish,
  thicknessPercent: number,
  shadowStrength: number,
  depthPercent = 3,
) {
  const width = Math.max(1, Math.round(backgroundWidth * (orientation === 'portrait' ? 0.24 : 0.34)));
  const height = mockupHeightForWidth(width, ratio, orientation);
  return constrainMockupPlacement({
    x: (backgroundWidth - width) / 2,
    y: (backgroundHeight - height) / 2,
    width,
  }, backgroundWidth, backgroundHeight, ratio, orientation, finish, thicknessPercent, shadowStrength, depthPercent);
}

export function mockupPlacementFromDrag(
  start: MockupPoint,
  end: MockupPoint,
  backgroundWidth: number,
  backgroundHeight: number,
  ratio: MockupRatio,
  orientation: MockupOrientation,
  finish: MockupFrameFinish,
  thicknessPercent: number,
  shadowStrength: number,
  depthPercent = 3,
) {
  const ratioValue = mockupWidthHeightRatio(ratio, orientation);
  const width = Math.max(Math.abs(end.x - start.x), Math.abs(end.y - start.y) * ratioValue);
  const height = mockupHeightForWidth(width, ratio, orientation);
  return constrainMockupPlacement({
    x: end.x >= start.x ? start.x : start.x - width,
    y: end.y >= start.y ? start.y : start.y - height,
    width,
  }, backgroundWidth, backgroundHeight, ratio, orientation, finish, thicknessPercent, shadowStrength, depthPercent);
}

export function resizeMockupPlacement(
  placement: MockupPlacement,
  corner: MockupResizeCorner,
  pointer: MockupPoint,
  backgroundWidth: number,
  backgroundHeight: number,
  ratio: MockupRatio,
  orientation: MockupOrientation,
  finish: MockupFrameFinish,
  thicknessPercent: number,
  shadowStrength: number,
  depthPercent = 3,
) {
  const left = corner === 'top-left' || corner === 'bottom-left';
  const top = corner === 'top-left' || corner === 'top-right';
  const anchor = {
    x: left ? placement.x + placement.width : placement.x,
    y: top ? placement.y + placement.height : placement.y,
  };
  const ratioValue = mockupWidthHeightRatio(ratio, orientation);
  const horizontalWidth = Math.abs(pointer.x - anchor.x);
  const verticalWidth = Math.abs(pointer.y - anchor.y) * ratioValue;
  const width = Math.max(8, Math.max(horizontalWidth, verticalWidth));
  const height = mockupHeightForWidth(width, ratio, orientation);
  return constrainMockupPlacement({
    x: left ? anchor.x - width : anchor.x,
    y: top ? anchor.y - height : anchor.y,
    width,
  }, backgroundWidth, backgroundHeight, ratio, orientation, finish, thicknessPercent, shadowStrength, depthPercent);
}

export function displayPointToImagePoint(
  clientX: number,
  clientY: number,
  bounds: Pick<DOMRect, 'left' | 'top' | 'width' | 'height'>,
  imageWidth: number,
  imageHeight: number,
): MockupPoint {
  if (bounds.width <= 0 || bounds.height <= 0) return { x: 0, y: 0 };
  return {
    x: Math.round(clamp((clientX - bounds.left) / bounds.width, 0, 1) * imageWidth),
    y: Math.round(clamp((clientY - bounds.top) / bounds.height, 0, 1) * imageHeight),
  };
}

export function mockupExportDimensions(backgroundWidth: number, backgroundHeight: number) {
  if (backgroundWidth <= 0 || backgroundHeight <= 0) throw new Error('The background dimensions are invalid.');
  if (backgroundWidth === backgroundHeight) return { width: 3000, height: 3000 };
  return backgroundWidth > backgroundHeight
    ? { width: 3000, height: Math.round(3000 * backgroundHeight / backgroundWidth) }
    : { width: Math.round(3000 * backgroundWidth / backgroundHeight), height: 3000 };
}

export function scaleMockupPlacementForExport(
  placement: MockupPlacement,
  backgroundWidth: number,
  backgroundHeight: number,
  outputWidth: number,
  outputHeight: number,
  ratio: MockupRatio,
  orientation: MockupOrientation,
  finish: MockupFrameFinish,
  thicknessPercent: number,
  shadowStrength: number,
  depthPercent = 3,
) {
  const scaleX = outputWidth / backgroundWidth;
  const scaleY = outputHeight / backgroundHeight;
  return constrainMockupPlacement({
    x: Math.round(placement.x * scaleX),
    y: Math.round(placement.y * scaleY),
    width: Math.round(placement.width * scaleX),
  }, outputWidth, outputHeight, ratio, orientation, finish, thicknessPercent, shadowStrength, depthPercent);
}

export function containArtwork(
  sourceWidth: number,
  sourceHeight: number,
  opening: MockupPlacement,
) {
  if (sourceWidth <= 0 || sourceHeight <= 0) throw new Error('The artwork dimensions are invalid.');
  const scale = Math.min(opening.width / sourceWidth, opening.height / sourceHeight);
  const width = sourceWidth * scale;
  const height = sourceHeight * scale;
  return {
    x: opening.x + ((opening.width - width) / 2),
    y: opening.y + ((opening.height - height) / 2),
    width,
    height,
  };
}
