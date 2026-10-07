// @vitest-environment node
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { NoteFormat } from '../shared/vault/format';
import { plainBody, writeCapture, type CaptureDeps } from './capture-write';

let dir: string;
let snapshots: { name: string; previous: string }[];
let clock: Date;
const abs = (n: string) => path.join(dir, n);
const read = (n: string) => fs.readFileSync(abs(n), 'utf8');

const deps = (format: NoteFormat = 'markdown'): CaptureDeps => ({
  format,
  now: () => clock,
  readNote: async n => { try { return await fs.promises.readFile(abs(n), 'utf8'); } catch { return null; } },
  writeNote: async (n, c) => { await fs.promises.writeFile(abs(n), c); },
  snapshotBefore: async (name, previous) => { snapshots.push({ name, previous }); },
  daily: () => ({ title: 'Wednesday, October 7, 2026', notes: 'Notes', todo: 'To do', ideas: 'Ideas' }),
  newNoteBody: plainBody(format, s => s),
});

beforeEach(() => { dir = fs.mkdtempSync(path.join(os.tmpdir(), 'noted-capture-')); snapshots = []; clock = new Date(2026, 9, 7, 14, 32, 5); });
afterEach(() => { fs.rmSync(dir, { recursive: true, force: true }); });

describe('capture to a new note', () => {
  it('is what it always was: a Capture_ note of its own, one per capture', async () => {
    const a = await writeCapture(deps(), 'first', 'new');
    const b = await writeCapture(deps(), 'second', 'new');
    expect(a.fileName).toMatch(/^Capture_2026-10-07_14-32-05_[0-9a-f]{4}\.md$/);
    expect(a.fileName).not.toBe(b.fileName);
    expect(a.created).toBe(true);
    expect(read(a.fileName)).toBe('first\n');
  });
});

describe('capture to the daily note', () => {
  it('makes today\'s note, with its sections, when there is none, and puts the line in the first one', async () => {
    const r = await writeCapture(deps(), 'call Paolo', 'daily');
    expect(r).toEqual({ fileName: '2026-10-07.md', created: true });
    expect(read('2026-10-07.md')).toBe('# Wednesday, October 7, 2026\n\n## Notes\n\n**14:32** call Paolo\n\n## To do\n\n-\n\n## Ideas\n');
    expect(snapshots).toEqual([]);
  });

  it('adds to the note that is there, keeping what is in it and the version before', async () => {
    const before = '# Wednesday, October 7, 2026\n\n## Notes\n\nmy own words\n\n## To do\n\n- [ ] ship it\n\n## Ideas\n';
    fs.writeFileSync(abs('2026-10-07.md'), before);
    const r = await writeCapture(deps(), 'a thought', 'daily');
    expect(r.created).toBe(false);
    expect(read('2026-10-07.md')).toBe('# Wednesday, October 7, 2026\n\n## Notes\n\nmy own words\n\n**14:32** a thought\n\n## To do\n\n- [ ] ship it\n\n## Ideas\n');
    expect(snapshots).toEqual([{ name: '2026-10-07.md', previous: before }]);
  });

  it('is a different note the next day', async () => {
    await writeCapture(deps(), 'today', 'daily');
    clock = new Date(2026, 9, 8, 8, 0, 0);
    const r = await writeCapture(deps(), 'tomorrow', 'daily');
    expect(r.fileName).toBe('2026-10-08.md');
    expect(read('2026-10-07.md')).not.toContain('tomorrow');
  });

  it('writes an html vault in html', async () => {
    await writeCapture(deps('html'), 'a & b', 'daily');
    const out = read('2026-10-07.md');
    expect(out).toBe('<h1>Wednesday, October 7, 2026</h1><h2>Notes</h2><p><strong>14:32</strong> a &amp; b</p><h2>To do</h2><ul><li><p></p></li></ul><h2>Ideas</h2><p></p>');
  });
});

describe('capture to the inbox', () => {
  it('starts an Inbox note, then goes on adding to the end of it', async () => {
    const first = await writeCapture(deps(), 'one', 'inbox');
    clock = new Date(2026, 9, 7, 15, 0, 0);
    const second = await writeCapture(deps(), 'two', 'inbox');
    expect(first).toEqual({ fileName: 'Inbox.md', created: true });
    expect(second).toEqual({ fileName: 'Inbox.md', created: false });
    expect(read('Inbox.md')).toBe('# Inbox\n\n**14:32** one\n\n**15:00** two\n');
    expect(snapshots).toHaveLength(1);
  });
});
