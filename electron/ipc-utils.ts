import type TurndownService from 'turndown';
import { stripUnsafeHtml } from '../shared/security/htmlPolicy.js';

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

export { stripUnsafeHtml };

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

