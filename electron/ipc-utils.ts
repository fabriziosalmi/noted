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
    const base = seg.endsWith('.md') ? seg.slice(0, -3) : seg;
    if (!base.trim()) {
      throw new Error('Invalid file name: segment cannot be empty or whitespace only');
    }
    // eslint-disable-next-line no-control-regex
    if (/[\x00-\x1F\x7F\\/:*?"<>|;`$]/.test(base)) {
      throw new Error('Invalid file name: contains reserved characters (\\ / : * ? " < > | ; ` $)');
    }
  }
  if (!fileName.endsWith('.md')) throw new Error('File must have .md extension');
}

export function validateFolderName(name: unknown): asserts name is string {
  if (!name || typeof name !== 'string' || !name.trim()) throw new Error('Folder name must be a non-empty string');
  if (name.includes('..') || name.includes('/') || name.includes('\\')) throw new Error('Invalid folder name');
  // eslint-disable-next-line no-control-regex
  if (/[\x00-\x1F\x7F\\/:*?"<>|;`$]/.test(name)) {
    throw new Error('Invalid folder name: contains reserved characters (\\ / : * ? " < > | ; ` $)');
  }
}

export function stripUnsafeHtml(html: string): string {
  // Decode numeric and named HTML entities (with optional semicolons to match browsers)
  // and do it recursively or in a loop to handle nested/obfuscated entities.
  let decoded = html;
  let lastDecoded: string;
  // Repeat up to 3 times to catch recursive entity obfuscation, e.g. &amp;#x3C;
  for (let i = 0; i < 3; i++) {
    lastDecoded = decoded;
    decoded = decoded
      .replace(/&amp;?/gi, '&')
      .replace(/&quot;?/gi, '"')
      .replace(/&apos;?/gi, "'")
      .replace(/&#x([0-9a-f]+);?/gi, (_, hex: string) => String.fromCharCode(parseInt(hex, 16)))
      .replace(/&#([0-9]+);?/gi, (_, dec: string) => String.fromCharCode(parseInt(dec, 10)))
      .replace(/&Tab;?/gi, '\t')
      .replace(/&NewLine;?/gi, '\n')
      .replace(/&colon;?/gi, ':');
    if (decoded === lastDecoded) break;
  }

  // Strip dangerous tags completely (both closed and unclosed)
  let clean = decoded
    .replace(/<script\b[\s\S]*?(?:<\/script>|$)/gi, '')
    .replace(/<iframe\b[\s\S]*?(?:<\/iframe>|$)/gi, '')
    .replace(/<object\b[\s\S]*?(?:<\/object>|$)/gi, '')
    .replace(/<embed\b[\s\S]*?(?:<\/embed>|$)/gi, '')
    .replace(/<applet\b[\s\S]*?(?:<\/applet>|$)/gi, '')
    .replace(/<meta\b[\s\S]*?(?:<\/meta>|$)/gi, '')
    .replace(/<link\b[\s\S]*?(?:<\/link>|$)/gi, '');

  // Strip any remaining/dangling opening or closing dangerous tags to catch unclosed cases
  clean = clean
    .replace(/<\/?(?:script|iframe|object|embed|applet|meta|link)\b[^>]*(?:>|$)/gi, '')
    .replace(/<\/?(?:script|iframe|object|embed|applet|meta|link)\b/gi, '');

  // Strip inline event handlers using a word boundary rather than a whitespace match
  // This blocks bypasses like <img/onerror=...> or <body/onload=...>
  // We match preceding whitespace or slash to avoid leaving trailing space or slashes.
  clean = clean.replace(/(?:[\s/]+)\bon[a-zA-Z]+\s*=\s*(?:"[^"]*"|'[^']*'|[^\s>]*)/gi, '');

  // Strip javascript: and vbscript: protocols, supporting obfuscation with any space/control characters inside the scheme name
  /* eslint-disable no-control-regex */
  const jsRx = /j[\s\x00-\x20]*a[\s\x00-\x20]*v[\s\x00-\x20]*a[\s\x00-\x20]*s[\s\x00-\x20]*c[\s\x00-\x20]*r[\s\x00-\x20]*i[\s\x00-\x20]*p[\s\x00-\x20]*t[\s\x00-\x20]*:/gi;
  const vbRx = /v[\s\x00-\x20]*b[\s\x00-\x20]*s[\s\x00-\x20]*c[\s\x00-\x20]*r[\s\x00-\x20]*i[\s\x00-\x20]*p[\s\x00-\x20]*t[\s\x00-\x20]*:/gi;
  /* eslint-enable no-control-regex */
  
  return clean.replace(jsRx, '').replace(vbRx, '');
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


