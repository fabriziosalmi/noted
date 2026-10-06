/**
 * Pure helpers for moving and dissolving folders: which notes change name, and whether a move makes sense. No file
 * access here, so the main process (which does the moving) and the renderer (which previews the link updates)
 * agree on the names.
 */
import type { NoteRename } from './links';
import { checkFolderPath, checkNotePath, dirnameOf } from './paths';

export const parentOfFolder = dirnameOf;
export const baseOfPath = (p: string): string => p.slice(p.lastIndexOf('/') + 1);

const low = (s: string): string => s.toLowerCase();

/** Is `name` the folder itself or something under it? Case-insensitive: a vault may live on a filesystem that is. */
export function isInsideFolder(name: string, folder: string): boolean {
  const n = low(name);
  const f = low(folder);
  return n === f || n.startsWith(`${f}/`);
}

/** Every note under `from`, named for where it will be once the folder is at `to`. */
export function renamesForFolderMove(names: readonly string[], from: string, to: string): NoteRename[] {
  return names.filter(n => n.startsWith(`${from}/`)).map(n => ({ from: n, to: `${to}/${n.slice(from.length + 1)}` }));
}

/**
 * Where each note under `folder` goes when the folder is dissolved: up one level, into the folder above it (the vault
 * root for a top-level folder), keeping the structure below. Names that collide there are disambiguated by the main
 * process; this is the plain mapping, for a preview.
 */
export function movesForDissolve(names: readonly string[], folder: string): NoteRename[] {
  const parent = dirnameOf(folder);
  return names
    .filter(n => n.startsWith(`${folder}/`))
    .map(n => ({ from: n, to: parent ? `${parent}/${n.slice(folder.length + 1)}` : n.slice(folder.length + 1) }));
}

/**
 * Can the folder at `from` become the folder at `to`? Null if so, else why not. Nothing is checked against the disk:
 * that `to` is free, and that its parent exists, are for the caller.
 */
export function checkFolderMove(from: string, to: string, deepestNoteUnder?: string): string | null {
  const bad = checkFolderPath(from) ?? checkFolderPath(to);
  if (bad) return bad;
  if (low(from) === low(to) && from === to) return 'The folder is already there';
  if (isInsideFolder(to, from) && low(to) !== low(from)) return 'A folder cannot be moved into itself';
  if (deepestNoteUnder !== undefined) {
    const after = `${to}/${deepestNoteUnder.slice(from.length + 1)}`;
    const problem = checkNotePath(after);
    if (problem) return `A note inside would no longer fit: ${problem}`;
  }
  return null;
}
