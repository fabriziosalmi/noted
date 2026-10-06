/**
 * Trash for notes removed through MCP.
 *
 * The app deletes to the system Trash; an MCP server runs headless (stdio or as
 * a child process) and cannot reach it. So `delete_note` moves the file under
 * `<vault>/.noted/trash/<stamp>/<original relative path>`, where a restore can
 * put it back. One directory per deletion keeps every version, and the stamp
 * (UTC time + random suffix) is both the unique id and the deletion time.
 *
 * The `.noted` folder is a dot-directory, so note listings, the full-text index
 * and git sync (which ignores it) never see trashed notes.
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import * as crypto from 'node:crypto';
import { walkVaultSync } from '../shared/vault/walk';

export const DEFAULT_RETENTION_DAYS = 30;
export const MAX_RETENTION_DAYS = 3650;

export class TrashError extends Error {
  code: 'not-found' | 'exists' | 'ambiguous';
  constructor(code: 'not-found' | 'exists' | 'ambiguous', message: string) {
    super(message);
    this.code = code;
  }
}

export interface TrashItem {
  /** Original note name, e.g. "folder/note.md". */
  name: string;
  /** Directory name inside the trash; unique id of this deletion. */
  stamp: string;
  trashedAt: Date;
}

export const trashRoot = (notesDir: string): string => path.join(notesDir, '.noted', 'trash');

const pad = (n: number, w = 2) => String(n).padStart(w, '0');

/** `2026-10-05T14-30-00-123Z-ab12` — sortable, filesystem-safe on every OS. */
export function makeStamp(now: Date, suffix = crypto.randomBytes(2).toString('hex')): string {
  return `${now.getUTCFullYear()}-${pad(now.getUTCMonth() + 1)}-${pad(now.getUTCDate())}` +
    `T${pad(now.getUTCHours())}-${pad(now.getUTCMinutes())}-${pad(now.getUTCSeconds())}-${pad(now.getUTCMilliseconds(), 3)}Z-${suffix}`;
}

const STAMP_RE = /^(\d{4})-(\d{2})-(\d{2})T(\d{2})-(\d{2})-(\d{2})-(\d{3})Z-[0-9a-f]{4}$/;

export function parseStamp(stamp: string): Date | null {
  const m = STAMP_RE.exec(stamp);
  if (!m) return null;
  const d = new Date(Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], +m[6], +m[7]));
  // Date.UTC rolls impossible fields over (month 13 -> next year): insist the
  // components survive the round trip.
  const same = d.getUTCFullYear() === +m[1] && d.getUTCMonth() === +m[2] - 1 && d.getUTCDate() === +m[3] &&
    d.getUTCHours() === +m[4] && d.getUTCMinutes() === +m[5] && d.getUTCSeconds() === +m[6] && d.getUTCMilliseconds() === +m[7];
  return same ? d : null;
}

/** Retention setting from a CLI/env value: whole days, 0 = keep forever, junk = default. */
export function parseRetentionDays(raw: string | undefined): number {
  if (raw === undefined || raw.trim() === '') return DEFAULT_RETENTION_DAYS;
  const n = Number(raw);
  if (!Number.isInteger(n) || n < 0 || n > MAX_RETENTION_DAYS) return DEFAULT_RETENTION_DAYS;
  return n;
}

/** Move a note (already validated by the caller) into the trash. */
export function moveToTrash(notesDir: string, name: string, now = new Date()): TrashItem {
  const src = path.join(notesDir, name);
  const stamp = makeStamp(now);
  const dest = path.join(trashRoot(notesDir), stamp, name);
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  fs.renameSync(src, dest);
  return { name, stamp, trashedAt: now };
}

function readDirs(dir: string): fs.Dirent[] {
  try { return fs.readdirSync(dir, { withFileTypes: true }); } catch { return []; }
}

/** Everything in the trash, newest first. Unrecognised entries are ignored. */
export function listTrash(notesDir: string): TrashItem[] {
  const out: TrashItem[] = [];
  for (const stampDir of readDirs(trashRoot(notesDir))) {
    const trashedAt = stampDir.isDirectory() ? parseStamp(stampDir.name) : null;
    if (!trashedAt) continue;
    // A note trashed from any depth sits under the same path it had: list them all, or a deep note could never
    // be restored and would be purged with the rest when its time came.
    for (const name of walkVaultSync(path.join(trashRoot(notesDir), stampDir.name)).notes) {
      out.push({ name, stamp: stampDir.name, trashedAt });
    }
  }
  return out.sort((a, b) => b.trashedAt.getTime() - a.trashedAt.getTime() || b.stamp.localeCompare(a.stamp));
}

/**
 * Put a trashed note back at its original path. Without `stamp`, the newest
 * deletion of that name. Never overwrites: a note that exists again blocks the restore.
 */
export function restoreFromTrash(notesDir: string, name: string, stamp?: string): TrashItem {
  const matches = listTrash(notesDir).filter(i => i.name === name && (stamp === undefined || i.stamp === stamp));
  if (matches.length === 0) {
    throw new TrashError('not-found', stamp ? `"${name}" is not in the trash with id ${stamp}` : `"${name}" is not in the trash`);
  }
  const item = matches[0];
  const dest = path.join(notesDir, name);
  if (fs.existsSync(dest)) {
    throw new TrashError('exists', `A note named "${name}" already exists; rename or delete it first, then restore`);
  }
  const src = path.join(trashRoot(notesDir), item.stamp, name);
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  fs.renameSync(src, dest);
  // Drop the now-empty deletion folder.
  try { fs.rmSync(path.join(trashRoot(notesDir), item.stamp), { recursive: true, force: true }); } catch { /* best effort */ }
  return item;
}

/** Delete deletions older than the retention window. Returns how many were purged. 0 days = keep forever. */
export function purgeTrash(notesDir: string, now: Date, retentionDays: number): number {
  if (retentionDays <= 0) return 0;
  const cutoff = now.getTime() - retentionDays * 86_400_000;
  let purged = 0;
  for (const stampDir of readDirs(trashRoot(notesDir))) {
    const trashedAt = stampDir.isDirectory() ? parseStamp(stampDir.name) : null;
    if (trashedAt && trashedAt.getTime() < cutoff) {
      fs.rmSync(path.join(trashRoot(notesDir), stampDir.name), { recursive: true, force: true });
      purged++;
    }
  }
  return purged;
}
