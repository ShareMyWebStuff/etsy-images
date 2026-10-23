import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { defaultTemplateGridLayout } from '@/lib/template-grid-layout';
import { TemplateGridAreaEditor } from './TemplateGridAreaEditor';

describe('TemplateGridAreaEditor', () => {
  it('shows saved artwork areas immediately when editing an existing template image', () => {
    const grid = defaultTemplateGridLayout(1);
    grid.cells[0] = { ...grid.cells[0], configured: true };

    render(<TemplateGridAreaEditor
      imageUrl="/api/our-categories/templates/59/image"
      initialImageSize={{ width: 1254, height: 1254 }}
      regions={[{
        id: 'saved-area',
        name: 'Area 1',
        corners: {
          topLeft: { x: 178, y: 65 },
          topRight: { x: 1004, y: 65 },
          bottomRight: { x: 1004, y: 1147 },
          bottomLeft: { x: 178, y: 1147 },
        },
        grid,
      }]}
      onImageSize={vi.fn()}
      onRegionsChange={vi.fn()}
      onEditRegion={vi.fn()}
      onEditCell={vi.fn()}
      onRequestDeleteRegion={vi.fn()}
      onRemoveImage={vi.fn()}
    />);

    expect(screen.getByRole('button', { name: 'Edit Area 1' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Edit Area 1 Image 1' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Resize Area 1 from se' })).toBeTruthy();
  });
});
