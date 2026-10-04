declare module 'fontkit' {
  export type FontkitGlyph = {
    bbox: { minX: number; minY: number; maxX: number; maxY: number };
    path: { toSVG(): string };
  };

  export type FontkitPosition = {
    xAdvance: number;
    yAdvance: number;
    xOffset: number;
    yOffset: number;
  };

  export type FontkitRun = {
    glyphs: FontkitGlyph[];
    positions: FontkitPosition[];
    advanceWidth: number;
  };

  export type FontkitFont = {
    familyName: string;
    fullName: string;
    postscriptName: string;
    unitsPerEm: number;
    variationAxes?: Record<string, unknown>;
    getVariation?(axes: Record<string, number>): FontkitFont;
    layout(text: string): FontkitRun;
  };

  export function create(buffer: Uint8Array): FontkitFont;
}
