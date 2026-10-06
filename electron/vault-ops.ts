import fs from 'node:fs';
import path from 'node:path';
import type { NoteRename } from '../shared/vault/links';
import { checkNotePath, dirnameOf } from '../shared/vault/paths';
import { walkVaultSync } from '../shared/vault/walk';
import { baseOfPath, checkFolderMove } from '../shared/vault/folderOps';

/**
 * Folder-level vault operations that move files around, at any folder depth.
 *
 * These live outside the IPC handlers so they can be exercised against a real temp directory in tests: the
 * handlers are only reachable inside a running Electron process, which is exactly how a silent-overwrite bug used
 * to survive here. The rules every operation here keeps:
 *  - decide every destination before anything moves, and refuse before touching a file if any is wrong;
 *  - never overwrite: a name that is taken is disambiguated, never replaced;
 *  - if a move fails half way, put back what already moved;
 *  - remove a folder only when it is empty (`rmdir`, not a recursive remove), so a file nobody planned for is
 *    never destroyed with it.
 */

/** Media that lives next to notes and must survive a folder delete. */
const MEDIA_EXTENSIONS = ['.png', '.jpg', '.jpeg', '.gif', '.svg', '.webp', '.pdf'];

export function isNoteOrMedia(fileName: string): boolean {
  const ext = path.extname(fileName).toLowerCase();
  return ext === '.md' || MEDIA_EXTENSIONS.includes(ext);
}

/** What the operating system leaves in a folder on its own: removed with the folder, never moved. */
const isOsCruft = (name: string): boolean => name === '.DS_Store' || name === 'Thumbs.db' || name === 'desktop.ini' || name.startsWith('._');

/**
 * Pick a name that doesn't exist in `dir` yet, disambiguating with the folder the entry came from:
 * "Note.md" → "Note (Archive).md" → "Note (Archive) 2.md". Only the last part of a folder path is used.
 *
 * `exists` is injected so the caller decides what "taken" means (on disk, plus any name already claimed
 * earlier in the same batch).
 */
export function uniqueNameInDir(
  baseName: string,
  fromFolder: string,
  exists: (name: string) => boolean,
): string {
  if (!exists(baseName)) return baseName;
  const ext = path.extname(baseName);
  const stem = ext ? baseName.slice(0, -ext.length) : baseName;
  const folder = baseOfPath(fromFolder);
  const tagged = `${stem} (${folder})${ext}`;
  if (!exists(tagged)) return tagged;
  for (let n = 2; n < 1000; n++) {
    const candidate = `${stem} (${folder}) ${n}${ext}`;
    if (!exists(candidate)) return candidate;
  }
  throw new Error(`Could not find a free name for "${baseName}"`);
}

type Resolve = (dir: string, relName: string) => string;

const present = (p: string): boolean => {
  try { fs.lstatSync(p); return true; } catch { return false; }
};

interface Step {
  from: string;
  to: string;
}

/** Carry out renames in order; if one fails, undo the ones already done (newest first) and rethrow. */
function performSteps(steps: Step[]): void {
  const done: Step[] = [];
  try {
    for (const step of steps) {
      fs.renameSync(step.from, step.to);
      done.push(step);
    }
  } catch (err) {
    for (const step of done.reverse()) {
      try { fs.renameSync(step.to, step.from); } catch { /* the original error is the one to report */ }
    }
    throw err;
  }
}

/** Remove `dir` and every folder under it that is empty; a folder holding anything stays (and so do its parents). */
function removeEmptyTree(dir: string): void {
  let entries: fs.Dirent[];
  try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
  for (const entry of entries) if (entry.isDirectory()) removeEmptyTree(path.join(dir, entry.name));
  try { fs.rmdirSync(dir); } catch { /* not empty, or gone */ }
}

/**
 * A note's version history lives at `.noted_history/<note path>/`. Follow the note to its new name; never replace a
 * history that is already there, and never fail the move over it.
 */
function moveHistory(vault: string, fromNote: string, toNote: string): void {
  const oldHist = path.join(vault, '.noted_history', fromNote);
  const newHist = path.join(vault, '.noted_history', toNote);
  if (!present(oldHist) || present(newHist)) return;
  try {
    fs.mkdirSync(path.dirname(newHist), { recursive: true });
    fs.renameSync(oldHist, newHist);
  } catch { /* history is best-effort */ }
}

// ── move / rename a folder ─────────────────────────────────────────────────

export interface MoveFolderResult {
  /** Every note that changed name, as vault-relative names (for the link update). */
  moves: NoteRename[];
}

/**
 * Rename the folder `from` to `to`, or move it under another folder (`to` is its new full path). Refuses a
 * move into itself, onto something that exists, under a parent that does not exist, or one that would leave a
 * note with a name the app would not accept. A case-only rename works on a case-insensitive filesystem too.
 */
