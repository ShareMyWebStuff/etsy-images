import { describe, expect, it } from 'vitest';
import { selectEtsyDigitalDownloadPdf } from '@/lib/local-listings';

describe('Etsy digital download file selection', () => {
  it('selects only the generated Digital Download PDF', () => {
    const files = [
      { id: 1, rawJson: { printableRatio: '2x3' }, name: 'artwork-2x3.jpg' },
      { id: 2, rawJson: { kind: 'dropbox_instruction_pdf' }, name: 'DownloadInstructions.pdf' },
      { id: 3, rawJson: { printableRatio: '4x5' }, name: 'artwork-4x5.jpg' },
    ];

    expect(selectEtsyDigitalDownloadPdf(files)).toEqual([files[1]]);
  });

  it('returns one PDF when duplicate generated records exist', () => {
    const files = [
      { id: 1, rawJson: { kind: 'dropbox_instruction_pdf' } },
      { id: 2, rawJson: { dropboxSharedUrl: 'https://dropbox.example/download' } },
    ];

    expect(selectEtsyDigitalDownloadPdf(files)).toEqual([files[0]]);
  });
});
