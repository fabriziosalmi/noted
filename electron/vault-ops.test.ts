// @vitest-environment node
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { deleteFolderMovingContentToRoot, uniqueNameInDir, isNoteOrMedia } from './vault-ops';

let vault: string;

// Stand-in for main's safeResolve: same contract (join + refuse to escape),
// without the realpath machinery that needs a live vault.
const resolve = (dir: string, relName: string) => {
  const p = path.join(dir, relName);
  if (p !== dir && !p.startsWith(dir + path.sep)) throw new Error('Path escapes vault directory');
  return p;
};

const write = (rel: string, content: string) => {
  const p = path.join(vault, rel);
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, content, 'utf-8');
};
const read = (rel: string) => fs.readFileSync(path.join(vault, rel), 'utf-8');
const exists = (rel: string) => fs.existsSync(path.join(vault, rel));

beforeEach(() => {
  vault = fs.mkdtempSync(path.join(os.tmpdir(), 'noted-vault-ops-'));
});

afterEach(() => {
  fs.rmSync(vault, { recursive: true, force: true });
});

describe('isNoteOrMedia', () => {
  it('accepts notes and the media that lives beside them', () => {
    expect(isNoteOrMedia('Note.md')).toBe(true);
    expect(isNoteOrMedia('shot.PNG')).toBe(true);
    expect(isNoteOrMedia('paper.pdf')).toBe(true);
  });

  it('rejects everything else', () => {
    expect(isNoteOrMedia('notes.txt')).toBe(false);
    expect(isNoteOrMedia('archive.zip')).toBe(false);
  });
});

describe('uniqueNameInDir', () => {
  it('keeps the original name when it is free', () => {
    expect(uniqueNameInDir('Note.md', 'Archive', () => false)).toBe('Note.md');
  });

  it('tags the source folder on the first collision', () => {
    expect(uniqueNameInDir('Note.md', 'Archive', (n) => n === 'Note.md')).toBe('Note (Archive).md');
  });

  it('counts up while the tagged name is also taken', () => {
    const taken = new Set(['Note.md', 'Note (Archive).md', 'Note (Archive) 2.md']);
    expect(uniqueNameInDir('Note.md', 'Archive', (n) => taken.has(n))).toBe('Note (Archive) 3.md');
  });

  it('handles names with no extension', () => {
    expect(uniqueNameInDir('Sub', 'Archive', (n) => n === 'Sub')).toBe('Sub (Archive)');
  });
});

describe('deleteFolderMovingContentToRoot', () => {
  it('moves notes to the root and removes the folder', () => {
    write('Archive/One.md', 'one');
    write('Archive/Two.md', 'two');

    const res = deleteFolderMovingContentToRoot(vault, 'Archive', resolve);

    expect(res.moved).toBe(2);
    expect(res.renamed).toEqual([]);
    expect(read('One.md')).toBe('one');
    expect(read('Two.md')).toBe('two');
    expect(exists('Archive')).toBe(false);
  });

  // The regression this module exists for: fs.renameSync replaces the
  // destination silently, so the root note used to be destroyed outright.
  it('never overwrites a root note that shares its name', () => {
    write('Note.md', 'ROOT VERSION — the one the user still wants');
    write('Archive/Note.md', 'FOLDER VERSION');

    const res = deleteFolderMovingContentToRoot(vault, 'Archive', resolve);

    expect(read('Note.md')).toBe('ROOT VERSION — the one the user still wants');
    expect(read('Note (Archive).md')).toBe('FOLDER VERSION');
    expect(res.moved).toBe(1);
    expect(res.renamed).toEqual(['Note.md → Note (Archive).md']);
  });

  it('disambiguates repeatedly when the tagged name is taken too', () => {
    write('Note.md', 'root');
    write('Note (Archive).md', 'previously rescued');
    write('Archive/Note.md', 'folder');

    deleteFolderMovingContentToRoot(vault, 'Archive', resolve);

    expect(read('Note.md')).toBe('root');
    expect(read('Note (Archive).md')).toBe('previously rescued');
    expect(read('Note (Archive) 2.md')).toBe('folder');
  });

  it('rescues media files, not just notes', () => {
    write('Archive/diagram.png', 'PNGDATA');
    write('Archive/One.md', 'one');

    const res = deleteFolderMovingContentToRoot(vault, 'Archive', resolve);

    expect(res.moved).toBe(2);
    expect(read('diagram.png')).toBe('PNGDATA');
  });

  // rmdirSync used to throw here, after the notes had already been moved out —
  // leaving the vault in a half-deleted state.
  it('deletes a folder holding unsupported files and OS cruft', () => {
    write('Archive/One.md', 'one');
    write('Archive/.DS_Store', 'cruft');
    write('Archive/scratch.txt', 'not a note');

    const res = deleteFolderMovingContentToRoot(vault, 'Archive', resolve);

    expect(res.moved).toBe(1);
    expect(exists('Archive')).toBe(false);
    expect(read('One.md')).toBe('one');
  });

  it('moves a nested subfolder up instead of destroying it', () => {
    write('Archive/Sub/Deep.md', 'deep');

    deleteFolderMovingContentToRoot(vault, 'Archive', resolve);

    expect(read('Sub/Deep.md')).toBe('deep');
    expect(exists('Archive')).toBe(false);
  });

  it('carries the version history of a moved note across', () => {
    write('Archive/One.md', 'one');
    write('.noted_history/Archive/One.md/2026-07-28T10-00-00-000Z.html', '<p>old</p>');

    deleteFolderMovingContentToRoot(vault, 'Archive', resolve);

    expect(read('.noted_history/One.md/2026-07-28T10-00-00-000Z.html')).toBe('<p>old</p>');
    expect(exists('.noted_history/Archive')).toBe(false);
  });

  it('keeps the existing history of a root note it had to rename around', () => {
    write('Note.md', 'root');
    write('.noted_history/Note.md/2026-07-28T09-00-00-000Z.html', '<p>root history</p>');
    write('Archive/Note.md', 'folder');
    write('.noted_history/Archive/Note.md/2026-07-28T10-00-00-000Z.html', '<p>folder history</p>');

    deleteFolderMovingContentToRoot(vault, 'Archive', resolve);

    expect(read('.noted_history/Note.md/2026-07-28T09-00-00-000Z.html')).toBe('<p>root history</p>');
    expect(read('.noted_history/Note (Archive).md/2026-07-28T10-00-00-000Z.html')).toBe('<p>folder history</p>');
  });

  it('handles an empty folder', () => {
    fs.mkdirSync(path.join(vault, 'Empty'));

    const res = deleteFolderMovingContentToRoot(vault, 'Empty', resolve);

    expect(res).toEqual({ moved: 0, renamed: [] });
    expect(exists('Empty')).toBe(false);
  });
});
