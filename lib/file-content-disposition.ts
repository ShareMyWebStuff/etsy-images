/** Keep response headers ASCII while preserving the original filename in UTF-8. */
export function fileContentDisposition(disposition: 'inline' | 'attachment', fileName: string) {
  const name = fileName.replace(/[\u0000-\u001f\u007f]/g, '').trim() || 'download';
  const fallback = name.replace(/[^\x20-\x7e]|["\\]/g, '_');
  const encoded = encodeURIComponent(name).replace(/['()*]/g, (character) => (
    `%${character.charCodeAt(0).toString(16).toUpperCase()}`
  ));
  return `${disposition}; filename="${fallback}"; filename*=UTF-8''${encoded}`;
}
