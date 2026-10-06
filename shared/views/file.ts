/** Reading and writing a vault's views file (see model.ts). Node only. */
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as crypto from 'node:crypto';
import { VIEWS_FILE, normalizeViews, serializeViews, newViewId, type View } from './model';

export const viewsFilePath = (notesDir: string): string => path.join(notesDir, VIEWS_FILE);

/** Never throws: a missing, unreadable or corrupt file is "no views" (the file itself is left as it is). */
export function readViews(notesDir: string): View[] {
  try {
    return normalizeViews(JSON.parse(fs.readFileSync(viewsFilePath(notesDir), 'utf8')) as unknown, newViewId);
  } catch {
    return [];
  }
}

/**
 * Write the views atomically, as the normalized and stably-ordered text, and return what was written. With no views the
 * file is removed rather than left empty, so a vault that never used views has no trace of them.
 */
export function writeViews(notesDir: string, views: unknown): View[] {
  const clean = normalizeViews({ views }, newViewId);
  const file = viewsFilePath(notesDir);
  if (clean.length === 0) {
    fs.rmSync(file, { force: true });
    return clean;
  }
  const tmp = `${file}.${crypto.randomBytes(6).toString('hex')}.tmp`;
  fs.writeFileSync(tmp, serializeViews(clean), 'utf8');
  fs.renameSync(tmp, file);
  return clean;
}
