import fs from 'node:fs';
import path from 'node:path';
import { safeResolve } from './paths';

export const appWriteMtimes = new Map<string, number>();
// Deletions the app made itself, by name. A trashed file can't be stat'd, so
// the mtime above can't identify it as ours — we remember it briefly instead.
export const appDeletes = new Map<string, number>();
export const APP_DELETE_WINDOW_MS = 3000;

// Cap the app-write mtime map so a long session writing many notes can't grow
// it without bound. An entry only needs to outlive the watcher echo of its own
// write (sub-second), so evicting the least-recently-written once over the cap
// is safe — those echoes fired long ago.
const MAX_APP_WRITE_MTIMES = 512;

export function markAppWrite(dir: string, fileName: string): void {
  try {
    const mtime = fs.statSync(safeResolve(dir, fileName)).mtimeMs;
    appWriteMtimes.delete(fileName); // re-insert so this note moves to newest
    appWriteMtimes.set(fileName, mtime);
    while (appWriteMtimes.size > MAX_APP_WRITE_MTIMES) {
      const oldest = appWriteMtimes.keys().next().value;
      if (oldest === undefined) break;
      appWriteMtimes.delete(oldest);
    }
  } catch { /* ignore */ }
}

export function markAppDelete(fileName: string): void {
  const now = Date.now();
  for (const [name, at] of appDeletes) {
    if (now - at > APP_DELETE_WINDOW_MS) appDeletes.delete(name);
  }
  appDeletes.set(fileName, now);
}

// The version (mtime) of each note as the app last read or wrote it, so a save can tell whether something else wrote
// the file in between (an MCP client, a sync client, git): saving over that would lose it without a trace.
const noteVersions = new Map<string, number>();
const MAX_NOTE_VERSIONS = 4096;
const versionKey = (dir: string, fileName: string): string => `${path.resolve(dir)}\0${fileName}`;

function mtimeOf(dir: string, fileName: string): number | null {
  try { return fs.statSync(safeResolve(dir, fileName)).mtimeMs; } catch { return null; }
}

/** Remember the note's version now on disk as the one the app knows (after reading it, or after writing it). */
export function recordNoteVersion(dir: string, fileName: string, mtimeMs: number | null = mtimeOf(dir, fileName)): void {
  const key = versionKey(dir, fileName);
  noteVersions.delete(key);
  if (mtimeMs === null) return;
  noteVersions.set(key, mtimeMs);
  while (noteVersions.size > MAX_NOTE_VERSIONS) {
    const oldest = noteVersions.keys().next().value;
    if (oldest === undefined) break;
    noteVersions.delete(oldest);
  }
}

/** Was the note written by something else since the app last read or wrote it? False when the app never knew it. */
export function noteChangedSince(dir: string, fileName: string): boolean {
  const known = noteVersions.get(versionKey(dir, fileName));
  if (known === undefined) return false;
  const now = mtimeOf(dir, fileName);
  return now !== null && now !== known;
}
