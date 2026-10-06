// @vitest-environment node
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { setProperty, type PropertyDeps } from './note-properties';

let dir: string;
let snapshots: { name: string; previous: string }[];
let writes: string[];
let deps: PropertyDeps;
const abs = (n: string) => path.join(dir, n);
const write = (n: string, c: string) => { fs.mkdirSync(path.dirname(abs(n)), { recursive: true }); fs.writeFileSync(abs(n), c); };
const read = (n: string) => fs.readFileSync(abs(n), 'utf8');

const make = (format: 'markdown' | 'html'): PropertyDeps => ({
  format,
  readNote: n => fs.promises.readFile(abs(n), 'utf8'),
  snapshotBefore: async (name, previous) => { snapshots.push({ name, previous }); },
  writeNote: async (n, c) => { writes.push(n); await fs.promises.writeFile(abs(n), c); },
});

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'noted-prop-'));
  snapshots = []; writes = [];
  deps = make('markdown');
});
afterEach(() => { fs.rmSync(dir, { recursive: true, force: true }); });

describe('setProperty', () => {
  it('changes only the property in the file, keeps the previous version, and returns the note\'s fields', async () => {
    const before = '---\n# mine\nstatus: open   # now\nvotes: 3\n---\n\n# Plan\n\nbody  text\r\nmore\n';
    write('Work/Plan.md', before);
    const out = await setProperty(deps, 'Work/Plan.md', 'status', 'done');
    expect(out).toEqual({ ok: true, changed: true, fields: { status: 'done', votes: 3 } });
    expect(read('Work/Plan.md')).toBe(before.replace('open   # now', 'done   # now'));
    expect(snapshots).toEqual([{ name: 'Work/Plan.md', previous: before }]);
  });

  it('adds and removes properties, and creates the block of a note that had none', async () => {
    write('a.md', '# A\n');
    expect(await setProperty(deps, 'a.md', 'tags', ['x', 'y'])).toMatchObject({ ok: true, fields: { tags: ['x', 'y'] } });
    expect(read('a.md')).toBe('---\ntags: [x, y]\n---\n\n# A\n');
    expect(await setProperty(deps, 'a.md', 'tags', undefined)).toMatchObject({ ok: true, fields: {} });
    expect(read('a.md')).toBe('---\n---\n\n# A\n');
  });

  it('writes nothing, and keeps no history, when the property already has the value', async () => {
    write('a.md', '---\nstatus: done\n---\nbody');
    expect(await setProperty(deps, 'a.md', 'status', 'done')).toMatchObject({ ok: true, changed: false });
    expect(writes).toEqual([]);
    expect(snapshots).toEqual([]);
  });

  it('compare-and-set: a stale view cannot overwrite a newer value, and is told what is there now', async () => {
    write('a.md', '---\nstatus: review\n---\nbody');
    const out = await setProperty(deps, 'a.md', 'status', 'done', { value: 'open' });
    expect(out).toEqual({ ok: false, error: expect.any(String), conflict: true, fields: { status: 'review' } });
    expect(read('a.md')).toBe('---\nstatus: review\n---\nbody');
    expect(await setProperty(deps, 'a.md', 'status', 'done', { value: 'review' })).toMatchObject({ ok: true, changed: true });
    // "was not there" is a belief too
    write('b.md', '---\nx: 1\n---\n');
    expect(await setProperty(deps, 'b.md', 'status', 'open', { value: undefined })).toMatchObject({ ok: true });
    expect(await setProperty(deps, 'b.md', 'status', 'open2', { value: undefined })).toMatchObject({ ok: false, conflict: true });
  });

  it('refuses a note whose properties it cannot edit faithfully, and a note that is not there', async () => {
    write('bad.md', '---\nstatus: [oops\n---\nbody');
    expect(await setProperty(deps, 'bad.md', 'status', 'x')).toMatchObject({ ok: false });
    expect(read('bad.md')).toBe('---\nstatus: [oops\n---\nbody');
    expect(await setProperty(deps, 'nope.md', 'status', 'x')).toEqual({ ok: false, error: 'note not found' });
    expect(writes).toEqual([]);
  });

  it('works on an HTML vault, where the properties are a comment', async () => {
    const html = make('html');
    const comment = (b: string) => `<!--noted-frontmatter:${encodeURIComponent(b)}-->`;
    write('h.md', `${comment('---\nstatus: open\n---')}\n<h1>H</h1><p>x</p>`);
    expect(await setProperty(html, 'h.md', 'status', 'done')).toMatchObject({ ok: true, fields: { status: 'done' } });
    expect(read('h.md')).toBe(`${comment('---\nstatus: done\n---')}\n<h1>H</h1><p>x</p>`);
  });
});
