// @vitest-environment node
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { toggleTask, type TaskDeps } from './note-tasks';

let dir: string;
let snapshots: string[];
const abs = (n: string) => path.join(dir, n);
const deps = (format: 'markdown' | 'html' = 'markdown'): TaskDeps => ({
  format,
  readNote: n => fs.promises.readFile(abs(n), 'utf8'),
  snapshotBefore: async (_n, previous) => { snapshots.push(previous); },
  writeNote: (n, c) => fs.promises.writeFile(abs(n), c),
});
beforeEach(() => { dir = fs.mkdtempSync(path.join(os.tmpdir(), 'noted-task-')); snapshots = []; });
afterEach(() => { fs.rmSync(dir, { recursive: true, force: true }); });

const NOTE = '---\ntitle: x\n---\n# T\n\n- [ ] first 📅 2026-10-10\n- [ ] second\n\ntext  with   spacing\n';

describe('toggleTask', () => {
  it('ticks the one task, changes one character, and keeps the version before', async () => {
    fs.writeFileSync(abs('a.md'), NOTE);
    expect(await toggleTask(deps(), 'a.md', 7, 'second', true)).toEqual({ ok: true, changed: true });
    expect(fs.readFileSync(abs('a.md'), 'utf8')).toBe(NOTE.replace('- [ ] second', '- [x] second'));
    expect(snapshots).toEqual([NOTE]);
    expect(await toggleTask(deps(), 'a.md', 7, 'second', false)).toEqual({ ok: true, changed: true });
    expect(fs.readFileSync(abs('a.md'), 'utf8')).toBe(NOTE);
  });

  it('writes nothing when it already is as asked', async () => {
    fs.writeFileSync(abs('a.md'), NOTE);
    expect(await toggleTask(deps(), 'a.md', 7, 'second', false)).toEqual({ ok: true, changed: false });
    expect(snapshots).toEqual([]);
  });

  it('refuses a task that moved or changed since it was listed, and leaves the file alone', async () => {
    fs.writeFileSync(abs('a.md'), `\n${NOTE}`); // a line was added above: line 7 is now something else
    const r = await toggleTask(deps(), 'a.md', 7, 'second', true);
    expect(r.ok).toBe(false);
    expect(fs.readFileSync(abs('a.md'), 'utf8')).toBe(`\n${NOTE}`);
  });

  it('a missing note, and an HTML vault', async () => {
    expect(await toggleTask(deps(), 'nope.md', 1, 'x', true)).toEqual({ ok: false, error: 'note not found' });
    expect((await toggleTask(deps('html'), 'a.md', 1, 'x', true)).ok).toBe(false);
  });
});
