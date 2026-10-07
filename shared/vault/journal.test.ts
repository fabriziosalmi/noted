// @vitest-environment node
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { sealEntry, verifyChain, entryHash, parseEntry, revertedIds, type JournalEntry, type JournalFields } from './journal';
import { appendEntry, readEntries, readBlob, verifyJournal, journalDir, type JournalInput } from './journalFile';
import { sha256Hex } from './etag';

const fields = (seq: number, over: Partial<JournalFields> = {}): JournalFields => ({
  seq, id: `id${seq}`, at: '2026-10-07T10:00:00.000Z', client: 'claude', session: 's1', tool: 'update_note', via: 'direct',
  kind: 'update', note: 'a.md', beforeHash: 'a'.repeat(64), afterHash: 'b'.repeat(64), ...over,
});
const chain = (n: number): JournalEntry[] => {
  const out: JournalEntry[] = [];
  for (let i = 1; i <= n; i++) out.push(sealEntry(out.at(-1)?.hash ?? null, fields(i)));
  return out;
};

describe('the chain', () => {
  it('a journal written in order is intact, whatever its length, and the empty one too', () => {
    expect(verifyChain([])).toEqual({ ok: true, entries: 0 });
    expect(verifyChain(chain(5))).toEqual({ ok: true, entries: 5 });
  });

  it('an entry that was edited is found at that entry', () => {
    const c = chain(5);
    c[2] = { ...c[2], note: 'other.md' };
    expect(verifyChain(c)).toEqual({ ok: false, at: 3, reason: 'it was changed after it was written' });
    const hashes = chain(3);
    hashes[1] = { ...hashes[1], afterHash: 'c'.repeat(64) };
    expect(verifyChain(hashes)).toMatchObject({ ok: false, at: 2 });
  });

  it('an entry that was removed, reordered or forged is found', () => {
    const c = chain(5);
    expect(verifyChain([c[0], c[1], c[3], c[4]])).toMatchObject({ ok: false, at: 4, reason: 'an entry is missing or out of order' });
    expect(verifyChain([c[1], c[0]])).toMatchObject({ ok: false });
    expect(verifyChain(c.slice(1))).toMatchObject({ ok: false, at: 2, reason: expect.stringContaining('begin') });
    const forged = sealEntry('f'.repeat(64), fields(3)); // a plausible entry that does not follow the real one
    expect(verifyChain([c[0], c[1], forged])).toMatchObject({ ok: false, at: 3, reason: 'it does not follow the entry before it' });
  });

  it('the hash covers everything an entry says, and nothing else', () => {
    const a = sealEntry(null, fields(1));
    expect(a.hash).toBe(entryHash(null, fields(1)));
    for (const change of [{ client: 'x' }, { tool: 'x' }, { via: 'approval' as const }, { kind: 'create' as const }, { note: 'x.md' }, { noContent: true }, { revertOf: 'y' }, { at: '2026-10-08T10:00:00.000Z' }, { session: 's2' }]) {
      expect(entryHash(null, fields(1, change))).not.toBe(a.hash);
    }
    expect(entryHash('p'.repeat(64), fields(1))).not.toBe(a.hash);
  });
});

describe('parseEntry', () => {
  it('reads what sealEntry wrote, and nothing malformed', () => {
    const e = sealEntry(null, fields(1, { revertOf: 'x', noContent: true }));
    expect(parseEntry(JSON.parse(JSON.stringify(e)))).toEqual(e);
    for (const bad of [null, 1, [], { ...e, via: 'sideways' }, { ...e, kind: 'rename' }, { ...e, seq: 0 }, { ...e, hash: 'short' }, { ...e, beforeHash: 'zz' }, { ...e, at: 'later' }, { ...e, note: '' }]) {
      expect(parseEntry(bad)).toBeNull();
    }
  });

  it('revertedIds lists what has been undone', () => {
    const c = [sealEntry(null, fields(1)), sealEntry(null, fields(2, { via: 'revert', revertOf: 'id1' }))];
    expect([...revertedIds(c)]).toEqual(['id1']);
  });
});

