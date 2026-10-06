// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

vi.mock('electron', () => ({
  ipcMain: { handle: vi.fn(), on: vi.fn() },
  app: { getPath: () => os.tmpdir(), isPackaged: false, getVersion: () => '0.0.0' },
  dialog: {},
  shell: {},
  BrowserWindow: class {},
}));

let vault: string;
const write = (rel: string, text = 'x\n') => {
  fs.mkdirSync(path.dirname(path.join(vault, rel)), { recursive: true });
  fs.writeFileSync(path.join(vault, rel), text);
};

beforeEach(() => { vault = fs.mkdtempSync(path.join(os.tmpdir(), 'noted-tree-')); });
afterEach(() => { fs.rmSync(vault, { recursive: true, force: true }); });

describe('the notes tree (what the sidebar is built from)', () => {
  it('has the root notes, and every folder at any depth with the notes directly in it, empty ones too', async () => {
    const { scanNotesTree } = await import('./ipc/folders');
    write('Home.md', '# Home\n\nwelcome\n');
    write('Work/Plan.md');
    write('Work/Q4/Goals.md');
    write('Work/Q4/Deep/Note.md');
    fs.mkdirSync(path.join(vault, 'Empty/Inside'), { recursive: true });
    const tree = await scanNotesTree(vault);
    expect(tree.rootNotes.map(n => n.name)).toEqual(['Home.md']);
    expect(tree.rootNotes[0].preview).toBe('welcome');
    expect(tree.folders.map(f => [f.name, f.notes.map(n => n.name)])).toEqual([
      ['Empty', []],
      ['Empty/Inside', []],
      ['Work', ['Work/Plan.md']],
      ['Work/Q4', ['Work/Q4/Goals.md']],
      ['Work/Q4/Deep', ['Work/Q4/Deep/Note.md']],
    ]);
  });

  it('lists each folder\'s notes newest first, and leaves out hidden folders, links and names no note may have', async () => {
    const { scanNotesTree } = await import('./ipc/folders');
    write('A/old.md');
    write('A/new.md');
    fs.utimesSync(path.join(vault, 'A/old.md'), new Date(2020, 0, 1), new Date(2020, 0, 1));
    write('.obsidian/x.md');
    write('A/.trash/y.md');
    write('A/bad:name.md');
    write('A/readme.txt');
    const tree = await scanNotesTree(vault);
    expect(tree.folders).toHaveLength(1);
    expect(tree.folders[0].notes.map(n => n.name)).toEqual(['A/new.md', 'A/old.md']);
  });

  it('an empty or missing vault is an empty tree', async () => {
    const { scanNotesTree } = await import('./ipc/folders');
    expect(await scanNotesTree(vault)).toEqual({ rootNotes: [], folders: [] });
    expect(await scanNotesTree(path.join(vault, 'nope'))).toEqual({ rootNotes: [], folders: [] });
  });
});
