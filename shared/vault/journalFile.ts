/**
 * The files of the agent journal, in `.noted/journal/` (see journal.ts): one JSON line per entry in a file for each day, and
 * the content of the notes by hash in `blobs/`. Append-only: nothing here edits or removes an entry. Node only.
 */
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as crypto from 'node:crypto';
import { sealEntry, verifyChain, type ChainResult } from './journal';
import { parseEntry, type JournalEntry, type JournalKind, type JournalVia } from './journalTypes';
import { sha256Hex } from './etag';

export const journalDir = (notesDir: string): string => path.join(notesDir, '.noted', 'journal');
const blobsDir = (notesDir: string): string => path.join(journalDir(notesDir), 'blobs');
/** Content larger than this is recorded by hash only: the change is on record, and cannot be undone. */
export const MAX_JOURNAL_CONTENT = 5 * 1024 * 1024;

const dayFile = (iso: string): string => `${iso.slice(0, 10)}.jsonl`;
const DAY_FILE = /^\d{4}-\d{2}-\d{2}\.jsonl$/;

// ── a lock, so that two servers appending at once cannot both continue the same entry ──────────────

const LOCK_STALE_MS = 10_000;

function withLock<T>(notesDir: string, work: () => T): T {
  fs.mkdirSync(journalDir(notesDir), { recursive: true });
  const lock = path.join(journalDir(notesDir), '.lock');
  const until = Date.now() + 5000;
  for (;;) {
    try {
      fs.closeSync(fs.openSync(lock, 'wx'));
      break;
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== 'EEXIST') throw err;
      try { if (Date.now() - fs.statSync(lock).mtimeMs > LOCK_STALE_MS) fs.rmSync(lock, { force: true }); } catch { /* released meanwhile */ }
      if (Date.now() > until) throw new Error('the journal is busy', { cause: err });
      Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 25);
    }
  }
  try { return work(); } finally { fs.rmSync(lock, { force: true }); }
}

// ── reading ─────────────────────────────────────────────────────────────────────────────────────

/** Every entry in order, and how many lines were not entries (a damaged line is never skipped silently: see `verify`). */
export function readEntries(notesDir: string): { entries: JournalEntry[]; damaged: number } {
  let files: string[];
  try { files = fs.readdirSync(journalDir(notesDir)).filter(f => DAY_FILE.test(f)).sort(); } catch { return { entries: [], damaged: 0 }; }
  const entries: JournalEntry[] = [];
  let damaged = 0;
  for (const file of files) {
    let text: string;
    try { text = fs.readFileSync(path.join(journalDir(notesDir), file), 'utf8'); } catch { damaged++; continue; }
    for (const line of text.split('\n')) {
      if (!line.trim()) continue;
      let entry: JournalEntry | null = null;
      try { entry = parseEntry(JSON.parse(line) as unknown); } catch { /* not JSON */ }
      if (entry) entries.push(entry); else damaged++;
    }
  }
  return { entries, damaged };
}

/** Is the journal as written? A line that is not an entry counts against it. */
export function verifyJournal(notesDir: string): ChainResult {
  const { entries, damaged } = readEntries(notesDir);
  if (damaged > 0) return { ok: false, at: 0, reason: `${damaged} line(s) in the journal are not entries` };
  return verifyChain(entries);
}

export function readBlob(notesDir: string, hash: string): string | null {
  if (!/^[0-9a-f]{64}$/.test(hash)) return null;
  try { return fs.readFileSync(path.join(blobsDir(notesDir), hash), 'utf8'); } catch { return null; }
}

function putBlob(notesDir: string, text: string): string {
  const hash = sha256Hex(text);
  const file = path.join(blobsDir(notesDir), hash);
  if (!fs.existsSync(file)) {
    fs.mkdirSync(blobsDir(notesDir), { recursive: true });
    const tmp = `${file}.${crypto.randomBytes(4).toString('hex')}.tmp`;
    fs.writeFileSync(tmp, text, 'utf8');
    fs.renameSync(tmp, file);
  }
  return hash;
}

// ── writing ─────────────────────────────────────────────────────────────────────────────────────

export interface JournalInput {
  client: string;
  session: string;
  tool: string;
  via: JournalVia;
  kind: JournalKind;
  note: string;
  /** The note as it was (null: it did not exist) and as it is now (null: deleted). */
  before: string | null;
  after: string | null;
  revertOf?: string;
}

/** The last entry written, from the end of the newest file (older files only when the newest is empty). */
function lastEntry(notesDir: string): JournalEntry | null {
  let files: string[];
  try { files = fs.readdirSync(journalDir(notesDir)).filter(f => DAY_FILE.test(f)).sort().reverse(); } catch { return null; }
  for (const file of files) {
    const lines = fs.readFileSync(path.join(journalDir(notesDir), file), 'utf8').split('\n').filter(l => l.trim());
    for (let i = lines.length - 1; i >= 0; i--) {
      try { const e = parseEntry(JSON.parse(lines[i]) as unknown); if (e) return e; } catch { /* a damaged line: look further back */ }
    }
  }
  return null;
}

/** Record a change. Throws if it cannot be recorded: a write that cannot be recorded is not to be made. */
export function appendEntry(notesDir: string, input: JournalInput): JournalEntry {
  const tooBig = (t: string | null) => t !== null && t.length > MAX_JOURNAL_CONTENT;
  const noContent = tooBig(input.before) || tooBig(input.after);
  return withLock(notesDir, () => {
    const last = lastEntry(notesDir);
    const at = new Date().toISOString();
    if (!noContent) {
      if (input.before !== null) putBlob(notesDir, input.before);
      if (input.after !== null) putBlob(notesDir, input.after);
    }
    const entry = sealEntry(last?.hash ?? null, {
      seq: (last?.seq ?? 0) + 1,
      id: crypto.randomBytes(8).toString('hex'),
      at,
      client: input.client.slice(0, 100),
      session: input.session,
      tool: input.tool,
      via: input.via,
      kind: input.kind,
      note: input.note,
      beforeHash: input.before === null ? null : sha256Hex(input.before),
      afterHash: input.after === null ? null : sha256Hex(input.after),
      ...(noContent ? { noContent: true } : {}),
      ...(input.revertOf ? { revertOf: input.revertOf } : {}),
    });
    fs.mkdirSync(journalDir(notesDir), { recursive: true });
    fs.appendFileSync(path.join(journalDir(notesDir), dayFile(at)), `${JSON.stringify(entry)}\n`, 'utf8');
    return entry;
  });
}
