// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { walkVault, walkVaultSync } from './walk';
import { MAX_FOLDER_DEPTH } from './paths';

let root: string;
const write = (rel: string, text = 'x') => {
  fs.mkdirSync(path.dirname(path.join(root, rel)), { recursive: true });
  fs.writeFileSync(path.join(root, rel), text);
};
const symlinkOk = (target: string, link: string): boolean => {
  try { fs.symlinkSync(target, path.join(root, link)); return true; } catch { return false; } // Windows without the privilege
};

beforeEach(() => { root = fs.mkdtempSync(path.join(os.tmpdir(), 'noted-walk-')); });
afterEach(() => { fs.rmSync(root, { recursive: true, force: true }); });

describe.each([['async', (r: string, o?: object) => walkVault(r, o)], ['sync', (r: string, o?: object) => Promise.resolve(walkVaultSync(r, o))]] as const)('walking a vault (%s)', (_, walk) => {
  it('lists notes and folders at any depth, sorted, and empty folders too', async () => {
    write('Home.md');
    write('Work/Plan.md');
    write('Work/Q4/Goals.md');
    write('Work/Q4/Deep/er/note.md');
    fs.mkdirSync(path.join(root, 'Empty/Inside'), { recursive: true });
    const out = await walk(root);
    expect(out.notes).toEqual(['Home.md', 'Work/Plan.md', 'Work/Q4/Deep/er/note.md', 'Work/Q4/Goals.md']);
    expect(out.folders).toEqual(['Empty', 'Empty/Inside', 'Work', 'Work/Q4', 'Work/Q4/Deep', 'Work/Q4/Deep/er']);
    expect(out.truncated).toBe(false);
  });

  it('skips hidden folders and files, and anything that is not a note', async () => {
    write('a.md');
    write('.noted/trash/2026/x.md');
    write('.obsidian/plugins/p.md');
    write('.trash/Deleted.md');
    write('Work/.git/HEAD.md');
    write('Work/.hidden.md');
    write('image.png');
    write('notes.txt');
    write('Work/readme.MD'); // the extension is .md, in lower case, everywhere
    const out = await walk(root);
    expect(out.notes).toEqual(['a.md']);
    expect(out.folders).toEqual(['Work']);
  });

  it('skips names no note may have, so every listed path is one the app will accept', async () => {
    write('ok.md');
    write('bad:name.md');
    write('trailing .md');
    write('con.md');
    expect((await walk(root)).notes).toEqual(['ok.md']);
  });

  it('does not follow a symbolic link: not into a folder, not back up the tree, not to a file', async () => {
    write('real/inside.md');
    write('Home.md');
    const outside = fs.mkdtempSync(path.join(os.tmpdir(), 'noted-walk-outside-'));
    fs.writeFileSync(path.join(outside, 'secret.md'), 'x');
    try {
      const made = [symlinkOk(outside, 'escape'), symlinkOk(root, 'real/loop'), symlinkOk(path.join(root, 'Home.md'), 'alias.md')];
      if (made.some(m => !m)) return; // cannot create links here (Windows): nothing to prove
      const out = await walk(root);
      expect(out.notes).toEqual(['Home.md', 'real/inside.md']);
      expect(out.folders).toEqual(['real']);
    } finally {
      fs.rmSync(outside, { recursive: true, force: true });
    }
  });

  it('stops at the depth limit instead of walking forever, and says it left something out', async () => {
    const tooDeep = `${'d/'.repeat(MAX_FOLDER_DEPTH + 2)}n.md`;
    write(tooDeep);
    write('top.md');
    const out = await walk(root);
    expect(out.notes).toEqual(['top.md']);
    expect(out.folders).toHaveLength(MAX_FOLDER_DEPTH);
    expect(out.truncated).toBe(true);
  });

  it('stops at the note limit and says so', async () => {
    for (let i = 0; i < 12; i++) write(`n${String(i).padStart(2, '0')}.md`);
    const out = await walk(root, { maxNotes: 5 });
    expect(out.notes).toHaveLength(5);
    expect(out.truncated).toBe(true);
  });

  it('a missing vault, or a folder that cannot be read, is an empty list and not an error', async () => {
    expect(await walk(path.join(root, 'nope'))).toEqual({ notes: [], folders: [], truncated: false });
  });
});
