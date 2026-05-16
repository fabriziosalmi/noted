function isAbsolutePath(p: string): boolean {
  // Covers Unix (/foo) and Windows (C:\foo or C:/foo) absolute paths
  return p.startsWith('/') || /^[A-Za-z]:[/\\]/.test(p);
}

export function validateFileName(fileName: unknown): asserts fileName is string {
  if (!fileName || typeof fileName !== 'string') throw new Error('File name must be a non-empty string');
  if (isAbsolutePath(fileName)) throw new Error('Absolute paths are not allowed');
  if (fileName.includes('..')) throw new Error('Path traversal is not allowed');
  if (!/^[\w\- .()]+\.md$/.test(fileName)) throw new Error('Invalid file name: only alphanumeric, spaces, hyphens, underscores, parentheses and .md extension allowed');
}

export function stripUnsafeHtml(html: string): string {
  // Decode numeric HTML entities first so encoded payloads (&#x3C;script&#x3E;) are caught
  const decoded = html
    .replace(/&#x([0-9a-f]+);/gi, (_, hex: string) => String.fromCharCode(parseInt(hex, 16)))
    .replace(/&#([0-9]+);/gi, (_, dec: string) => String.fromCharCode(parseInt(dec, 10)));

  return decoded
    .replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, '')
    .replace(/<iframe\b[^<]*(?:(?!<\/iframe>)<[^<]*)*<\/iframe>/gi, '')
    .replace(/<object\b[^<]*(?:(?!<\/object>)<[^<]*)*<\/object>/gi, '')
    .replace(/<embed\b[^>]*>/gi, '')
    .replace(/\son\w+\s*=\s*(?:"[^"]*"|'[^']*'|[^\s>]*)/gi, '')
    .replace(/javascript\s*:/gi, '');
}
