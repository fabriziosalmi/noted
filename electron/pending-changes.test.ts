// @vitest-environment node
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { approvePending, rejectPending, type PendingDeps } from './pending-changes';
import { addPending, getPending } from '../shared/vault/pendingFile';
import { etagOf } from '../shared/vault/etag';

let dir: string;
let snapshots: { name: string; previous: string }[];
let trashed: string[];
let recorded: { client: string; tool: string; kind: string; note: string; before: string | null; after: string | null }[];
const abs = (n: string) => path.join(dir, n);
const deps = (): PendingDeps => ({
  notesDir: dir,
  readNote: async n => { try { return await fs.promises.readFile(abs(n), 'utf8'); } catch { return null; } },
  snapshotBefore: async (name, previous) => { snapshots.push({ name, previous }); },
  writeNote: async (n, c) => { await fs.promises.mkdir(path.dirname(abs(n)), { recursive: true }); await fs.promises.writeFile(abs(n), c); },
  trashNote: n => { trashed.push(n); fs.rmSync(abs(n)); },
  record: entry => { recorded.push(entry); },
});
beforeEach(() => { dir = fs.mkdtempSync(path.join(os.tmpdir(), 'noted-approve-')); snapshots = []; trashed = []; recorded = []; });
afterEach(() => { fs.rmSync(dir, { recursive: true, force: true }); });

const stage = (kind: 'create' | 'update' | 'delete', note: string, before: string | null, after: string | null) =>
  addPending(dir, { client: 'claude', tool: 'x', kind, note, baseEtag: before === null ? null : etagOf(before), before, after });

