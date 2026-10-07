// @vitest-environment node
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { parsePending, MAX_PENDING } from './pending';
import { addPending, listPending, getPending, removePending, pendingDir } from './pendingFile';

let dir: string;
beforeEach(() => { dir = fs.mkdtempSync(path.join(os.tmpdir(), 'noted-pending-')); });
afterEach(() => { fs.rmSync(dir, { recursive: true, force: true }); });

const change = (over: Partial<Parameters<typeof addPending>[1]> = {}) => ({
  client: 'claude', tool: 'update_note', kind: 'update' as const, note: 'a.md', baseEtag: 'e1', before: 'old', after: 'new', ...over,
});

describe('pending changes on disk', () => {
  it('are kept as files, listed oldest first, read back, and removed', () => {
    const a = addPending(dir, change());
    const b = addPending(dir, change({ note: 'b.md', kind: 'create', baseEtag: null, before: null, after: 'x' }));
    expect(a.id).toMatch(/^[0-9a-f]{16}$/);
    expect(fs.readdirSync(pendingDir(dir)).sort()).toEqual([`${a.id}.json`, `${b.id}.json`].sort());
    expect(listPending(dir).map(c => c.id)).toEqual([a.id, b.id].sort((x, y) => (listPending(dir).find(c => c.id === x)!.createdAt <= listPending(dir).find(c => c.id === y)!.createdAt ? -1 : 1)));
    expect(getPending(dir, a.id)).toEqual(a);
    removePending(dir, a.id);
    expect(getPending(dir, a.id)).toBeNull();
    expect(listPending(dir).map(c => c.id)).toEqual([b.id]);
  });

  it('a vault with none lists none, and an id that is not one reaches nothing', () => {
    expect(listPending(dir)).toEqual([]);
    expect(getPending(dir, '../../etc/passwd')).toBeNull();
    expect(() => removePending(dir, '../x')).not.toThrow();
  });

  it('a damaged or foreign file is skipped, not trusted', () => {
    const ok = addPending(dir, change());
    fs.writeFileSync(path.join(pendingDir(dir), 'garbage.json'), '{ not json');
    fs.writeFileSync(path.join(pendingDir(dir), `${'0'.repeat(16)}.json`), JSON.stringify({ ...ok, id: 'f'.repeat(16) })); // named for another id
    fs.writeFileSync(path.join(pendingDir(dir), 'notes.txt'), 'x');
    expect(listPending(dir).map(c => c.id)).toEqual([ok.id]);
  });

  it('refuses a change that is too large, and a queue that is full', () => {
    expect(() => addPending(dir, change({ after: 'x'.repeat(5 * 1024 * 1024 + 1) }))).toThrow(/too large/);
    fs.mkdirSync(pendingDir(dir), { recursive: true });
    for (let i = 0; i < MAX_PENDING; i++) {
      const id = i.toString(16).padStart(16, '0');
      fs.writeFileSync(path.join(pendingDir(dir), `${id}.json`), JSON.stringify({ id, createdAt: new Date().toISOString(), ...change() }));
    }
    expect(() => addPending(dir, change())).toThrow(/already 200/);
  });
});

describe('parsePending', () => {
  const base = { id: 'a'.repeat(16), createdAt: '2026-10-07T10:00:00Z', client: 'c', tool: 't', note: 'a.md' };

  it('accepts the three shapes, each with what it must and must not carry', () => {
    expect(parsePending({ ...base, kind: 'create', baseEtag: null, before: null, after: 'x' })).not.toBeNull();
    expect(parsePending({ ...base, kind: 'update', baseEtag: 'e', before: 'a', after: 'b' })).not.toBeNull();
    expect(parsePending({ ...base, kind: 'delete', baseEtag: 'e', before: 'a', after: null })).not.toBeNull();
    expect(parsePending({ ...base, kind: 'create', before: 'x', after: 'y' })).toBeNull();
    expect(parsePending({ ...base, kind: 'update', before: null, after: 'y' })).toBeNull();
    expect(parsePending({ ...base, kind: 'delete', before: 'a', after: 'b' })).toBeNull();
  });

  it('refuses anything else', () => {
    for (const bad of [null, 3, [], { ...base, kind: 'rename' }, { ...base, id: 'short', kind: 'create', after: 'x' }, { ...base, createdAt: 'later', kind: 'create', after: 'x' }, { ...base, note: '', kind: 'create', after: 'x' }]) {
      expect(parsePending(bad)).toBeNull();
    }
  });
});