export function moveFolder(vault: string, from: string, to: string, resolve: Resolve): MoveFolderResult {
  const src = resolve(vault, from);
  const dest = resolve(vault, to);
  let srcStat: fs.Stats;
  try { srcStat = fs.lstatSync(src); } catch { throw new Error(`Folder "${from}" not found`); }
  if (!srcStat.isDirectory()) throw new Error(`"${from}" is not a folder`);

  const notes = walkVaultSync(src).notes.map(n => `${from}/${n}`);
  const deepest = notes.reduce((a, b) => (b.length > a.length ? b : a), '');
  const problem = checkFolderMove(from, to, deepest || undefined);
  if (problem) throw new Error(problem);

  const parent = dirnameOf(to);
  if (parent && !fs.existsSync(resolve(vault, parent))) throw new Error(`The folder "${parent}" does not exist`);

  // A case-only rename: the destination "exists" because it is the source under another spelling.
  let sameEntry = false;
  if (present(dest)) {
    if (from.toLowerCase() !== to.toLowerCase()) throw new Error(`"${to}" already exists`);
    try {
      const a = fs.statSync(src);
      const b = fs.statSync(dest);
      sameEntry = a.ino !== 0 && a.ino === b.ino && a.dev === b.dev;
    } catch { /* treated as not the same */ }
    if (!sameEntry) throw new Error(`"${to}" already exists`);
  }

  const moves: NoteRename[] = notes.map(n => ({ from: n, to: `${to}/${n.slice(from.length + 1)}` }));
  if (sameEntry) {
    const tmp = path.join(path.dirname(src), `.noted-rename-${process.pid}-${Date.now()}`);
    performSteps([{ from: src, to: tmp }, { from: tmp, to: dest }]);
  } else {
    performSteps([{ from: src, to: dest }]);
  }
  for (const m of moves) moveHistory(vault, m.from, m.to);
  removeEmptyTree(path.join(vault, '.noted_history', from));
  return { moves };
}

// ── delete a folder, keeping what is in it ─────────────────────────────────

export interface DissolveFolderResult {
  /** Entries moved up out of the folder (notes, media, other files, sub-folders). */
  moved: number;
  /** "old name → new name" for every entry renamed to avoid a collision. */
  renamed: string[];
  /** Every NOTE that moved, as vault-relative names, with its final name. */
  moves: NoteRename[];
  /** The folder could not be removed because something appeared in it meanwhile; it was left as it is. */
  folderKept?: boolean;
}

/**
 * Delete a folder after moving everything in it up one level: into the folder above it, or the vault root for a
 * top-level folder. Sub-folders go up whole, structure kept. A name that is taken there is disambiguated, never
 * overwritten. Only the operating system's own litter (.DS_Store, Thumbs.db) is thrown away; any other hidden item
 * (a `.git` folder, say) makes the operation refuse before anything moves.
 */
export function dissolveFolder(vault: string, folder: string, resolve: Resolve): DissolveFolderResult {
  const folderPath = resolve(vault, folder);
  let stat: fs.Stats;
  try { stat = fs.lstatSync(folderPath); } catch { throw new Error(`Folder "${folder}" not found`); }
  if (!stat.isDirectory()) throw new Error(`"${folder}" is not a folder`);

  const parent = dirnameOf(folder);
  const parentPath = parent ? resolve(vault, parent) : vault;
  const entries = fs.readdirSync(folderPath, { withFileTypes: true });

  const cruft: string[] = [];
  const hidden: string[] = [];
  const movable: fs.Dirent[] = [];
  for (const entry of entries) {
    if (isOsCruft(entry.name)) cruft.push(entry.name);
    else if (entry.name.startsWith('.')) hidden.push(entry.name);
    else movable.push(entry);
  }
  if (hidden.length > 0) {
    throw new Error(`"${folder}" contains hidden items (${hidden.join(', ')}). Remove or move them first; nothing was changed.`);
  }

  // Decide every destination first (a move that has not happened yet is invisible to existsSync).
  const claimed = new Set<string>();
  const isTaken = (name: string): boolean => claimed.has(name.toLowerCase()) || present(path.join(parentPath, name));
  const steps: Step[] = [];
  const moves: NoteRename[] = [];
  const renamed: string[] = [];
  for (const entry of movable) {
    const destName = uniqueNameInDir(entry.name, folder, isTaken);
    claimed.add(destName.toLowerCase());
    const destRel = parent ? `${parent}/${destName}` : destName;
    steps.push({ from: path.join(folderPath, entry.name), to: resolve(vault, destRel) });
    if (destName !== entry.name) renamed.push(`${entry.name} → ${destName}`);
    if (entry.isDirectory()) {
      for (const note of walkVaultSync(path.join(folderPath, entry.name)).notes) {
        moves.push({ from: `${folder}/${entry.name}/${note}`, to: `${destRel}/${note}` });
      }
    } else if (entry.name.endsWith('.md')) {
      moves.push({ from: `${folder}/${entry.name}`, to: destRel });
    }
  }
  for (const m of moves) {
    const bad = checkNotePath(m.to);
    if (bad) throw new Error(`"${m.from}" would not keep a valid name: ${bad}. Nothing was changed.`);
  }

  performSteps(steps);
  for (const m of moves) moveHistory(vault, m.from, m.to);

  // What is left is litter, or something that arrived while we worked. rmdir refuses a folder that holds anything
  // else, which is the point: it is the last check that nothing is destroyed.
  for (const name of cruft) {
    try { fs.rmSync(path.join(folderPath, name), { force: true }); } catch { /* rmdir below decides */ }
  }
  let folderKept = false;
  try { fs.rmdirSync(folderPath); } catch { folderKept = true; }
  removeEmptyTree(path.join(vault, '.noted_history', folder));

  return { moved: steps.length, renamed, moves, ...(folderKept ? { folderKept } : {}) };
}

/** @deprecated the folder now moves up one level (to the vault root only when it is at the top). */
export const deleteFolderMovingContentToRoot = dissolveFolder;

