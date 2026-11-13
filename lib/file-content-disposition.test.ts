import { describe, expect, it } from 'vitest';

import { fileContentDisposition } from './file-content-disposition';

describe('fileContentDisposition', () => {
  it('preserves ASCII filenames and the requested disposition', () => {
    expect(fileContentDisposition('attachment', 'print guide.png')).toBe(
      'attachment; filename="print guide.png"; filename*=UTF-8\'\'print%20guide.png',
    );
  });

  it('makes Unicode filenames safe for response headers without losing their names', () => {
    const header = fileContentDisposition('inline', 'How to Print Children’s Wall Art 日本語.png');
    expect(() => new Response(null, { headers: { 'Content-Disposition': header } })).not.toThrow();
    expect(header).toContain('filename="How to Print Children_s Wall Art ___.png"');
    expect(header).toContain(`filename*=UTF-8''${encodeURIComponent('How to Print Children’s Wall Art 日本語.png')}`);
    expect(header).toMatch(/^[\x20-\x7e]+$/);
  });

  it('removes controls and protects quoted and extended filename parameters', () => {
    const header = fileContentDisposition('inline', 'guide"\\\r\n\u0000\u007f\'(1).png');
    expect(header).toBe('inline; filename="guide__\'(1).png"; filename*=UTF-8\'\'guide%22%5C%27%281%29.png');
    expect(() => new Headers({ 'Content-Disposition': header })).not.toThrow();
  });

  it('provides a filename for an empty or control-only name', () => {
    expect(fileContentDisposition('inline', '\r\n ')).toContain('filename="download"');
  });
});
