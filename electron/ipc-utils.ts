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
  return html
    .replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, '')
    .replace(/\son\w+\s*=\s*(?:"[^"]*"|'[^']*'|[^\s>]*)/gi, '')
    .replace(/<iframe\b[^<]*(?:(?!<\/iframe>)<[^<]*)*<\/iframe>/gi, '');
}
