// How the agent journal is shown: grouped into sessions, filtered, and what can be undone. Pure.
import type { JournalEntry } from '../../shared/vault/journalTypes';

export interface ActivityFilter {
  client?: string;
  kind?: JournalEntry['kind'];
  note?: string;
}

export interface Session {
  id: string;
  client: string;
  /** The first and last change of the session. */
  startedAt: string;
  endedAt: string;
  entries: JournalEntry[];
}

/** An entry that can be undone: a change an agent made (or that was approved), not an undo, and not one already undone. */
export const canUndo = (entry: JournalEntry, reverted: ReadonlySet<string>): boolean =>
  entry.via !== 'revert' && !entry.noContent && !reverted.has(entry.id);

export function filterEntries(entries: readonly JournalEntry[], f: ActivityFilter): JournalEntry[] {
  const note = f.note?.trim().toLowerCase();
  return entries.filter(e => (!f.client || e.client === f.client) && (!f.kind || e.kind === f.kind) && (!note || e.note.toLowerCase().includes(note)));
}

/** Entries (newest first) as sessions, the one with the latest change first; inside a session also newest first. */
export function groupSessions(entries: readonly JournalEntry[]): Session[] {
  const byId = new Map<string, Session>();
  for (const e of entries) {
    const s = byId.get(e.session);
    if (s) {
      s.entries.push(e);
      if (e.at < s.startedAt) s.startedAt = e.at;
      if (e.at > s.endedAt) s.endedAt = e.at;
    } else {
      byId.set(e.session, { id: e.session, client: e.client, startedAt: e.at, endedAt: e.at, entries: [e] });
    }
  }
  return [...byId.values()].sort((a, b) => (a.endedAt < b.endedAt ? 1 : a.endedAt > b.endedAt ? -1 : 0));
}

export const clientsOf = (entries: readonly JournalEntry[]): string[] => [...new Set(entries.map(e => e.client))].sort();
