/**
 * What a note's or folder's path may look like, inside a vault, at any depth. One rule for the main process, the
 * MCP server and Git, so they cannot disagree about which files are notes. Pure: it answers with a message or null,
 * and each caller throws its own kind of error.
 *
 * The depth, length and hidden-name limits are guards, not preferences: a path comes from a renderer or an AI client,
 * and `.noted/trash/<stamp>/x.md`, `.git/…` and `.obsidian/…` are all "paths ending in .md" that must stay out of reach.
 */

/** Folders below the vault root. A note in 16 nested folders is 17 segments. */
export const MAX_FOLDER_DEPTH = 16;
/** The whole relative path. Under Windows' 260 characters once the vault's own path is added in front. */
export const MAX_PATH_CHARS = 200;
/** One name; filesystems allow 255 bytes. */
export const MAX_SEGMENT_BYTES = 255;

const RESERVED = /[\x00-\x1F\x7F\\/:*?"<>|;`$]/; // eslint-disable-line no-control-regex
const DEVICE_NAME = /^(con|prn|aux|nul|com[1-9]|lpt[1-9])$/i;
const isAbsolute = (p: string): boolean => p.startsWith('/') || /^[A-Za-z]:[/\\]/.test(p) || p.startsWith('\\');
const utf8Bytes = (s: string): number => new TextEncoder().encode(s).length;

function checkSegment(segment: string, isNoteFile: boolean, what: string): string | null {
  const base = isNoteFile && segment.endsWith('.md') ? segment.slice(0, -3) : segment;
  if (!base.trim()) return `Invalid ${what}: a segment cannot be empty or whitespace only`;
  if (segment.startsWith('.')) return 'Hidden names (starting with ".") are not allowed';
  if (RESERVED.test(base)) return `Invalid ${what}: contains reserved characters (\\ / : * ? " < > | ; \` $)`;
  if (DEVICE_NAME.test(base)) return `Invalid ${what}: reserved device name`;
  if (/[. ]$/.test(base)) return `Invalid ${what}: cannot end with a dot or space`;
  if (utf8Bytes(segment) > MAX_SEGMENT_BYTES) return `A name is too long (max ${MAX_SEGMENT_BYTES} bytes)`;
  return null;
}

function checkPath(value: unknown, what: string, isNote: boolean): string | null {
  const kind = isNote ? 'file name' : 'folder name';
  if (!value || typeof value !== 'string' || !value.trim()) return `${what} must be a non-empty string`;
  if (isAbsolute(value)) return 'Absolute paths are not allowed';
  if (value.includes('..')) return 'Path traversal is not allowed';
  if (value.length > MAX_PATH_CHARS) return `Path is too long (max ${MAX_PATH_CHARS} characters)`;
  const segments = value.split('/');
  const folders = isNote ? segments.length - 1 : segments.length;
  if (folders > MAX_FOLDER_DEPTH) return `Folders can be nested at most ${MAX_FOLDER_DEPTH} levels deep`;
  for (let i = 0; i < segments.length; i++) {
    const problem = checkSegment(segments[i], isNote && i === segments.length - 1, kind);
    if (problem) return problem;
  }
  if (isNote && !value.endsWith('.md')) return 'File must have .md extension';
  return null;
}

/** `Folder/Sub/Note.md` (relative to the vault, "/" separators): null if it is a valid note path, else why not. */
export function checkNotePath(name: unknown, what = 'File name'): string | null {
  return checkPath(name, what, true);
}

/** `Folder/Sub`: null if it is a valid folder path, else why not. */
export function checkFolderPath(folder: unknown, what = 'Folder name'): string | null {
  return checkPath(folder, what, false);
}

/** The folder part of a note path ("" for a note at the root). */
export function dirnameOf(name: string): string {
  const i = name.lastIndexOf('/');
  return i === -1 ? '' : name.slice(0, i);
}

/** Does any segment of a relative path start with "."? Such a path is bookkeeping (history, trash, Git), never a note. */
export function hasHiddenSegment(relPath: string): boolean {
  return relPath.split('/').some(part => part.startsWith('.'));
}