describe('approving', () => {
  it('a new note is made, in its folder, and the change is gone', async () => {
    const c = stage('create', 'Drafts/new.md', null, '# New\n');
    expect(await approvePending(deps(), c.id)).toEqual({ ok: true });
    expect(fs.readFileSync(abs('Drafts/new.md'), 'utf8')).toBe('# New\n');
    expect(getPending(dir, c.id)).toBeNull();
  });

  it('a change is made when the note is still what the agent saw, with the version before kept', async () => {
    fs.writeFileSync(abs('a.md'), 'old');
    const c = stage('update', 'a.md', 'old', 'new');
    expect(await approvePending(deps(), c.id)).toEqual({ ok: true });
    expect(fs.readFileSync(abs('a.md'), 'utf8')).toBe('new');
    expect(snapshots).toEqual([{ name: 'a.md', previous: 'old' }]);
    expect(getPending(dir, c.id)).toBeNull();
  });

  it('every approval is put in the agent journal before it is made, naming the client that asked', async () => {
    fs.writeFileSync(abs('a.md'), 'old');
    const u = stage('update', 'a.md', 'old', 'new');
    const c = stage('create', 'n.md', null, 'fresh');
    await approvePending(deps(), u.id);
    await approvePending(deps(), c.id);
    expect(recorded).toEqual([
      { client: 'claude', tool: 'x', kind: 'update', note: 'a.md', before: 'old', after: 'new' },
      { client: 'claude', tool: 'x', kind: 'create', note: 'n.md', before: null, after: 'fresh' },
    ]);
  });

  it('an update can be approved in part: the text the person composed is written, in place of the agent\'s, and that is what is journaled', async () => {
    const before = 'one\ntwo\nthree\nfour\n';
    fs.writeFileSync(abs('a.md'), before);
    const c = stage('update', 'a.md', before, 'ONE\ntwo\nthree\nFOUR\n');
    expect(await approvePending(deps(), c.id, { content: 'ONE\ntwo\nthree\nfour\n' })).toEqual({ ok: true });
    expect(fs.readFileSync(abs('a.md'), 'utf8')).toBe('ONE\ntwo\nthree\nfour\n');
    expect(snapshots).toEqual([{ name: 'a.md', previous: before }]);
    expect(recorded).toEqual([{ client: 'claude', tool: 'x', kind: 'update', note: 'a.md', before, after: 'ONE\ntwo\nthree\nfour\n' }]);
    expect(getPending(dir, c.id)).toBeNull();
  });

  it('a partial approval is still refused when the note changed since the agent saw it, and the change stays', async () => {
    fs.writeFileSync(abs('a.md'), 'old');
    const c = stage('update', 'a.md', 'old', 'new');
    fs.writeFileSync(abs('a.md'), 'edited by hand');
    expect(await approvePending(deps(), c.id, { content: 'partly new' })).toMatchObject({ ok: false, conflict: true });
    expect(fs.readFileSync(abs('a.md'), 'utf8')).toBe('edited by hand');
    expect(getPending(dir, c.id)).not.toBeNull();
  });

  it('only a change to an existing note can be approved in part', async () => {
    const created = stage('create', 'n.md', null, 'fresh');
    expect(await approvePending(deps(), created.id, { content: 'x' })).toMatchObject({ ok: false });
    expect(fs.existsSync(abs('n.md'))).toBe(false);
    fs.writeFileSync(abs('d.md'), 'x');
    const deleted = stage('delete', 'd.md', 'x', null);
    expect(await approvePending(deps(), deleted.id, { content: '' })).toMatchObject({ ok: false });
    expect(fs.existsSync(abs('d.md'))).toBe(true);
    expect(getPending(dir, created.id)).not.toBeNull();
  });

  it('a change that cannot be recorded is not made', async () => {
    fs.writeFileSync(abs('a.md'), 'old');
    const u = stage('update', 'a.md', 'old', 'new');
    const d = { ...deps(), record: () => { throw new Error('journal full'); } };
    await expect(approvePending(d, u.id)).rejects.toThrow('journal full');
    expect(fs.readFileSync(abs('a.md'), 'utf8')).toBe('old');
    expect(getPending(dir, u.id)).not.toBeNull();
  });

  it('a deletion moves the note to the trash', async () => {
    fs.writeFileSync(abs('a.md'), 'old');
    const c = stage('delete', 'a.md', 'old', null);
    expect(await approvePending(deps(), c.id)).toEqual({ ok: true });
    expect(trashed).toEqual(['a.md']);
    expect(snapshots).toEqual([{ name: 'a.md', previous: 'old' }]);
  });

  it('refuses, and keeps the change, when the note is no longer what the agent saw', async () => {
    fs.writeFileSync(abs('a.md'), 'old');
    const c = stage('update', 'a.md', 'old', 'new');
    fs.writeFileSync(abs('a.md'), 'edited by a person');
    expect(await approvePending(deps(), c.id)).toEqual({ ok: false, error: expect.stringContaining('changed since'), conflict: true });
    expect(fs.readFileSync(abs('a.md'), 'utf8')).toBe('edited by a person');
    expect(getPending(dir, c.id)).not.toBeNull();
    expect(snapshots).toEqual([]);

    const d = stage('delete', 'a.md', 'old', null);
    expect(await approvePending(deps(), d.id)).toMatchObject({ ok: false, conflict: true });
    expect(trashed).toEqual([]);
  });

  it('refuses a new note over one that exists now, and an update of one that is gone', async () => {
    fs.writeFileSync(abs('a.md'), 'there');
    const c = stage('create', 'a.md', null, 'mine');
    expect(await approvePending(deps(), c.id)).toMatchObject({ ok: false, conflict: true });
    expect(fs.readFileSync(abs('a.md'), 'utf8')).toBe('there');
    fs.rmSync(abs('a.md'));
    const u = stage('update', 'a.md', 'there', 'new');
    expect(await approvePending(deps(), u.id)).toMatchObject({ ok: false, conflict: true });
    expect(fs.existsSync(abs('a.md'))).toBe(false);
  });

  it('a deletion of a note that is already gone just clears the change', async () => {
    const c = stage('delete', 'gone.md', 'x', null);
    expect(await approvePending(deps(), c.id)).toEqual({ ok: true });
    expect(getPending(dir, c.id)).toBeNull();
  });

  it('a change that is not there, and a note name that is not allowed', async () => {
    expect(await approvePending(deps(), 'f'.repeat(16))).toEqual({ ok: false, error: 'that change is no longer waiting' });
    fs.mkdirSync(path.join(dir, '.noted', 'pending'), { recursive: true });
    const id = 'a'.repeat(16);
    fs.writeFileSync(path.join(dir, '.noted', 'pending', `${id}.json`), JSON.stringify({ id, createdAt: new Date().toISOString(), client: 'x', tool: 't', kind: 'create', note: '../escape.md', baseEtag: null, before: null, after: 'x' }));
    expect((await approvePending(deps(), id)).ok).toBe(false);
    expect(fs.existsSync(path.join(dir, '..', 'escape.md'))).toBe(false);
  });
});

describe('rejecting', () => {
  it('drops the change and touches no note', () => {
    fs.writeFileSync(abs('a.md'), 'old');
    const c = stage('update', 'a.md', 'old', 'new');
    expect(rejectPending(dir, c.id)).toEqual({ ok: true });
    expect(getPending(dir, c.id)).toBeNull();
    expect(fs.readFileSync(abs('a.md'), 'utf8')).toBe('old');
    expect(rejectPending(dir, c.id)).toEqual({ ok: false, error: 'that change is no longer waiting' });
  });
});
