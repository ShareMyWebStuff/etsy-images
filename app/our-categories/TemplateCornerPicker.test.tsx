import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { TemplateCornerPicker } from './TemplateCornerPicker';

describe('Template corner picker', () => {
  it('captures four points in original-image pixels and allows keyboard adjustment', () => {
    const onRegionsChange = vi.fn();
    const onImageSize = vi.fn();
    render(
      <TemplateCornerPicker
        imageUrl="blob:template"
        initialRegions={[]}
        onRegionsChange={onRegionsChange}
        onImageSize={onImageSize}
      />,
    );

    const image = screen.getByRole('img', { name: 'Template corner selection' }) as HTMLImageElement;
    Object.defineProperty(image, 'naturalWidth', { configurable: true, value: 1000 });
    Object.defineProperty(image, 'naturalHeight', { configurable: true, value: 800 });
    image.getBoundingClientRect = () => ({
      x: 10,
      y: 20,
      left: 10,
      top: 20,
      right: 510,
      bottom: 420,
      width: 500,
      height: 400,
      toJSON: () => ({}),
    });
    fireEvent.load(image);
    expect(onImageSize).toHaveBeenCalledWith({ width: 1000, height: 800 });

    const picker = image.parentElement!;
    fireEvent.click(screen.getByRole('button', { name: 'Add area' }));
    fireEvent.click(picker, { clientX: 60, clientY: 70 });
    fireEvent.click(picker, { clientX: 460, clientY: 70 });
    fireEvent.click(picker, { clientX: 460, clientY: 370 });
    fireEvent.click(picker, { clientX: 60, clientY: 370 });

    expect(onRegionsChange).toHaveBeenLastCalledWith([
      expect.objectContaining({
        name: 'Area 1',
        corners: {
          topLeft: { x: 100, y: 100 },
          topRight: { x: 900, y: 100 },
          bottomRight: { x: 900, y: 700 },
          bottomLeft: { x: 100, y: 700 },
        },
      }),
    ]);

    fireEvent.keyDown(screen.getByRole('button', { name: 'Area 1 top left opening corner' }), { key: 'ArrowRight' });
    expect(onRegionsChange).toHaveBeenLastCalledWith([
      expect.objectContaining({
        name: 'Area 1',
        corners: {
          topLeft: { x: 101, y: 100 },
          topRight: { x: 900, y: 100 },
          bottomRight: { x: 900, y: 700 },
          bottomLeft: { x: 100, y: 700 },
        },
      }),
    ]);
  });

  it('shows a five-times magnifier while hovering', () => {
    render(
      <TemplateCornerPicker
        imageUrl="blob:template"
        initialRegions={[]}
        onRegionsChange={() => undefined}
        onImageSize={() => undefined}
      />,
    );
    const image = screen.getByRole('img', { name: 'Template corner selection' }) as HTMLImageElement;
    Object.defineProperty(image, 'naturalWidth', { configurable: true, value: 1000 });
    Object.defineProperty(image, 'naturalHeight', { configurable: true, value: 800 });
    image.getBoundingClientRect = () => ({
      x: 0,
      y: 0,
      left: 0,
      top: 0,
      right: 500,
      bottom: 400,
      width: 500,
      height: 400,
      toJSON: () => ({}),
    });
    fireEvent.load(image);
    fireEvent.pointerMove(image.parentElement!, { clientX: 250, clientY: 200 });
    const magnifier = image.parentElement!.querySelector('[aria-hidden="true"][style*="background-image"]') as HTMLElement;
    expect(magnifier.style.backgroundSize).toBe('5000px 4000px');
  });

  it('offers a trash action to remove the image and start again', () => {
    const onRemoveImage = vi.fn();
    render(
      <TemplateCornerPicker
        imageUrl="blob:template"
        initialRegions={[]}
        onRegionsChange={() => undefined}
        onImageSize={() => undefined}
        onRemoveImage={onRemoveImage}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: 'Remove template image' }));
    expect(onRemoveImage).toHaveBeenCalledOnce();
  });

  it('shows all configured areas and deletes an individual area', () => {
    const onRegionsChange = vi.fn();
    const corners = {
      topLeft: { x: 10, y: 10 },
      topRight: { x: 40, y: 10 },
      bottomRight: { x: 40, y: 40 },
      bottomLeft: { x: 10, y: 40 },
    };
    render(
      <TemplateCornerPicker
        imageUrl="blob:template"
        initialRegions={[
          { id: 'first', name: 'Area 1', corners },
          { id: 'second', name: 'Area 2', corners: {
            topLeft: { x: 50, y: 50 },
            topRight: { x: 80, y: 50 },
            bottomRight: { x: 80, y: 80 },
            bottomLeft: { x: 50, y: 80 },
          } },
        ]}
        onRegionsChange={onRegionsChange}
        onImageSize={() => undefined}
      />,
    );

    expect(screen.getByRole('button', { name: 'Area 1' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Area 2' })).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Delete Area 2' }));
    expect(onRegionsChange).toHaveBeenLastCalledWith([{ id: 'first', name: 'Area 1', corners }]);
    expect(screen.queryByRole('button', { name: 'Area 2' })).toBeNull();
  });

  it('assigns an image item and text settings to a multiple-template area', () => {
    const onRegionsChange = vi.fn();
    const region = {
      id: 'first',
      name: 'Area 1',
      corners: {
        topLeft: { x: 10, y: 10 },
        topRight: { x: 40, y: 10 },
        bottomRight: { x: 40, y: 40 },
        bottomLeft: { x: 10, y: 40 },
      },
      imageItemNumber: 1,
      topText: '',
      bottomText: '',
      fontId: 'nunito-semibold',
    };
    render(
      <TemplateCornerPicker
        imageUrl="blob:template"
        initialRegions={[region]}
        multipleItemCount={6}
        onRegionsChange={onRegionsChange}
        onImageSize={() => undefined}
      />,
    );
    fireEvent.change(screen.getByLabelText('Area 1 image item number'), { target: { value: '6' } });
    expect(onRegionsChange).toHaveBeenLastCalledWith([expect.objectContaining({ imageItemNumber: 6 })]);
    fireEvent.change(screen.getByLabelText('Area 1 top text'), { target: { value: 'Top line' } });
    expect(onRegionsChange).toHaveBeenLastCalledWith([expect.objectContaining({ topText: 'Top line' })]);
    expect(screen.getByLabelText('Area 1 font')).toBeTruthy();
  });
});
