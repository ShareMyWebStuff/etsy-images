import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { ListingTemplateProductSettings } from './ListingTemplateProductSettings';

const template = {
  printsFrames: true, customisePrints: true, digitalDownload: true,
  customTop: true, customBottom: true,
};

describe('listing template product checkboxes', () => {
  it('shows saved listing overrides and allows a template-enabled option to be restored', async () => {
    const onChange = vi.fn();
    render(<ListingTemplateProductSettings
      template={template}
      listing={{ printsFramesOverride: false, digitalDownloadOverride: false, customisePrints: false }}
      saving={false}
      onChange={onChange}
    />);
    const prints = screen.getByRole('checkbox', { name: 'Print / Frames' }) as HTMLInputElement;
    expect(prints.checked).toBe(false);
    expect((screen.getByRole('checkbox', { name: 'Customised Prints' }) as HTMLInputElement).checked).toBe(false);
    expect((screen.getByRole('checkbox', { name: 'Digital Downloads' }) as HTMLInputElement).checked).toBe(false);
    await userEvent.click(prints);
    expect(onChange).toHaveBeenCalledWith('printsFrames', true);
  });

  it('locks all template-disabled options off, even with enabled listing values', async () => {
    const onChange = vi.fn();
    render(<ListingTemplateProductSettings
      template={{ ...template, printsFrames: false, customisePrints: false, digitalDownload: false }}
      listing={{ printsFramesOverride: true, digitalDownloadOverride: true, customisePrints: true }}
      saving={false}
      onChange={onChange}
    />);
    for (const checkbox of screen.getAllByRole('checkbox') as HTMLInputElement[]) {
      expect(checkbox.checked).toBe(false);
      expect(checkbox.disabled).toBe(true);
      await userEvent.click(checkbox);
    }
    expect(onChange).not.toHaveBeenCalled();
  });

  it('locks options while saving and when no template is assigned', () => {
    const { rerender } = render(<ListingTemplateProductSettings
      template={template} listing={{}} saving onChange={vi.fn()}
    />);
    expect(screen.getAllByRole('checkbox').every((input) => (input as HTMLInputElement).disabled)).toBe(true);
    rerender(<ListingTemplateProductSettings template={null} listing={{}} saving={false} onChange={vi.fn()} />);
    expect(screen.getAllByRole('checkbox').every((input) => (input as HTMLInputElement).disabled)).toBe(true);
  });
});
