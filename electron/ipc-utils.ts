import type TurndownService from 'turndown';
import { stripUnsafeHtml } from '../shared/security/htmlPolicy.node.js';
import { checkFolderPath, checkNotePath } from '../shared/vault/paths.js';

/** A note path inside the vault, at any depth: see shared/vault/paths.ts for the rules and why they are what they are. */
export function validateFileName(fileName: unknown): asserts fileName is string {
  const problem = checkNotePath(fileName);
  if (problem) throw new Error(problem);
}

/** One folder name, not a path (a new folder, or a folder renamed within its parent). */
export function validateFolderName(name: unknown): asserts name is string {
  if (!name || typeof name !== 'string' || !name.trim()) throw new Error('Folder name must be a non-empty string');
  if (name.includes('..') || name.includes('/') || name.includes('\\')) throw new Error('Invalid folder name');
  const problem = checkFolderPath(name);
  if (problem) throw new Error(problem);
}

/** A folder path inside the vault, at any depth ("Work/Q4"). */
export function validateFolderPath(folder: unknown): asserts folder is string {
  const problem = checkFolderPath(folder);
  if (problem) throw new Error(problem);
}

export { stripUnsafeHtml };

/**
 * Decide whether a vault change seen by the watcher was caused by the app
 * itself, so it doesn't report its own writes back to the renderer.
 *
 * Writes are recognised by mtime: main records the mtime of every file it
 * writes, and an event carrying that same mtime is ours. Deletions can't use
 * that trick — a trashed file has no mtime left to compare — so main remembers
 * the name for a short window instead. The window is matched by time rather
 * than consumed on first hit because fs.watch may report one removal twice.
 */
export function isAppOwnVaultEvent(args: {
  /** mtime of the changed file, or null when it no longer exists on disk. */
  mtimeMs: number | null;
  /** mtime of the app's own last write to this file, if it wrote one. */
  lastAppWriteMtimeMs?: number;
  /** When the app last deleted this file, if it did. */
  appDeletedAtMs?: number;
  nowMs: number;
  deleteWindowMs: number;
}): boolean {
  const { mtimeMs, lastAppWriteMtimeMs, appDeletedAtMs, nowMs, deleteWindowMs } = args;
  if (mtimeMs === null) {
    return appDeletedAtMs !== undefined && nowMs - appDeletedAtMs < deleteWindowMs;
  }
  return lastAppWriteMtimeMs === mtimeMs;
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

