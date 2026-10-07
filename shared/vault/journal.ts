/**
 * The agent journal: a record of every change made to a note through MCP (and of the approvals and reverts of them), so that
 * what an agent did is attributable and can be undone. This is the pure part: what an entry is, how entries are chained so that
 * an edited or removed one is detected, and how a chain is checked. The files are journalFile.ts.
 *
 * An entry holds the hashes of the note's content before and after (the content itself lives beside it by hash, so a note that is
 * changed ten times is stored once each time and never twice). Each entry also holds the hash of the one before it, and its own
 * hash over everything it says: changing, removing or reordering an entry breaks the chain from that point on.
 */
import { createHash } from 'node:crypto';
import type { JournalEntry, JournalFields } from './journalTypes';

export { parseEntry, revertedIds } from './journalTypes';
export type { JournalEntry, JournalFields, JournalKind, JournalVia } from './journalTypes';

/** What is hashed, in a fixed order, so the same entry always has the same hash. */
function canonical(prev: string | null, f: JournalFields): string {
  return JSON.stringify([prev, f.seq, f.id, f.at, f.client, f.session, f.tool, f.via, f.kind, f.note, f.beforeHash, f.afterHash, f.noContent ?? false, f.revertOf ?? null]);
}

export const entryHash = (prev: string | null, fields: JournalFields): string => createHash('sha256').update(canonical(prev, fields), 'utf8').digest('hex');

/** The entry that follows `prev` and says `fields`. */
export function sealEntry(prev: string | null, fields: JournalFields): JournalEntry {
  return { ...fields, prev, hash: entryHash(prev, fields) };
}

export type ChainResult = { ok: true; entries: number } | { ok: false; at: number; reason: string };

/** Is the journal as it was written? Checks each entry's own hash, that it names the one before it, and that the numbering runs on. */
export function verifyChain(entries: readonly JournalEntry[]): ChainResult {
  let prev: string | null = null;
  for (let i = 0; i < entries.length; i++) {
    const e = entries[i];
    const fields: JournalFields = { seq: e.seq, id: e.id, at: e.at, client: e.client, session: e.session, tool: e.tool, via: e.via, kind: e.kind, note: e.note, beforeHash: e.beforeHash, afterHash: e.afterHash, ...(e.noContent ? { noContent: true } : {}), ...(e.revertOf ? { revertOf: e.revertOf } : {}) };
    if (e.seq !== i + 1) return { ok: false, at: e.seq, reason: i === 0 ? 'the journal does not begin at its first entry' : 'an entry is missing or out of order' };
    if (e.prev !== prev) return { ok: false, at: e.seq, reason: 'it does not follow the entry before it' };
    if (entryHash(e.prev, fields) !== e.hash) return { ok: false, at: e.seq, reason: 'it was changed after it was written' };
    prev = e.hash;
  }
  return { ok: true, entries: entries.length };
}
