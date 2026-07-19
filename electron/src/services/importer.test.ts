// @vitest-environment node
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

// importer.ts imports { app, ipcMain, dialog } from 'electron' at module load;
// stub it so the module can be imported in a plain node test. importVaultRecursive
// itself only touches fs/path, so we exercise it against real temp directories.
vi.mock('electron', () => ({
  app: { getPath: () => '/tmp' },
  ipcMain: { handle: () => { /* noop: handler registration is not exercised here */ } },
  dialog: {},
}));

import { importVaultRecursive } from './importer';

describe('importVaultRecursive', () => {
  let src: string;
  let dest: string;

  beforeEach(() => {
    src = fs.mkdtempSync(path.join(os.tmpdir(), 'noted-import-src-'));
    dest = fs.mkdtempSync(path.join(os.tmpdir(), 'noted-import-dest-'));
  });
  afterEach(() => {
    fs.rmSync(src, { recursive: true, force: true });
    fs.rmSync(dest, { recursive: true, force: true });
  });

  const write = (root: string, rel: string, content = 'x') => {
    const p = path.join(root, rel);
    fs.mkdirSync(path.dirname(p), { recursive: true });
    fs.writeFileSync(p, content);
  };

  it('copies only markdown + whitelisted media and ignores other extensions', () => {
    write(src, 'a.md');
    write(src, 'b.png');
    write(src, 'd.pdf');
    write(src, 'c.txt'); // ignored
    write(src, 'e.exe'); // ignored

    const count = importVaultRecursive(src, src, dest);

    expect(count).toBe(3);
    expect(fs.existsSync(path.join(dest, 'a.md'))).toBe(true);
    expect(fs.existsSync(path.join(dest, 'b.png'))).toBe(true);
    expect(fs.existsSync(path.join(dest, 'd.pdf'))).toBe(true);
    expect(fs.existsSync(path.join(dest, 'c.txt'))).toBe(false);
    expect(fs.existsSync(path.join(dest, 'e.exe'))).toBe(false);
  });

  it('flattens nested folders to one level and strips reserved characters', () => {
    // Nested two levels, with reserved chars ($ and ;) in the folder names.
    write(src, path.join('Level$One', 'Sub;Two', 'note.md'));

    const count = importVaultRecursive(src, src, dest);

    expect(count).toBe(1);
    // "Level$One/Sub;Two" -> slashes to '-', then reserved chars removed -> "LevelOne-SubTwo"
    expect(fs.existsSync(path.join(dest, 'LevelOne-SubTwo', 'note.md'))).toBe(true);
    expect(fs.existsSync(path.join(dest, 'Level$One'))).toBe(false);
  });

  it('skips hidden folders and hidden files', () => {
    write(src, path.join('.obsidian', 'workspace.md')); // hidden folder -> skipped
    write(src, '.secret.md'); // hidden file -> skipped
    write(src, 'visible.md');

    const count = importVaultRecursive(src, src, dest);

    expect(count).toBe(1);
    expect(fs.existsSync(path.join(dest, 'visible.md'))).toBe(true);
    expect(fs.existsSync(path.join(dest, 'obsidian'))).toBe(false);
    expect(fs.existsSync(path.join(dest, '.secret.md'))).toBe(false);
  });

  it('does not overwrite existing destination files', () => {
    write(src, 'note.md', 'NEW');
    fs.writeFileSync(path.join(dest, 'note.md'), 'OLD');

    const count = importVaultRecursive(src, src, dest);

    expect(count).toBe(0); // existing file skipped, not counted
    expect(fs.readFileSync(path.join(dest, 'note.md'), 'utf-8')).toBe('OLD');
  });
});
