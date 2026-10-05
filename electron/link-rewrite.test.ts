// @vitest-environment node
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { VaultIndex } from './vault-index';
import { applyRewrite, planRewrite, previewRewrite, type RewriteDeps } from './link-rewrite';
import { parseWikilinks, linkPointsAt } from '../shared/vault/extract';

let dir: string;
let index: VaultIndex;
let snapshots: { name: string; previous: string }[];
let deps: RewriteDeps;

const abs = (n: string) => path.join(dir, n);
const write = (n: string, c: string) => { fs.mkdirSync(path.dirname(abs(n)), { recursive: true }); fs.writeFileSync(abs(n), c); };
const read = (n: string) => fs.readFileSync(abs(n), 'utf8');

beforeEach(async () => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'noted-lr-'));
  index = new VaultIndex({ flushMs: 2 });
  snapshots = [];
  deps = {
    vaultIndex: index,
    readNote: async n => fs.promises.readFile(abs(n), 'utf8'),
    snapshotBefore: async (name, previous) => { snapshots.push({ name, previous }); },
    writeNote: async (n, c) => { await fs.promises.writeFile(abs(n), c); index.upsertFromRaw(dir, n, c); },
  };
});
afterEach(() => { fs.rmSync(dir, { recursive: true, force: true }); });

/** Rename a note on disk and in the index, the way the app does before rewriting. */
const renameOnDisk = (from: string, to: string) => {
  fs.mkdirSync(path.dirname(abs(to)), { recursive: true });
  fs.renameSync(abs(from), abs(to));
  index.renameDoc(dir, from, to);
};

describe('applyRewrite', () => {
  it('rewrites all link forms in all notes that link to the renamed one, on disk', async () => {
    write('Old.md', '<h1>Old</h1>');
    write('A.md', '<p>[[Old]]</p>');
    write('B.md', '<p>[[Old|alias]] and [[Old#Setup]]</p>');
    write('C.md', '<p><span data-wikilink="Old" class="wikilink">[[Old]]</span></p>');
    write('Unrelated.md', '<p>[[Other]]</p>');
    await index.ensure(dir);
    renameOnDisk('Old.md', 'New.md');

    const out = await applyRewrite(dir, [{ from: 'Old.md', to: 'New.md' }], deps);
    expect(out.notes).toEqual(['A.md', 'B.md', 'C.md']);
    expect(out.links).toBe(4);
    expect(out.failed).toEqual([]);
    expect(read('A.md')).toBe('<p>[[New]]</p>');
    expect(read('B.md')).toBe('<p>[[New|alias]] and [[New#Setup]]</p>');
    expect(read('C.md')).toBe('<p><span data-wikilink="New" class="wikilink">[[New]]</span></p>');
    expect(read('Unrelated.md')).toBe('<p>[[Other]]</p>'); // not even rewritten
  });

  it('snapshots each note\'s previous content before changing it (so it can be undone)', async () => {
    write('Old.md', 'x'); write('A.md', '<p>[[Old]]</p>'); write('B.md', '<p>nothing</p>');
    await index.ensure(dir);
    renameOnDisk('Old.md', 'New.md');
    await applyRewrite(dir, [{ from: 'Old.md', to: 'New.md' }], deps);
    expect(snapshots).toEqual([{ name: 'A.md', previous: '<p>[[Old]]</p>' }]);
  });

  it('also fixes a note\'s links to itself, and links from notes in folders', async () => {
    write('Old.md', '<p>I am [[Old]]</p>');
    write('Work/Idea.md', '<p>[[Old]]</p>');
    await index.ensure(dir);
    renameOnDisk('Old.md', 'New.md');
    await applyRewrite(dir, [{ from: 'Old.md', to: 'New.md' }], deps);
    expect(read('New.md')).toBe('<p>I am [[New]]</p>');
    expect(read('Work/Idea.md')).toBe('<p>[[New]]</p>');
  });

  it('handles a move between folders (the link target is the path)', async () => {
    write('Plan.md', 'x'); write('Ref.md', '<p>[[Plan]]</p>');
    await index.ensure(dir);
    renameOnDisk('Plan.md', 'Archive/Plan.md');
    await applyRewrite(dir, [{ from: 'Plan.md', to: 'Archive/Plan.md' }], deps);
    expect(read('Ref.md')).toBe('<p>[[Archive/Plan]]</p>');
  });

  it('applies a batch (folder rename) in one pass', async () => {
    write('F/One.md', 'x'); write('F/Two.md', '<p>[[F/One]]</p>'); write('Out.md', '<p>[[F/One]] [[F/Two|t]]</p>');
    await index.ensure(dir);
    fs.renameSync(abs('F'), abs('G'));
    await index.reconcile(dir);
    const out = await applyRewrite(dir, [{ from: 'F/One.md', to: 'G/One.md' }, { from: 'F/Two.md', to: 'G/Two.md' }], deps);
    expect(read('G/Two.md')).toBe('<p>[[G/One]]</p>');
    expect(read('Out.md')).toBe('<p>[[G/One]] [[G/Two|t]]</p>');
    expect(out.notes.sort()).toEqual(['G/Two.md', 'Out.md']);
  });

  it('reconciles first, so a link added moments ago (index not yet caught up) is not missed', async () => {
    write('Old.md', 'x'); write('A.md', 'nothing yet');
    await index.ensure(dir);
    write('A.md', '<p>[[Old]]</p>', undefined as never); // written behind the index's back
    fs.utimesSync(abs('A.md'), new Date(Date.now() + 5000), new Date(Date.now() + 5000));
    renameOnDisk('Old.md', 'New.md');
    await applyRewrite(dir, [{ from: 'Old.md', to: 'New.md' }], deps);
    expect(read('A.md')).toBe('<p>[[New]]</p>');
  });

  it('keeps going when one note cannot be written, and reports it', async () => {
    write('Old.md', 'x'); write('A.md', '<p>[[Old]]</p>'); write('B.md', '<p>[[Old]]</p>');
    await index.ensure(dir);
    renameOnDisk('Old.md', 'New.md');
    const flaky: RewriteDeps = { ...deps, writeNote: async (n, c) => { if (n === 'A.md') throw new Error('disk full'); return deps.writeNote(n, c); } };
    const out = await applyRewrite(dir, [{ from: 'Old.md', to: 'New.md' }], flaky);
    expect(out.notes).toEqual(['B.md']);
    expect(out.failed).toEqual([{ name: 'A.md', error: 'disk full' }]);
    expect(read('A.md')).toBe('<p>[[Old]]</p>'); // untouched, not half-written
  });

  it('is idempotent and a no-op when nothing links to the old name', async () => {
    write('Old.md', 'x'); write('A.md', '<p>[[Old]]</p>');
    await index.ensure(dir);
    renameOnDisk('Old.md', 'New.md');
    const r = [{ from: 'Old.md', to: 'New.md' }];
    await applyRewrite(dir, r, deps);
    snapshots.length = 0;
    const again = await applyRewrite(dir, r, deps);
    expect(again).toEqual({ notes: [], links: 0, failed: [] });
    expect(snapshots).toEqual([]);
    expect(await applyRewrite(dir, [], deps)).toEqual({ notes: [], links: 0, failed: [] });
  });
});

