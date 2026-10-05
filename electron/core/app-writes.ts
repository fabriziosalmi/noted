import fs from 'node:fs';
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
