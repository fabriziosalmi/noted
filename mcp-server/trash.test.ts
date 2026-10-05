// @vitest-environment node
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import {
  makeStamp, parseStamp, parseRetentionDays, moveToTrash, listTrash, restoreFromTrash, purgeTrash,
  trashRoot, TrashError, DEFAULT_RETENTION_DAYS,
} from './trash';

let dir: string;
beforeEach(() => { dir = fs.mkdtempSync(path.join(os.tmpdir(), 'noted-trash-')); });
afterEach(() => { fs.rmSync(dir, { recursive: true, force: true }); });

const note = (name: string, content = `<p>${name}</p>`) => {
  const p = path.join(dir, name);
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, content);
};
const exists = (name: string) => fs.existsSync(path.join(dir, name));
const D = (iso: string) => new Date(iso);

describe('stamps', () => {
  it('round-trip to the exact instant and sort chronologically', () => {
    const t = D('2026-10-05T14:30:00.123Z');
    const s = makeStamp(t, 'ab12');
    expect(s).toBe('2026-10-05T14-30-00-123Z-ab12');
    expect(parseStamp(s)?.toISOString()).toBe(t.toISOString());
    expect(makeStamp(D('2026-10-05T14:30:00.124Z'), '0000') > s).toBe(true);
  });

  it('rejects anything that is not a stamp', () => {
    for (const bad of ['', 'x', '2026-10-05', '2026-13-45T99-99-99-999Z-abcd', '2026-10-05T14-30-00-123Z', '../etc']) {
      expect(parseStamp(bad), bad).toBeNull();
    }
  });
});

describe('parseRetentionDays', () => {
  it('accepts whole days including 0 (keep forever); anything else is the default', () => {
    expect(parseRetentionDays('7')).toBe(7);
    expect(parseRetentionDays('0')).toBe(0);
    for (const bad of [undefined, '', '  ', '-1', '1.5', 'abc', '99999', 'NaN']) {
      expect(parseRetentionDays(bad), String(bad)).toBe(DEFAULT_RETENTION_DAYS);
    }
  });
});

describe('moveToTrash / listTrash', () => {
  it('moves the note out of the vault into a stamped folder, keeping its content', () => {
    note('a.md', '<p>precious</p>');
    const item = moveToTrash(dir, 'a.md', D('2026-10-05T10:00:00Z'));
    expect(exists('a.md')).toBe(false);
    expect(fs.readFileSync(path.join(trashRoot(dir), item.stamp, 'a.md'), 'utf8')).toBe('<p>precious</p>');
    expect(listTrash(dir)).toEqual([{ name: 'a.md', stamp: item.stamp, trashedAt: D('2026-10-05T10:00:00Z') }]);
  });

  it('keeps the folder, and lists newest first', () => {
    note('Work/plan.md'); note('b.md');
    moveToTrash(dir, 'Work/plan.md', D('2026-10-05T10:00:00Z'));
    moveToTrash(dir, 'b.md', D('2026-10-06T10:00:00Z'));
    expect(listTrash(dir).map(i => i.name)).toEqual(['b.md', 'Work/plan.md']);
  });

  it('keeps every deletion of the same name apart, even in the same millisecond', () => {
    const t = D('2026-10-05T10:00:00Z');
    note('a.md', 'v1'); moveToTrash(dir, 'a.md', t);
    note('a.md', 'v2'); moveToTrash(dir, 'a.md', t);
    expect(listTrash(dir)).toHaveLength(2);
  });

  it('ignores junk in the trash folder and an empty or missing trash', () => {
    expect(listTrash(dir)).toEqual([]);
    fs.mkdirSync(path.join(trashRoot(dir), 'not-a-stamp'), { recursive: true });
    fs.writeFileSync(path.join(trashRoot(dir), 'stray.md'), 'x');
    expect(listTrash(dir)).toEqual([]);
  });
});

describe('restoreFromTrash', () => {
  it('puts the newest version back at its original path, including a recreated folder', () => {
    note('Work/plan.md', 'old'); moveToTrash(dir, 'Work/plan.md', D('2026-10-05T10:00:00Z'));
    note('Work/plan.md', 'newer'); moveToTrash(dir, 'Work/plan.md', D('2026-10-06T10:00:00Z'));
    fs.rmSync(path.join(dir, 'Work'), { recursive: true });
    const item = restoreFromTrash(dir, 'Work/plan.md');
    expect(fs.readFileSync(path.join(dir, 'Work/plan.md'), 'utf8')).toBe('newer');
    expect(item.trashedAt).toEqual(D('2026-10-06T10:00:00Z'));
    expect(listTrash(dir)).toHaveLength(1); // the older version is still recoverable
  });

  it('restores a specific version by its stamp', () => {
    note('a.md', 'v1'); const first = moveToTrash(dir, 'a.md', D('2026-10-05T10:00:00Z'));
    note('a.md', 'v2'); moveToTrash(dir, 'a.md', D('2026-10-06T10:00:00Z'));
    restoreFromTrash(dir, 'a.md', first.stamp);
    expect(fs.readFileSync(path.join(dir, 'a.md'), 'utf8')).toBe('v1');
  });

  it('never overwrites a note that exists again', () => {
    note('a.md', 'gone'); moveToTrash(dir, 'a.md');
    note('a.md', 'a newer note with the same name');
    expect(() => restoreFromTrash(dir, 'a.md')).toThrow(TrashError);
    expect(fs.readFileSync(path.join(dir, 'a.md'), 'utf8')).toBe('a newer note with the same name');
    expect(listTrash(dir)).toHaveLength(1); // still in the trash
  });

  it('reports a note that is not in the trash', () => {
    expect(() => restoreFromTrash(dir, 'nope.md')).toThrow(/not in the trash/);
    note('a.md'); const i = moveToTrash(dir, 'a.md');
    expect(() => restoreFromTrash(dir, 'a.md', 'wrong-stamp')).toThrow(/not in the trash with id/);
    expect(i.stamp).toBeTruthy();
  });
});

describe('purgeTrash', () => {
  const now = D('2026-10-31T00:00:00Z');

  it('removes deletions older than the window and keeps newer ones', () => {
    note('old.md'); moveToTrash(dir, 'old.md', D('2026-09-01T00:00:00Z')); // 60 days
    note('edge.md'); moveToTrash(dir, 'edge.md', D('2026-10-01T00:00:00Z')); // exactly 30 days
    note('new.md'); moveToTrash(dir, 'new.md', D('2026-10-30T00:00:00Z'));
    expect(purgeTrash(dir, now, 30)).toBe(1);
    expect(listTrash(dir).map(i => i.name).sort()).toEqual(['edge.md', 'new.md']);
  });

  it('0 days keeps everything forever', () => {
    note('old.md'); moveToTrash(dir, 'old.md', D('2020-01-01T00:00:00Z'));
    expect(purgeTrash(dir, now, 0)).toBe(0);
    expect(listTrash(dir)).toHaveLength(1);
  });

  it('never touches anything outside recognised stamp folders', () => {
    fs.mkdirSync(path.join(trashRoot(dir), 'keep-me'), { recursive: true });
    fs.writeFileSync(path.join(trashRoot(dir), 'keep-me', 'x.md'), 'x');
    purgeTrash(dir, now, 1);
    expect(fs.existsSync(path.join(trashRoot(dir), 'keep-me', 'x.md'))).toBe(true);
  });

  it('is a no-op when there is no trash', () => {
    expect(purgeTrash(dir, now, 30)).toBe(0);
  });
});
