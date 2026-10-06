// @vitest-environment node
import { describe, it, expect, vi } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { FullTextSearchReadModel } from './fulltext-index';

function validateName(name: string): void {
  if (!name.endsWith('.md')) throw new Error('invalid name');
}

describe('FullTextSearchReadModel', () => {
  it('indexes markdown notes and searches without reading the vault on every query', async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'noted-ft-'));
    const notePath = path.join(root, 'alpha.md');
    fs.writeFileSync(notePath, '<h1>Hello</h1><p>world example</p>', 'utf8');

    const idx = new FullTextSearchReadModel();
    const first = await idx.search(root, 'hello', validateName);
    expect(first.results.length).toBe(1);
    expect(first.results[0].relPath).toBe('alpha.md');

    fs.writeFileSync(notePath, '<p>completely different</p>', 'utf8');
    const stale = await idx.search(root, 'hello', validateName);
    expect(stale.results.length).toBe(1);

    idx.markDirty(root);
    const fresh = await idx.search(root, 'hello', validateName);
    expect(fresh.results.length).toBe(0);
  });

  it('applies incremental mutations (upsert, rename, delete) on an existing read model', async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'noted-ft-'));
    fs.writeFileSync(path.join(root, 'base.md'), '<p>base</p>', 'utf8');

    const idx = new FullTextSearchReadModel();
    await idx.search(root, 'base', validateName);

    idx.upsertFromRaw(root, 'new.md', '<p>alpha beta</p>');
    const withNew = await idx.search(root, 'beta', validateName);
    expect(withNew.results[0]?.relPath).toBe('new.md');

    idx.renameDoc(root, 'new.md', 'folder/new.md');
    const renamed = await idx.search(root, 'beta', validateName);
    expect(renamed.results[0]?.relPath).toBe('folder/new.md');

    idx.deleteDoc(root, 'folder/new.md');
    const deleted = await idx.search(root, 'beta', validateName);
    expect(deleted.results.length).toBe(0);
  });
});

describe('FullTextSearchReadModel as the retrieval source for the AI chat', () => {
  const mkVault = () => fs.mkdtempSync(path.join(os.tmpdir(), 'noted-ft-'));
  const write = (root: string, name: string, html: string, mtime?: Date) => {
    const p = path.join(root, name);
    fs.mkdirSync(path.dirname(p), { recursive: true });
    fs.writeFileSync(p, html, 'utf8');
    if (mtime) fs.utimesSync(p, mtime, mtime);
  };

  it('finds the best notes in the WHOLE vault, not just the most recent ones', async () => {
    const root = mkVault();
    // 300 recent filler notes and one OLD note holding the answer.
    for (let i = 0; i < 300; i++) write(root, `filler-${i}.md`, `<p>weekly standup agenda item ${i}</p>`, new Date(2026, 5, 1, 0, 0, i));
    write(root, 'old-answer.md', '<h1>Quokka budget</h1><p>The quokka migration budget is approved.</p>', new Date(2020, 0, 1));
    const idx = new FullTextSearchReadModel();
    const { candidates, indexed } = await idx.candidates(root, 'quokka migration budget', 5, validateName);
    expect(indexed).toBe(301);
    expect(candidates[0].name).toBe('old-answer.md');
    expect(candidates[0].text).toContain('quokka migration budget');
    expect(candidates.length).toBeLessThanOrEqual(5);
  });

  it('returns plain text capped in length, with the title and a score', async () => {
    const root = mkVault();
    write(root, 'long.md', `<h1>Long note</h1><p>needle ${'x '.repeat(20_000)}</p>`);
    const idx = new FullTextSearchReadModel();
    const { candidates } = await idx.candidates(root, 'needle', 3, validateName);
    expect(candidates[0].title).toBe('long');
    expect(candidates[0].text.length).toBeLessThanOrEqual(6000);
    expect(candidates[0].text).not.toContain('<');
    expect(candidates[0].score).toBeGreaterThan(0);
  });

  it('clamps the requested number of candidates to something sane', async () => {
    const root = mkVault();
    for (let i = 0; i < 5; i++) write(root, `n${i}.md`, '<p>alpha</p>');
    const idx = new FullTextSearchReadModel();
    expect((await idx.candidates(root, 'alpha', 0, validateName)).candidates).toHaveLength(1);
    expect((await idx.candidates(root, 'alpha', 100000, validateName)).candidates).toHaveLength(5);
  });

  it('builds the index of a large vault without opening every file at once', async () => {
    const root = mkVault();
    // More files than a default per-process file-descriptor limit (256 on macOS):
    // reading them all concurrently fails with EMFILE.
    for (let i = 0; i < 3000; i++) write(root, `bulk-${i}.md`, `<p>note number ${i} about topic${i % 50}</p>`);
    const idx = new FullTextSearchReadModel();
    const { indexed, truncated } = await idx.candidates(root, 'topic7', 5, validateName);
    expect(indexed).toBe(3000);
    expect(truncated).toBe(false);
  }, 60_000);

  it('never has more than a bounded number of notes open at once while building', async () => {
    const root = mkVault();
    for (let i = 0; i < 400; i++) write(root, `c${i}.md`, `<p>concurrency ${i}</p>`);
    const realRead = fs.promises.readFile.bind(fs.promises);
    let inFlight = 0;
    let peak = 0;
    const spy = vi.spyOn(fs.promises, 'readFile').mockImplementation((async (...args: Parameters<typeof realRead>) => {
      inFlight++; peak = Math.max(peak, inFlight);
      try { await new Promise(r => setTimeout(r, 1)); return await realRead(...args); } finally { inFlight--; }
    }) as typeof fs.promises.readFile);
    try {
      const idx = new FullTextSearchReadModel();
      await idx.candidates(root, 'concurrency', 3, validateName);
    } finally { spy.mockRestore(); }
    expect(peak).toBeGreaterThan(1);   // it does read in parallel...
    expect(peak).toBeLessThanOrEqual(32); // ...but never all at once
  });

  it('does not count embedded image data against the index: a base64-heavy note is still indexed', async () => {
    const root = mkVault();
    write(root, 'photo.md', `<p>cormorant colony</p><img src="data:image/png;base64,${'A'.repeat(3 * 1024 * 1024)}">`);
    const idx = new FullTextSearchReadModel();
    const { candidates } = await idx.candidates(root, 'cormorant', 3, validateName);
    expect(candidates.map(c => c.name)).toEqual(['photo.md']);
    expect(candidates[0].text.length).toBeLessThan(200);
  });

  it('picks up edits, new files and deletions made outside the app without a rescan', async () => {
    const root = mkVault();
    write(root, 'a.md', '<p>original words</p>');
    const idx = new FullTextSearchReadModel();
    await idx.candidates(root, 'original', 3, validateName);

    write(root, 'a.md', '<p>rewritten externally</p>', new Date(Date.now() + 5000));
    write(root, 'b.md', '<p>brand new platypus</p>');
    await idx.refreshFile(root, 'a.md');
    await idx.refreshFile(root, 'b.md');
    expect((await idx.candidates(root, 'rewritten', 3, validateName)).candidates.map(c => c.name)).toEqual(['a.md']);
    expect((await idx.candidates(root, 'original', 3, validateName)).candidates).toEqual([]);
    expect((await idx.candidates(root, 'platypus', 3, validateName)).candidates.map(c => c.name)).toEqual(['b.md']);

    fs.unlinkSync(path.join(root, 'b.md'));
    await idx.refreshFile(root, 'b.md');
    expect((await idx.candidates(root, 'platypus', 3, validateName)).candidates).toEqual([]);
  });

  it('refreshing before the vault was ever indexed is a no-op, and a burst of events is one refresh', async () => {
    const root = mkVault();
    write(root, 'a.md', '<p>zebra</p>');
    const idx = new FullTextSearchReadModel();
    await idx.refreshFile(root, 'a.md'); // nothing indexed yet: must not throw or build
    await idx.candidates(root, 'zebra', 1, validateName);
    write(root, 'a.md', '<p>giraffe</p>', new Date(Date.now() + 5000));
    for (let i = 0; i < 5; i++) idx.scheduleRefresh(root, 'a.md');
    await new Promise(r => setTimeout(r, 400));
    expect((await idx.candidates(root, 'giraffe', 1, validateName)).candidates.map(c => c.name)).toEqual(['a.md']);
  });
});