describe('planRewrite / previewRewrite (dry run)', () => {
  it('reports counts without writing', async () => {
    write('Old.md', 'x'); write('A.md', '<p>[[Old]] [[Old|b]]</p>'); write('B.md', '<p>[[Old]]</p>');
    await index.ensure(dir);
    renameOnDisk('Old.md', 'New.md');
    const r = [{ from: 'Old.md', to: 'New.md' }];
    expect(await previewRewrite(dir, r, deps)).toEqual({ notes: 2, links: 3 });
    expect((await planRewrite(dir, r, deps)).map(p => p.name)).toEqual(['A.md', 'B.md']);
    expect(read('A.md')).toBe('<p>[[Old]] [[Old|b]]</p>');
    expect(snapshots).toEqual([]);
  });
});

describe('invariant: renames never create a dangling link', () => {
  // Deterministic PRNG so a failure reproduces.
  function rng(seed: number) {
    let s = seed >>> 0;
    return () => { s = (s + 0x6d2b79f5) >>> 0; let t = s; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
  }

  it('after random renames and moves, every link that resolved before still resolves', async () => {
    const rand = rng(51);
    const pick = <T,>(a: T[]) => a[Math.floor(rand() * a.length)];
    const folders = ['', '', 'Work/', 'Home/'];
    const names = Array.from({ length: 12 }, (_, i) => `${pick(folders)}Note ${i}.md`);
    const forms = (t: string) => pick([`[[${t}]]`, `[[${t}|alias]]`, `[[${t}#Heading]]`, `[[${t.toLowerCase()}]]`]);
    for (const n of names) {
      const links = Array.from({ length: 1 + Math.floor(rand() * 3) }, () => forms(pick(names).replace(/\.md$/, '')));
      write(n, `<h1>${n}</h1><p>${links.join(' ')} [[Never existed]]</p>`);
    }
    await index.ensure(dir);

    const resolves = (target: string, notes: string[]) => notes.some(n => linkPointsAt(target, n));
    const allNotes = () => index.names(dir);
    const danglingNow = () => {
      const notes = allNotes();
      const out: string[] = [];
      for (const n of notes) for (const l of parseWikilinks(read(n))) if (!resolves(l.target, notes)) out.push(`${n} -> ${l.target}`);
      return out.sort();
    };
    const baseline = danglingNow(); // only "Never existed" links, one per note
    expect(baseline.every(d => d.endsWith('-> Never existed'))).toBe(true);

    for (let step = 0; step < 25; step++) {
      const notes = allNotes();
      const from = pick(notes);
      const to = `${pick(folders)}Renamed ${step}.md`;
      renameOnDisk(from, to);
      await applyRewrite(dir, [{ from, to }], deps);
      const now = danglingNow().map(d => d.replace(/^.* -> /, ''));
      expect(now.every(t => t === 'Never existed'), `step ${step}: ${from} -> ${to} left ${JSON.stringify(danglingNow())}`).toBe(true);
    }
    // and the links to the never-existing note were never touched
    expect(allNotes().every(n => read(n).includes('[[Never existed]]'))).toBe(true);
  });
});
