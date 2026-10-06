// @vitest-environment node
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { VaultIndex, type IndexDelta } from './vault-index';

let dir: string;
let deltas: IndexDelta[];
let index: VaultIndex;

const write = (name: string, content: string, mtime?: Date) => {
  const p = path.join(dir, name);
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, content);
  if (mtime) fs.utimesSync(p, mtime, mtime);
};
const mk = (opts: ConstructorParameters<typeof VaultIndex>[0] = {}) =>
  new VaultIndex({ flushMs: 5, onDelta: (_d, delta) => deltas.push(delta), ...opts });

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'noted-vi-'));
  deltas = [];
  index = mk();
});
afterEach(() => { fs.rmSync(dir, { recursive: true, force: true }); });

describe('initial scan', () => {
  it('indexes every note in the vault: links, tags, headings, frontmatter, in folders too', async () => {
    write('A.md', '<h1>Alpha</h1><p>see [[B]] and [[Work/C|the c]] #idea</p>');
    write('B.md', '---\ntitle: B\nstatus: x\n---\n# Bee\n#idea #other');
    write('Work/C.md', '<p>[[A#Alpha]] #project/aurora</p>');
    write('Work/readme.txt', '[[A]] #nope');           // not a note
    write('.hidden/D.md', '[[A]] #nope');               // dot directory
    write('Work/deeper/E.md', '[[A]] #nope');           // only one folder level
    const snap = await index.snapshot(dir);
    expect(Object.keys(snap.notes).sort()).toEqual(['A.md', 'B.md', 'Work/C.md']);
    expect(snap.notes['A.md']).toEqual({ links: ['B', 'Work/C'], tags: ['#idea'] });
    expect(snap.notes['Work/C.md']).toEqual({ links: ['A'], tags: ['#project/aurora'] });
    const b = index.get(dir, 'B.md')!;
    expect(b.headings).toEqual([{ level: 1, text: 'Bee' }]);
    expect(b.frontmatterKeys).toEqual(['title', 'status']);
    expect(index.tagIndex(dir)).toEqual({ '#idea': ['A.md', 'B.md'], '#other': ['B.md'], '#project/aurora': ['Work/C.md'] });
  });

  it('computes backlinks from alias and heading links, case-insensitively', async () => {
    write('Target.md', '<p>t</p>');
    write('One.md', '[[Target]]');
    write('Two.md', '[[target|alias]]');
    write('Three.md', '[[Target#Setup]]');
    write('Four.md', '[[Target2]]');
    await index.ensure(dir);
    expect(index.backlinks(dir, 'Target.md')).toEqual(['One.md', 'Three.md', 'Two.md']);
  });

  it('skips an unreadable vault and a missing one without throwing', async () => {
    const snap = await index.snapshot(path.join(dir, 'does-not-exist'));
    expect(snap.notes).toEqual({});
  });

  it('lists but does not parse notes above the size cap (embedded media)', async () => {
    index = mk({ maxParseBytes: 100 });
    write('Big.md', `[[A]] #t ${'x'.repeat(500)}`);
    write('Small.md', '[[A]] #t');
    const snap = await index.snapshot(dir);
    expect(snap.notes['Big.md']).toEqual({ links: [], tags: [] });
    expect(snap.notes['Small.md']).toEqual({ links: ['A'], tags: ['#t'] });
  });

  it('honours the name validator', async () => {
    index = mk({ validateFileName: n => { if (n.includes(';')) throw new Error('bad'); } });
    write('ok.md', 'x'); write('bad;name.md', 'x');
    expect(Object.keys((await index.snapshot(dir)).notes)).toEqual(['ok.md']);
  });
});

