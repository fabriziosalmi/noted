/**
 * Undoing what an agent did, from the journal: each entry says what the note was before and after, so it can be put back, as
 * long as the note is still exactly what the agent left (otherwise something else has been done to it since, and undoing would
 * overwrite that). Every undo is itself recorded in the journal before it is made, and the version it replaces is kept in the
 * note's history.
 */
import { readEntries, readBlob, appendEntry } from '../shared/vault/journalFile.js';
import { revertedIds, type JournalEntry } from '../shared/vault/journalTypes.js';
import { sha256Hex } from '../shared/vault/etag.js';

export interface RevertDeps {
  notesDir: string;
  /** The note's current text, or null when there is no such note. */
  readNote: (name: string) => Promise<string | null>;
  snapshotBefore: (name: string, previousContent: string) => Promise<void>;
  writeNote: (name: string, content: string) => Promise<void>;
  /** Move the note to the trash (recoverable). */
  trashNote: (name: string) => void;
}

export interface RevertResult {
  id: string;
  ok: boolean;
  /** Something else has changed the note since, so undoing would overwrite that. */
  conflict?: boolean;
  error?: string;
}

const CLIENT = 'Noted';

async function revertOne(deps: RevertDeps, entry: JournalEntry): Promise<RevertResult> {
  const fail = (error: string, conflict = false): RevertResult => ({ id: entry.id, ok: false, error, ...(conflict ? { conflict } : {}) });
  if (entry.noContent) return fail('the content of this change was too large to be kept, so it cannot be undone');
  const current = await deps.readNote(entry.note);
  const currentHash = current === null ? null : sha256Hex(current);
  const record = (kind: 'create' | 'update' | 'delete', before: string | null, after: string | null) =>
    appendEntry(deps.notesDir, { client: CLIENT, session: `revert-${entry.session}`, tool: 'revert', via: 'revert', kind, note: entry.note, before, after, revertOf: entry.id });

  if (entry.kind === 'create') {
    if (current === null) return { id: entry.id, ok: true }; // already gone
    if (currentHash !== entry.afterHash) return fail('the note was changed after the agent made it', true);
    record('delete', current, null);
    await deps.snapshotBefore(entry.note, current);
    deps.trashNote(entry.note);
    return { id: entry.id, ok: true };
  }

  const before = entry.beforeHash === null ? null : readBlob(deps.notesDir, entry.beforeHash);
  if (before === null) return fail('the earlier version is no longer in the journal');
  if (entry.kind === 'update') {
    if (current === null) return fail('the note was deleted since', true);
    if (currentHash !== entry.afterHash) return fail('the note was changed after the agent changed it', true);
    record('update', current, before);
    await deps.snapshotBefore(entry.note, current);
    await deps.writeNote(entry.note, before);
    return { id: entry.id, ok: true };
  }
  // the agent deleted it
  if (current !== null) return fail('a note with that name exists now', true);
  record('create', null, before);
  await deps.writeNote(entry.note, before);
  return { id: entry.id, ok: true };
}

/** Undo the entries with these ids, newest first (so a later change is undone before the earlier one it was built on). */
export async function revertEntries(deps: RevertDeps, ids: readonly string[]): Promise<RevertResult[]> {
  const { entries } = readEntries(deps.notesDir);
  const undone = revertedIds(entries);
  const byId = new Map(entries.map(e => [e.id, e]));
  const wanted = ids.map(id => byId.get(id)).filter((e): e is JournalEntry => e !== undefined).sort((a, b) => b.seq - a.seq);
  const results: RevertResult[] = ids.filter(id => !byId.has(id)).map(id => ({ id, ok: false, error: 'no such entry' }));
  for (const entry of wanted) {
    if (entry.via === 'revert') { results.push({ id: entry.id, ok: false, error: 'an undo cannot be undone' }); continue; }
    if (undone.has(entry.id)) { results.push({ id: entry.id, ok: false, error: 'already undone' }); continue; }
    try {
      results.push(await revertOne(deps, entry));
    } catch (err) {
      results.push({ id: entry.id, ok: false, error: (err as Error).message });
    }
  }
  return results;
}
