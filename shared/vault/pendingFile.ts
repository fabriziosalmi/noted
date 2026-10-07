/** The files of pending changes in `.noted/pending/` (see pending.ts). Node only. */
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as crypto from 'node:crypto';
import { MAX_PENDING, MAX_PENDING_BYTES, PENDING_ID, parsePending, type PendingChange } from './pending';

export const pendingDir = (notesDir: string): string => path.join(notesDir, '.noted', 'pending');

/** Every pending change, oldest first. Files that cannot be read are skipped. */
export function listPending(notesDir: string): PendingChange[] {
  let files: string[];
  try { files = fs.readdirSync(pendingDir(notesDir)); } catch { return []; }
  const out: PendingChange[] = [];
  for (const file of files) {
    if (!file.endsWith('.json')) continue;
    try {
      const change = parsePending(JSON.parse(fs.readFileSync(path.join(pendingDir(notesDir), file), 'utf8')) as unknown);
      if (change && `${change.id}.json` === file) out.push(change);
    } catch { /* damaged: not a change */ }
  }
  return out.sort((a, b) => (a.createdAt < b.createdAt ? -1 : a.createdAt > b.createdAt ? 1 : a.id < b.id ? -1 : 1));
}

export function getPending(notesDir: string, id: string): PendingChange | null {
  if (!PENDING_ID.test(id)) return null;
  try { return parsePending(JSON.parse(fs.readFileSync(path.join(pendingDir(notesDir), `${id}.json`), 'utf8')) as unknown); } catch { return null; }
}

/** Keep a change for review. Throws when the queue is full or the change is too large. */
export function addPending(notesDir: string, change: Omit<PendingChange, 'id' | 'createdAt'>): PendingChange {
  const size = (change.before?.length ?? 0) + (change.after?.length ?? 0);
  if (size > MAX_PENDING_BYTES) throw new Error('the change is too large to stage');
  if (listPending(notesDir).length >= MAX_PENDING) throw new Error(`there are already ${MAX_PENDING} changes waiting for review`);
  const full: PendingChange = { id: crypto.randomBytes(8).toString('hex'), createdAt: new Date().toISOString(), ...change };
  fs.mkdirSync(pendingDir(notesDir), { recursive: true });
  const file = path.join(pendingDir(notesDir), `${full.id}.json`);
  const tmp = `${file}.${crypto.randomBytes(4).toString('hex')}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(full), 'utf8');
  fs.renameSync(tmp, file);
  return full;
}

export function removePending(notesDir: string, id: string): void {
  if (PENDING_ID.test(id)) fs.rmSync(path.join(pendingDir(notesDir), `${id}.json`), { force: true });
}