describe('incremental updates (the app\'s own writes)', () => {
  beforeEach(async () => { write('A.md', '[[B]] #one'); write('B.md', 'x'); await index.ensure(dir); deltas.length = 0; });

  it('upsertFromRaw replaces a note and emits one delta carrying only what changed', async () => {
    index.upsertFromRaw(dir, 'A.md', '[[C]] #two');
    await index.flushNow(dir);
    expect(index.get(dir, 'A.md')!.linkTargets).toEqual(['C']);
    expect(index.tagIndex(dir)['#one']).toBeUndefined();
    expect(deltas).toHaveLength(1);
    expect(deltas[0].upserts).toEqual({ 'A.md': { links: ['C'], tags: ['#two'] } });
    expect(deltas[0].removals).toEqual([]);
  });

  it('coalesces a burst of saves into one delta with the final state', async () => {
    for (const t of ['#a', '#b', '#c']) index.upsertFromRaw(dir, 'A.md', t);
    await index.flushNow(dir);
    expect(deltas).toHaveLength(1);
    expect(deltas[0].upserts['A.md'].tags).toEqual(['#c']);
  });

  it('rename moves the entry: old name removed, new name present with the same data', async () => {
    index.renameDoc(dir, 'A.md', 'Renamed.md');
    await index.flushNow(dir);
    expect(index.get(dir, 'A.md')).toBeUndefined();
    expect(index.get(dir, 'Renamed.md')!.linkTargets).toEqual(['B']);
    expect(deltas[0].removals).toEqual(['A.md']);
    expect(Object.keys(deltas[0].upserts)).toEqual(['Renamed.md']);
  });

  it('delete removes the note everywhere', async () => {
    index.deleteDoc(dir, 'A.md');
    await index.flushNow(dir);
    expect(index.names(dir)).toEqual(['B.md']);
    expect(index.tagIndex(dir)).toEqual({});
    expect(deltas[0].removals).toEqual(['A.md']);
  });

  it('deleting something unknown emits nothing', async () => {
    index.deleteDoc(dir, 'nope.md');
    await index.flushNow(dir);
    expect(deltas).toEqual([]);
  });

  it('a note renamed and then re-created is reported as present, not removed', async () => {
    index.deleteDoc(dir, 'A.md');
    index.upsertFromRaw(dir, 'A.md', '[[B]] #back');
    await index.flushNow(dir);
    expect(deltas[0].removals).toEqual([]);
    expect(deltas[0].upserts['A.md'].tags).toEqual(['#back']);
  });

  it('clearDir (wipe) empties the index and reports every removal', async () => {
    index.clearDir(dir);
    await index.flushNow(dir);
    expect(index.names(dir)).toEqual([]);
    expect(deltas[0].removals.sort()).toEqual(['A.md', 'B.md']);
  });

  it('does nothing for a vault it was never asked to index', () => {
    index.upsertFromRaw('/somewhere/else', 'X.md', '#x');
    index.deleteDoc('/somewhere/else', 'X.md');
    expect(index.get('/somewhere/else', 'X.md')).toBeUndefined();
  });
});

describe('external changes (watcher / bulk operations)', () => {
  beforeEach(async () => { write('A.md', '[[B]] #one'); write('B.md', 'x'); await index.ensure(dir); deltas.length = 0; });

  it('touch picks up an edit made behind the app\'s back', async () => {
    write('A.md', '[[Z]] #edited', new Date(Date.now() + 5000));
    await index.touch(dir, 'A.md');
    await index.flushNow(dir);
    expect(index.get(dir, 'A.md')!.linkTargets).toEqual(['Z']);
    expect(deltas[0].upserts['A.md'].tags).toEqual(['#edited']);
  });

  it('touch notices a new file and a deleted file', async () => {
    write('New.md', '#fresh');
    await index.touch(dir, 'New.md');
    fs.unlinkSync(path.join(dir, 'B.md'));
    await index.touch(dir, 'B.md');
    await index.flushNow(dir);
    expect(index.names(dir)).toEqual(['A.md', 'New.md']);
  });

  it('touch of an unchanged note is a no-op (no delta, no re-read)', async () => {
    await index.touch(dir, 'A.md');
    await index.flushNow(dir);
    expect(deltas).toEqual([]);
  });

  it('our own save followed by the watcher\'s echo does not produce a second delta', async () => {
    write('A.md', '[[C]] #mine');
    index.upsertFromRaw(dir, 'A.md', '[[C]] #mine'); // stats the file we just wrote
    await index.flushNow(dir);
    deltas.length = 0;
    await index.touch(dir, 'A.md'); // watcher event for the same write
    await index.flushNow(dir);
    expect(deltas).toEqual([]);
  });

  it('scheduleTouch debounces a burst of events for one note into one re-read', async () => {
    write('A.md', '[[Q]] #burst', new Date(Date.now() + 5000));
    for (let i = 0; i < 5; i++) index.scheduleTouch(dir, 'A.md');
    await index.flushNow(dir); // settles the single pending (debounced) touch
    expect(deltas).toHaveLength(1);
    expect(deltas[0].upserts['A.md'].tags).toEqual(['#burst']);
  });

  it('reconcile repairs the index after a bulk change: folder renamed, files added and removed', async () => {
    write('Old/X.md', '[[A]] #x');
    await index.reconcile(dir);
    deltas.length = 0;
    fs.renameSync(path.join(dir, 'Old'), path.join(dir, 'New'));
    fs.unlinkSync(path.join(dir, 'B.md'));
    write('C.md', '#c');
    await index.reconcile(dir);
    await index.flushNow(dir);
    expect(index.names(dir)).toEqual(['A.md', 'C.md', 'New/X.md']);
    expect(deltas.flatMap(d => d.removals).sort()).toEqual(['B.md', 'Old/X.md']);
  });
});

