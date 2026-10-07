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
const abs = (n: string) => path.join(dir, n);
const deps = (): PendingDeps => ({
  notesDir: dir,
  readNote: async n => { try { return await fs.promises.readFile(abs(n), 'utf8'); } catch { return null; } },
  snapshotBefore: async (name, previous) => { snapshots.push({ name, previous }); },
  writeNote: async (n, c) => { await fs.promises.mkdir(path.dirname(abs(n)), { recursive: true }); await fs.promises.writeFile(abs(n), c); },
  trashNote: n => { trashed.push(n); fs.rmSync(abs(n)); },
});
beforeEach(() => { dir = fs.mkdtempSync(path.join(os.tmpdir(), 'noted-approve-')); snapshots = []; trashed = []; });
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
