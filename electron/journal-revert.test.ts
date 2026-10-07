// @vitest-environment node
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { revertEntries, type RevertDeps } from './journal-revert';
import { appendEntry, readEntries, verifyJournal } from '../shared/vault/journalFile';
import { revertedIds } from '../shared/vault/journalTypes';

let dir: string;
let snapshots: { name: string; previous: string }[];
let trashed: string[];
const abs = (n: string) => path.join(dir, n);
const deps = (): RevertDeps => ({
  notesDir: dir,
  readNote: async n => { try { return await fs.promises.readFile(abs(n), 'utf8'); } catch { return null; } },
  snapshotBefore: async (name, previous) => { snapshots.push({ name, previous }); },
  writeNote: async (n, c) => { await fs.promises.mkdir(path.dirname(abs(n)), { recursive: true }); await fs.promises.writeFile(abs(n), c); },
  trashNote: n => { trashed.push(n); fs.rmSync(abs(n)); },
});
beforeEach(() => { dir = fs.mkdtempSync(path.join(os.tmpdir(), 'noted-revert-')); snapshots = []; trashed = []; });
afterEach(() => { fs.rmSync(dir, { recursive: true, force: true }); });

/** What an agent did: the note is changed on disk, and the journal says so. */
const did = (client: string, session: string, kind: 'create' | 'update' | 'delete', note: string, after: string | null, tool = 'update_note') => {
  let before: string | null = null;
  try { before = fs.readFileSync(abs(note), 'utf8'); } catch { /* new */ }
  const entry = appendEntry(dir, { client, session, tool, via: 'direct', kind, note, before, after });
  if (after === null) fs.rmSync(abs(note)); else { fs.mkdirSync(path.dirname(abs(note)), { recursive: true }); fs.writeFileSync(abs(note), after); }
  return entry;
};

describe('undoing an agent\'s change', () => {
  it('an update goes back to what it was, the version it replaces is kept, and the undo is on the record', async () => {
    fs.writeFileSync(abs('a.md'), 'original');
    const e = did('claude', 's1', 'update', 'a.md', 'agent version');
    expect(await revertEntries(deps(), [e.id])).toEqual([{ id: e.id, ok: true }]);
    expect(fs.readFileSync(abs('a.md'), 'utf8')).toBe('original');
    expect(snapshots).toEqual([{ name: 'a.md', previous: 'agent version' }]);
    const all = readEntries(dir).entries;
    expect(all.at(-1)).toMatchObject({ via: 'revert', tool: 'revert', client: 'Noted', revertOf: e.id, kind: 'update', session: 'revert-s1' });
    expect([...revertedIds(all)]).toEqual([e.id]);
    expect(verifyJournal(dir)).toEqual({ ok: true, entries: 2 });
  });

  it('a creation is undone by moving the note to the trash; a deletion by making it again', async () => {
    const c = did('claude', 's1', 'create', 'new.md', 'made by agent', 'create_note');
    fs.writeFileSync(abs('gone.md'), 'precious');
    const d = did('claude', 's1', 'delete', 'gone.md', null, 'delete_note');
    expect(await revertEntries(deps(), [c.id, d.id])).toEqual(expect.arrayContaining([{ id: c.id, ok: true }, { id: d.id, ok: true }]));
    expect(trashed).toEqual(['new.md']);
    expect(fs.existsSync(abs('new.md'))).toBe(false);
    expect(fs.readFileSync(abs('gone.md'), 'utf8')).toBe('precious');
  });

  it('is refused, and nothing is touched, when the note is no longer what the agent left', async () => {
    fs.writeFileSync(abs('a.md'), 'original');
    const e = did('claude', 's1', 'update', 'a.md', 'agent version');
    fs.writeFileSync(abs('a.md'), 'then a person edited it');
    expect(await revertEntries(deps(), [e.id])).toEqual([{ id: e.id, ok: false, conflict: true, error: expect.stringContaining('changed after') }]);
    expect(fs.readFileSync(abs('a.md'), 'utf8')).toBe('then a person edited it');
    expect(readEntries(dir).entries).toHaveLength(1); // nothing recorded for an undo that did not happen

    const c = did('claude', 's1', 'create', 'new.md', 'v1', 'create_note');
    fs.writeFileSync(abs('new.md'), 'v2 by a person');
    expect(await revertEntries(deps(), [c.id])).toMatchObject([{ ok: false, conflict: true }]);
    expect(trashed).toEqual([]);

    const d = did('claude', 's1', 'delete', 'a.md', null, 'delete_note');
    fs.writeFileSync(abs('a.md'), 'someone made a new one');
    expect(await revertEntries(deps(), [d.id])).toMatchObject([{ ok: false, conflict: true }]);
  });

  it('a whole session goes back newest first, so a later change is undone before the one it built on', async () => {
    fs.writeFileSync(abs('a.md'), 'v0');
    const one = did('claude', 's1', 'update', 'a.md', 'v1');
    const two = did('claude', 's1', 'update', 'a.md', 'v2');
    const other = did('gemini', 's2', 'create', 'b.md', 'b', 'create_note');
    const results = await revertEntries(deps(), [one.id, two.id]);
    expect(results.map(r => r.ok)).toEqual([true, true]);
    expect(fs.readFileSync(abs('a.md'), 'utf8')).toBe('v0');
    expect(fs.existsSync(abs('b.md'))).toBe(true); // another session is not touched
    expect(other.session).toBe('s2');
  });

  it('what is out of order is partly undone and says which: the earlier one cannot be undone before the later', async () => {
    fs.writeFileSync(abs('a.md'), 'v0');
    const one = did('claude', 's1', 'update', 'a.md', 'v1');
    const two = did('claude', 's1', 'update', 'a.md', 'v2');
    expect(await revertEntries(deps(), [one.id])).toMatchObject([{ ok: false, conflict: true }]); // the note is v2, not what the first change left
    expect((await revertEntries(deps(), [two.id]))[0].ok).toBe(true);
    expect((await revertEntries(deps(), [one.id]))[0].ok).toBe(true);
    expect(fs.readFileSync(abs('a.md'), 'utf8')).toBe('v0');
  });

  it('never twice, never an undo, never what is not there, never what could not be kept', async () => {
    fs.writeFileSync(abs('a.md'), 'v0');
    const e = did('claude', 's1', 'update', 'a.md', 'v1');
    await revertEntries(deps(), [e.id]);
    expect(await revertEntries(deps(), [e.id])).toEqual([{ id: e.id, ok: false, error: 'already undone' }]);
    const undo = readEntries(dir).entries.find(x => x.via === 'revert')!;
    expect(await revertEntries(deps(), [undo.id])).toEqual([{ id: undo.id, ok: false, error: 'an undo cannot be undone' }]);
    expect(await revertEntries(deps(), ['nope'])).toEqual([{ id: 'nope', ok: false, error: 'no such entry' }]);
    const big = appendEntry(dir, { client: 'c', session: 's', tool: 'update_note', via: 'direct', kind: 'update', note: 'a.md', before: 'x', after: 'y'.repeat(5 * 1024 * 1024 + 1) });
    expect(await revertEntries(deps(), [big.id])).toMatchObject([{ ok: false, error: expect.stringContaining('too large') }]);
  });
});