describe('the files', () => {
  let dir: string;
  beforeEach(() => { dir = fs.mkdtempSync(path.join(os.tmpdir(), 'noted-journal-')); });
  afterEach(() => { fs.rmSync(dir, { recursive: true, force: true }); });
  const input = (over: Partial<JournalInput> = {}): JournalInput => ({
    client: 'claude', session: 's1', tool: 'update_note', via: 'direct', kind: 'update', note: 'a.md', before: 'old', after: 'new', ...over,
  });

  it('appends entries that chain from one to the next, keep the content by hash, and verify', () => {
    const a = appendEntry(dir, input());
    const b = appendEntry(dir, input({ before: 'new', after: 'newer', note: 'b.md' }));
    expect([a.seq, b.seq]).toEqual([1, 2]);
    expect(b.prev).toBe(a.hash);
    expect(a.beforeHash).toBe(sha256Hex('old'));
    expect(readBlob(dir, a.beforeHash!)).toBe('old');
    expect(readBlob(dir, b.afterHash!)).toBe('newer');
    expect(fs.readdirSync(path.join(journalDir(dir), 'blobs'))).toHaveLength(3); // old, new, newer: "new" is stored once
    expect(readEntries(dir)).toEqual({ entries: [a, b], damaged: 0 });
    expect(verifyJournal(dir)).toEqual({ ok: true, entries: 2 });
  });

  it('a creation has no before, a deletion no after', () => {
    const c = appendEntry(dir, input({ kind: 'create', before: null, after: 'x' }));
    const d = appendEntry(dir, input({ kind: 'delete', before: 'x', after: null }));
    expect([c.beforeHash, d.afterHash]).toEqual([null, null]);
    expect(verifyJournal(dir).ok).toBe(true);
  });

  it('a tampered line, a removed line and a stray line are all found', () => {
    for (let i = 0; i < 4; i++) appendEntry(dir, input({ after: `v${i}` }));
    const file = path.join(journalDir(dir), fs.readdirSync(journalDir(dir)).find(f => f.endsWith('.jsonl'))!);
    const lines = fs.readFileSync(file, 'utf8').split('\n').filter(Boolean);
    fs.writeFileSync(file, `${[lines[0], lines[1].replace('a.md', 'zzz.md'), lines[2], lines[3]].join('\n')}\n`);
    expect(verifyJournal(dir)).toMatchObject({ ok: false, at: 2 });
    fs.writeFileSync(file, `${[lines[0], lines[2], lines[3]].join('\n')}\n`);
    expect(verifyJournal(dir)).toMatchObject({ ok: false });
    fs.writeFileSync(file, `${lines.join('\n')}\nnot an entry\n`);
    expect(verifyJournal(dir)).toMatchObject({ ok: false, reason: expect.stringContaining('not entries') });
    fs.writeFileSync(file, `${lines.join('\n')}\n`);
    expect(verifyJournal(dir)).toEqual({ ok: true, entries: 4 });
  });

  it('continues across days: the chain runs from the last entry of an earlier file', () => {
    const first = appendEntry(dir, input());
    fs.renameSync(path.join(journalDir(dir), `${first.at.slice(0, 10)}.jsonl`), path.join(journalDir(dir), '2020-01-01.jsonl'));
    const second = appendEntry(dir, input({ after: 'later' }));
    expect(second.prev).toBe(first.hash);
    expect(second.seq).toBe(2);
    expect(verifyJournal(dir)).toEqual({ ok: true, entries: 2 });
  });

  it('content over the limit is recorded by hash only, and flagged', () => {
    const big = 'x'.repeat(5 * 1024 * 1024 + 1);
    const e = appendEntry(dir, input({ before: 'small', after: big }));
    expect(e.noContent).toBe(true);
    expect(e.afterHash).toBe(sha256Hex(big));
    expect(readBlob(dir, e.afterHash!)).toBeNull();
    expect(verifyJournal(dir).ok).toBe(true);
  });

  it('a hash that is not a hash reads nothing, and an empty journal is intact', () => {
    expect(readBlob(dir, '../../etc/passwd')).toBeNull();
    expect(readEntries(dir)).toEqual({ entries: [], damaged: 0 });
    expect(verifyJournal(dir)).toEqual({ ok: true, entries: 0 });
  });

  it('a stale lock does not stop it, and a fresh one is waited for then reported', () => {
    fs.mkdirSync(journalDir(dir), { recursive: true });
    const lock = path.join(journalDir(dir), '.lock');
    fs.writeFileSync(lock, '');
    const old = new Date(Date.now() - 60_000);
    fs.utimesSync(lock, old, old);
    expect(appendEntry(dir, input()).seq).toBe(1);
    expect(fs.existsSync(lock)).toBe(false);
  });
});
