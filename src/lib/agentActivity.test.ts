import { describe, it, expect } from 'vitest';
import { canUndo, filterEntries, groupSessions, clientsOf } from './agentActivity';
import type { JournalEntry } from '../../shared/vault/journalTypes';

const entry = (seq: number, over: Partial<JournalEntry> = {}): JournalEntry => ({
  seq, id: `e${seq}`, at: `2026-10-07T10:0${seq}:00.000Z`, client: 'claude', session: 's1', tool: 'update_note', via: 'direct', kind: 'update',
  note: 'Work/plan.md', beforeHash: 'a'.repeat(64), afterHash: 'b'.repeat(64), prev: null, hash: 'c'.repeat(64), ...over,
});

describe('canUndo', () => {
  it('a change, but not an undo, not one already undone, not one whose content was not kept', () => {
    expect(canUndo(entry(1), new Set())).toBe(true);
    expect(canUndo(entry(1, { via: 'approval' }), new Set())).toBe(true);
    expect(canUndo(entry(1, { via: 'revert' }), new Set())).toBe(false);
    expect(canUndo(entry(1), new Set(['e1']))).toBe(false);
    expect(canUndo(entry(1, { noContent: true }), new Set())).toBe(false);
  });
});

describe('filterEntries', () => {
  const all = [entry(1), entry(2, { client: 'gemini', note: 'Home/Chores.md', kind: 'create' }), entry(3, { note: 'Home/chores-old.md', kind: 'delete' })];
  it('by assistant, by kind, by part of the note name (any case); together', () => {
    expect(filterEntries(all, { client: 'gemini' }).map(e => e.seq)).toEqual([2]);
    expect(filterEntries(all, { kind: 'delete' }).map(e => e.seq)).toEqual([3]);
    expect(filterEntries(all, { note: ' CHORES ' }).map(e => e.seq)).toEqual([2, 3]);
    expect(filterEntries(all, { note: 'chores', client: 'claude' }).map(e => e.seq)).toEqual([3]);
    expect(filterEntries(all, {})).toHaveLength(3);
  });
});

describe('groupSessions', () => {
  it('one group per session, the one that changed last first, each newest first, with when it began and ended', () => {
    const entries = [entry(4, { session: 's2', client: 'gemini' }), entry(3), entry(2, { session: 's2', client: 'gemini' }), entry(1)];
    const sessions = groupSessions(entries);
    expect(sessions.map(s => [s.id, s.client, s.entries.map(e => e.seq)])).toEqual([['s2', 'gemini', [4, 2]], ['s1', 'claude', [3, 1]]]);
    expect(sessions[1]).toMatchObject({ startedAt: '2026-10-07T10:01:00.000Z', endedAt: '2026-10-07T10:03:00.000Z' });
  });

  it('clientsOf lists each assistant once, sorted', () => {
    expect(clientsOf([entry(1), entry(2, { client: 'gemini' }), entry(3)])).toEqual(['claude', 'gemini']);
  });
});
