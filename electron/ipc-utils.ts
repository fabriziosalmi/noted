import type TurndownService from 'turndown';

function isAbsolutePath(p: string): boolean {
  // Covers Unix (/foo) and Windows (C:\foo or C:/foo) absolute paths
  return p.startsWith('/') || /^[A-Za-z]:[/\\]/.test(p);
}

export function validateFileName(fileName: unknown): asserts fileName is string {
  if (!fileName || typeof fileName !== 'string') throw new Error('File name must be a non-empty string');
  if (isAbsolutePath(fileName)) throw new Error('Absolute paths are not allowed');
  if (fileName.includes('..')) throw new Error('Path traversal is not allowed');
  // Allow single-level subfolder: "folder/note.md" — no nested slashes
  const segments = fileName.split('/');
  if (segments.length > 2) throw new Error('Only one level of subfolder is allowed');
  for (const seg of segments) {
    if (!/^[\w\- .()]+$/.test(seg.replace(/\.md$/, ''))) {
      throw new Error('Invalid file name: only alphanumeric, spaces, hyphens, underscores, parentheses allowed');
    }
  }
  if (!fileName.endsWith('.md')) throw new Error('File must have .md extension');
}

export function validateFolderName(name: unknown): asserts name is string {
  if (!name || typeof name !== 'string') throw new Error('Folder name must be a non-empty string');
  if (name.includes('..') || name.includes('/') || name.includes('\\')) throw new Error('Invalid folder name');
  if (!/^[\w\- .()]+$/.test(name)) throw new Error('Invalid folder name characters');
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

export function formatAppleNoteToMarkdown(
  title: string,
  body: string,
  creationDate: string | null,
  modificationDate: string | null,
  turndown: TurndownService
): string {
  const sanitizedBody = stripUnsafeHtml(body);
  const markdown = turndown.turndown(sanitizedBody);
  const frontmatter = [
    '---',
    `title: "${title.replace(/"/g, '\\"')}"`,
    creationDate ? `created: ${creationDate}` : null,
    modificationDate ? `modified: ${modificationDate}` : null,
    '---'
  ].filter((line): line is string => line !== null);

  return frontmatter.join('\n') + '\n\n' + markdown;
}