describe('bookkeeping files are never indexed', () => {
  it('ignores hidden folders, deeper paths and non-notes in every entry point', async () => {
    write('A.md', '#a');
    await index.ensure(dir);
    deltas.length = 0;
    for (const name of ['.noted/trash/2026-x/old.md', '.noted_history/A.md/s.md', 'a/b/c.md', '.hidden.md', 'notes.txt']) {
      write(name, '[[A]] #nope', new Date(Date.now() + 5000));
      index.upsertFromRaw(dir, name, '#nope');
      await index.touch(dir, name);
      index.scheduleTouch(dir, name);
      index.renameDoc(dir, 'A.md', name);   // a rename INTO such a name drops the old note
      index.upsertFromRaw(dir, 'A.md', '#a');
    }
    await index.flushNow(dir);
    expect(index.names(dir)).toEqual(['A.md']);
    expect(Object.values(index.tagIndex(dir)).flat()).toEqual(['A.md']);
  });
});

describe('invariant: incremental updates equal a cold rescan', () => {
  it('after a mixed sequence of operations, the live index matches a freshly built one', async () => {
    write('A.md', '[[B]] #a'); write('B.md', '#b'); write('Work/C.md', '[[A|x]] #c');
    await index.ensure(dir);
    // the app saves, renames, deletes; something else edits and adds
    write('A.md', '[[B]] [[Work/C]] #a2'); index.upsertFromRaw(dir, 'A.md', '[[B]] [[Work/C]] #a2');
    fs.renameSync(path.join(dir, 'B.md'), path.join(dir, 'B2.md')); index.renameDoc(dir, 'B.md', 'B2.md');
    fs.unlinkSync(path.join(dir, 'Work/C.md')); index.deleteDoc(dir, 'Work/C.md');
    write('D.md', '[[A]] #d', new Date(Date.now() + 9000)); await index.touch(dir, 'D.md');
    await index.flushNow(dir);

    const cold = mk();
    const live = await index.snapshot(dir);
    const fresh = await cold.snapshot(dir);
    expect(live.notes).toEqual(fresh.notes);
  });
});

describe('snapshot / delta sequencing', () => {
  it('delta sequence numbers always exceed the snapshot they follow', async () => {
    write('A.md', '#a');
    const snap = await index.snapshot(dir);
    index.upsertFromRaw(dir, 'A.md', '#b');
    await index.flushNow(dir);
    expect(deltas[0].seq).toBeGreaterThan(snap.seq);
    index.upsertFromRaw(dir, 'A.md', '#c');
    await index.flushNow(dir);
    expect(deltas[1].seq).toBeGreaterThan(deltas[0].seq);
  });

  it('a save that lands while the first scan is still running is not overwritten by the scan', async () => {
    for (let i = 0; i < 200; i++) write(`n${i}.md`, `#old${i}`);
    const ready = index.ensure(dir);
    index.upsertFromRaw(dir, 'n0.md', '#fresh');
    write('n0.md', '#stale-on-disk-after-save'); // a scan reading now would see different text
    await ready;
    expect(index.get(dir, 'n0.md')!.tags).toEqual(['#fresh']);
  });
});

describe('a Markdown vault (ADR 0001)', () => {
  const markdownVault = () => fs.writeFileSync(path.join(dir, '.noted-vault.json'), JSON.stringify({ format: 'markdown' }));

  it('reads a note that starts with "<" as Markdown, and does not take tags from its frontmatter', async () => {
    markdownVault();
    write('A.md', '---\ntitle: x\n# not-a-tag\n---\n<kbd>Ctrl</kbd> then [[B]]\n\n## Setup #idea\n');
    await index.ensure(dir);
    const a = index.get(dir, 'A.md')!;
    expect(a.linkTargets).toEqual(['B']);
    expect(a.tags).toEqual(['#idea']);
    expect(a.headings).toEqual([{ level: 2, text: 'Setup #idea' }]);
    expect(a.frontmatterKeys).toEqual(['title']);
  });

  it('indexes a vault that is converted while the app runs, without a restart', async () => {
    write('A.md', '<h1>Alpha</h1><p>[[B]] #one</p>');
    await index.ensure(dir);
    expect(index.get(dir, 'A.md')!.headings).toEqual([{ level: 1, text: 'Alpha' }]);

    fs.writeFileSync(path.join(dir, 'A.md'), '# Alpha\n\n[[B]] #one\n\n<kbd>x</kbd> #two\n');
    markdownVault();
    await index.reconcile(dir);
    const a = index.get(dir, 'A.md')!;
    expect(a.headings).toEqual([{ level: 1, text: 'Alpha' }]);
    expect(a.tags).toEqual(['#one', '#two']);
  });

  it('notices the marker arriving on its own (a Git pull of a converted vault)', async () => {
    write('A.md', '# Alpha\n');
    await index.ensure(dir);
    markdownVault();
    write('B.md', '# Beta\n\n<b>bold</b> #t\n');
    await index.touch(dir, 'B.md');
    expect(index.get(dir, 'B.md')!.headings).toEqual([{ level: 1, text: 'Beta' }]);
  });
});
