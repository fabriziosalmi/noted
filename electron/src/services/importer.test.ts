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

  it('keeps the folder structure, and strips reserved characters from each name', () => {
    // Nested two levels, with reserved chars ($ and ;) in the folder names.
    write(src, path.join('Level$One', 'Sub;Two', 'note.md'));
    write(src, path.join('Level$One', 'top.md'));

    const count = importVaultRecursive(src, src, dest);

    expect(count).toBe(2);
    expect(fs.existsSync(path.join(dest, 'LevelOne', 'SubTwo', 'note.md'))).toBe(true);
    expect(fs.existsSync(path.join(dest, 'LevelOne', 'top.md'))).toBe(true);
    expect(fs.existsSync(path.join(dest, 'Level$One'))).toBe(false);
    expect(fs.existsSync(path.join(dest, 'LevelOne-SubTwo'))).toBe(false);
  });

  it('flattens a tree the vault would not accept as it is (too deep, or a name that cannot be made valid)', () => {
    write(src, path.join(...Array.from({ length: 18 }, (_, i) => `d${i}`), 'deep.md'));
    write(src, path.join('con', 'device.md'));
    importVaultRecursive(src, src, dest);
    const names = fs.readdirSync(dest).sort();
    expect(names).toHaveLength(2);
    expect(names).toContain('Imported'); // "con" is a device name no folder can have on Windows: no valid name to flatten into
    expect(names.find(n => n !== 'Imported')).toMatch(/^d0-d1-d2-/);
    expect(fs.existsSync(path.join(dest, 'Imported', 'device.md'))).toBe(true);
  });

  it('does not copy a link: it would read whatever the link points at', () => {
    const outside = fs.mkdtempSync(path.join(os.tmpdir(), 'noted-imp-outside-'));
    fs.writeFileSync(path.join(outside, 'secret.txt'), 'private');
    try {
      fs.symlinkSync(path.join(outside, 'secret.txt'), path.join(src, 'leak.md'));
    } catch {
      return; // cannot create links here (Windows without the privilege)
    }
    write(src, 'real.md');
    const count = importVaultRecursive(src, src, dest);
    expect(count).toBe(1);
    expect(fs.existsSync(path.join(dest, 'leak.md'))).toBe(false);
    fs.rmSync(outside, { recursive: true, force: true });
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
