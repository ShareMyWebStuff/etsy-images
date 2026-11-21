import type { TemplateOpeningCorners } from '@/lib/our-category-template-composite';

export const CORNER_KEYS = ['topLeft', 'topRight', 'bottomRight', 'bottomLeft'] as const;
export const CORNER_LABELS = ['Top left', 'Top right', 'Bottom right', 'Bottom left'] as const;

export function polygonPoints(corners: TemplateOpeningCorners) {
  return CORNER_KEYS.map((key) => `${corners[key].x},${corners[key].y}`).join(' ');
}

// A projective transform from a unit square to a scene quadrilateral. CSS uses
// the same four-corner mapping as the server's perspective compositor.
function projective(corners: TemplateOpeningCorners) {
  const [a, b, c, d] = CORNER_KEYS.map((key) => corners[key]);
  const sx = a.x - b.x + c.x - d.x;
  const sy = a.y - b.y + c.y - d.y;
  const dx1 = b.x - c.x;
  const dx2 = d.x - c.x;
  const dy1 = b.y - c.y;
  const dy2 = d.y - c.y;
  const det = dx1 * dy2 - dx2 * dy1;
  const g = Math.abs(det) < 1e-10 ? 0 : (sx * dy2 - dx2 * sy) / det;
  const h = Math.abs(det) < 1e-10 ? 0 : (dx1 * sy - sx * dy1) / det;
  return [b.x - a.x + g * b.x, d.x - a.x + h * d.x, a.x, b.y - a.y + g * b.y, d.y - a.y + h * d.y, a.y, g, h, 1];
}

export function paperCssTransform(corners: TemplateOpeningCorners) {
  const [a, b, c, d, e, f, g, h] = projective(corners);
  return `matrix3d(${a},${d},0,${g},${b},${e},0,${h},0,0,1,0,${c},${f},0,1)`;
}

export function scenePointToOpening(corners: TemplateOpeningCorners, point: { x: number; y: number }) {
  const [a, b, c, d, e, f, g, h] = projective(corners);
  const m00 = a - point.x * g;
  const m01 = b - point.x * h;
  const m10 = d - point.y * g;
  const m11 = e - point.y * h;
  const determinant = m00 * m11 - m01 * m10;
  if (Math.abs(determinant) < 1e-10) return { x: 0, y: 0 };
  const px = point.x - c;
  const py = point.y - f;
  return { x: (px * m11 - m01 * py) / determinant, y: (m00 * py - px * m10) / determinant };
}

export function pointInsideOpening(corners: TemplateOpeningCorners, point: { x: number; y: number }) {
  const p = scenePointToOpening(corners, point);
  return p.x >= 0 && p.x <= 1 && p.y >= 0 && p.y <= 1;
}
