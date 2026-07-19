// @vitest-environment node
import { describe, it, expect } from 'vitest';
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
