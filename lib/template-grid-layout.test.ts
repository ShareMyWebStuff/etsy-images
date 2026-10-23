import { describe, expect, it } from 'vitest';

import {
  defaultTemplateGridLayout,
  resizeTemplateGridLayout,
  templateGridCellRects,
  validateTemplateGridLayout,
} from './template-grid-layout';

describe('template grid layouts', () => {
  it('creates enough rows and columns for every configured image', () => {
    const layout = defaultTemplateGridLayout(6);
    expect(layout.rows).toBe(3);
    expect(layout.columns).toBe(2);
    expect(layout.cells).toHaveLength(6);
    expect(validateTemplateGridLayout(layout, 1)).toEqual(layout);
  });

  it('uses the same border and frame defaults as the listing preview and tester', () => {
    const cell = defaultTemplateGridLayout(1).cells[0];

    expect(cell).toMatchObject({
      borderEnabled: false,
      borderSizePercent: 5,
      frameEnabled: false,
      frameFinish: 'unframed',
      frameThicknessPercent: 4,
      frameDepthPercent: 1,
      shadowStrength: 17,
    });
  });

  it('preserves cell settings when the image count changes', () => {
    const initial = defaultTemplateGridLayout(2);
    initial.cells[0].frameEnabled = true;
    const resized = resizeTemplateGridLayout(initial, 4);
    expect(resized.cells).toHaveLength(4);
    expect(resized.cells[0].frameEnabled).toBe(true);
  });

  it('removes settings for images that no longer exist when the image count decreases', () => {
    const initial = defaultTemplateGridLayout(4);
    initial.cells[2] = { ...initial.cells[2], topText: 'Third', configured: true };
    initial.cells[3] = { ...initial.cells[3], topText: 'Fourth', configured: true };

    const resized = resizeTemplateGridLayout(initial, 2);

    expect(resized.imageCount).toBe(2);
    expect(resized.cells).toHaveLength(2);
    expect(resized.cells.some((cell) => cell.topText === 'Third' || cell.topText === 'Fourth')).toBe(false);
  });

  it('requires newly-added images to be completed individually', () => {
    const initial = defaultTemplateGridLayout(1);
    initial.cells[0].configured = true;

    const resized = resizeTemplateGridLayout(initial, 2);

    expect(resized.cells[0].configured).toBe(true);
    expect(resized.cells[1].configured).toBe(false);
  });

  it('fits every ratio inside a grid cell and leaves the configured gaps', () => {
    const layout = defaultTemplateGridLayout(2);
    layout.rows = 1;
    layout.columns = 2;
    layout.horizontalGapPercent = 10;
    layout.cells[1] = { ...layout.cells[1], ratio: '4x5', orientation: 'landscape' };
    const cells = templateGridCellRects(1000, 500, layout);
    expect(cells).toHaveLength(2);
    expect(cells[0].x + cells[0].width).toBeLessThan(cells[1].x);
    expect(cells[0].height).toBeLessThanOrEqual(500);
    expect(cells[1].width).toBeLessThanOrEqual(500);
  });

  it('rejects grids that cannot hold every image', () => {
    const layout = defaultTemplateGridLayout(6);
    expect(() => validateTemplateGridLayout({ ...layout, rows: 1, columns: 2 }, 1)).toThrow(/enough cells/);
  });
});