describe('FullTextSearchReadModel with nested folders (#65)', () => {
  const vaultOf = (files: Record<string, string>): string => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'noted-ft-deep-'));
    for (const [name, text] of Object.entries(files)) {
      fs.mkdirSync(path.dirname(path.join(root, name)), { recursive: true });
      fs.writeFileSync(path.join(root, name), text, 'utf8');
    }
    return root;
  };
  const strict = (name: string): void => {
    if (!name.endsWith('.md')) throw new Error('invalid name');
  };

  it('finds notes at any depth, with their full path, and never one under a hidden folder', async () => {
    const root = vaultOf({
      'Top.md': 'zebra at the top',
      'a/b/c/Deep.md': 'zebra deep down',
      '.obsidian/plugins/Plugin.md': 'zebra in a plugin',
      'a/.trash/Gone.md': 'zebra in the trash',
      '.noted/trash/2026/Old.md': 'zebra in the MCP trash',
    });
    const idx = new FullTextSearchReadModel();
    const found = await idx.search(root, 'zebra', strict);
    expect(found.results.map(r => r.relPath).sort()).toEqual(['Top.md', 'a/b/c/Deep.md']);
  });

  it('a change the watcher reports under a hidden folder, or a name no note may have, is not indexed', async () => {
    const root = vaultOf({ 'A.md': 'alpha' });
    const idx = new FullTextSearchReadModel();
    await idx.search(root, 'alpha', strict);
    for (const name of ['.obsidian/x.md', 'a/.trash/y.md', 'a/b:c.md', '.noted/trash/2026/z.md']) {
      fs.mkdirSync(path.dirname(path.join(root, name)), { recursive: true });
      fs.writeFileSync(path.join(root, name), 'quokka', 'utf8');
      await idx.refreshFile(root, name);
    }
    expect((await idx.search(root, 'quokka', strict)).results).toEqual([]);
    fs.mkdirSync(path.join(root, 'x/y'), { recursive: true });
    fs.writeFileSync(path.join(root, 'x/y/Ok.md'), 'quokka', 'utf8');
    await idx.refreshFile(root, 'x/y/Ok.md');
    expect((await idx.search(root, 'quokka', strict)).results.map(r => r.relPath)).toEqual(['x/y/Ok.md']);
  });
});
