/**
 * What an entry of the agent journal is (journal.ts has the hashing and the chain). Plain types and reading, so the app's
 * screens can use them without the Node-only parts.
 */

export type JournalKind = 'create' | 'update' | 'delete';
export type JournalVia = 'direct' | 'approval' | 'revert';

export interface JournalEntry {
  /** Position in the journal, from 1. */
  seq: number;
  id: string;
  /** ISO time of the change. */
  at: string;
  /** The client's own name for itself (nothing verifies it). */
  client: string;
  /** One run of an MCP server (one connection of one client), so a whole session can be undone at once. */
  session: string;
  tool: string;
  via: JournalVia;
  kind: JournalKind;
  /** Vault-relative note name. */
  note: string;
  /** SHA-256 of the note before (null: it did not exist) and after (null: it was deleted). */
  beforeHash: string | null;
  afterHash: string | null;
  /** The content could not be kept (too large): the entry is a record, and cannot be undone. */
  noContent?: boolean;
  /** The id of the entry this one undoes. */
  revertOf?: string;
  /** The hash of the entry before this one (null for the first). */
  prev: string | null;
  hash: string;
}

export type JournalFields = Omit<JournalEntry, 'prev' | 'hash'>;

const HEX64 = /^[0-9a-f]{64}$/;
const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
const hashOrNull = (v: unknown): string | null | undefined => (v === null ? null : typeof v === 'string' && HEX64.test(v) ? v : undefined);

/** An entry from what was read of a line, or null when it is not one. */
export function parseEntry(raw: unknown): JournalEntry | null {
  if (!isRecord(raw)) return null;
  const { seq, id, at, client, session, tool, via, kind, note } = raw;
  if (!Number.isInteger(seq) || (seq as number) < 1 || typeof id !== 'string' || typeof at !== 'string' || Number.isNaN(Date.parse(at))) return null;
  if (typeof client !== 'string' || typeof session !== 'string' || typeof tool !== 'string' || typeof note !== 'string' || !note) return null;
  if (via !== 'direct' && via !== 'approval' && via !== 'revert') return null;
  if (kind !== 'create' && kind !== 'update' && kind !== 'delete') return null;
  const beforeHash = hashOrNull(raw.beforeHash);
  const afterHash = hashOrNull(raw.afterHash);
  const prev = hashOrNull(raw.prev);
  if (beforeHash === undefined || afterHash === undefined || prev === undefined || typeof raw.hash !== 'string' || !HEX64.test(raw.hash)) return null;
  return {
    seq: seq as number, id, at, client: client.slice(0, 100), session, tool: tool.slice(0, 50), via, kind, note, beforeHash, afterHash,
    ...(raw.noContent === true ? { noContent: true } : {}),
    ...(typeof raw.revertOf === 'string' ? { revertOf: raw.revertOf } : {}),
    prev, hash: raw.hash,
  };
}

/** The ids of the entries that have been undone. */
export function revertedIds(entries: readonly JournalEntry[]): Set<string> {
  return new Set(entries.flatMap(e => (e.revertOf ? [e.revertOf] : [])));
}
