// @vitest-environment node
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { dissolveFolder as deleteFolderMovingContentToRoot, moveFolder, uniqueNameInDir, isNoteOrMedia } from './vault-ops';

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

  it('tags with the last part of a folder path only (a "/" in a name would make a stray folder)', () => {
    expect(uniqueNameInDir('Note.md', 'Work/Q4/Archive', (n) => n === 'Note.md')).toBe('Note (Archive).md');
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
  // leaving the vault in a half-deleted state. OS litter is thrown away with the folder; a file the user put
  // there (a .txt, a .canvas, a document) is not litter, and is moved up with the notes instead of destroyed.
  it('deletes a folder holding OS cruft, and keeps files that are not notes', () => {
    write('Archive/One.md', 'one');
    write('Archive/.DS_Store', 'cruft');
    write('Archive/Thumbs.db', 'cruft');
    write('Archive/._One.md', 'cruft');
    write('Archive/scratch.txt', 'not a note, but not litter either');
    write('Archive/Board.canvas', '{}');

    const res = deleteFolderMovingContentToRoot(vault, 'Archive', resolve);

    expect(res.moved).toBe(3);
    expect(exists('Archive')).toBe(false);
    expect(read('One.md')).toBe('one');
    expect(read('scratch.txt')).toBe('not a note, but not litter either');
    expect(read('Board.canvas')).toBe('{}');
    expect(exists('.DS_Store')).toBe(false);
    expect(exists('Thumbs.db')).toBe(false);
  });

  it('refuses, before moving anything, a folder that holds a hidden item that is not litter (a repository, a plugin folder)', () => {
    write('Archive/One.md', 'one');
    write('Archive/.git/HEAD', 'ref: refs/heads/main');
    expect(() => deleteFolderMovingContentToRoot(vault, 'Archive', resolve)).toThrow(/hidden items \(\.git\).*nothing was changed/i);
    expect(exists('Archive/One.md')).toBe(true);
    expect(exists('One.md')).toBe(false);
    expect(read('Archive/.git/HEAD')).toBe('ref: refs/heads/main');
  });

  it('moves a nested subfolder up instead of destroying it, structure kept', () => {
    write('Archive/Sub/Deep.md', 'deep');
    write('Archive/Sub/Deeper/Deepest.md', 'deepest');

    const res = deleteFolderMovingContentToRoot(vault, 'Archive', resolve);

    expect(read('Sub/Deep.md')).toBe('deep');
    expect(read('Sub/Deeper/Deepest.md')).toBe('deepest');
    expect(exists('Archive')).toBe(false);
    // every note under the sub-folder is reported, so links to it can follow
    expect(res.moves.sort((a, b) => a.from.localeCompare(b.from))).toEqual([
      { from: 'Archive/Sub/Deep.md', to: 'Sub/Deep.md' },
      { from: 'Archive/Sub/Deeper/Deepest.md', to: 'Sub/Deeper/Deepest.md' },
    ]);
    expect(res.moved).toBe(1); // one entry went up: the folder "Sub", whole
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

    expect(res).toEqual({ moved: 0, renamed: [], moves: [] });
    expect(exists('Empty')).toBe(false);
  });

  it('reports every moved NOTE with its final name, including collision renames (for link updates)', () => {
    fs.mkdirSync(path.join(vault, 'Archive'));
    fs.writeFileSync(path.join(vault, 'Archive', 'Plan.md'), 'in folder');
    fs.writeFileSync(path.join(vault, 'Archive', 'Solo.md'), 'solo');
    fs.writeFileSync(path.join(vault, 'Archive', 'pic.png'), 'png');
    fs.writeFileSync(path.join(vault, 'Plan.md'), 'already at root');

    const res = deleteFolderMovingContentToRoot(vault, 'Archive', resolve);

    expect(res.moves.sort((a, b) => a.from.localeCompare(b.from))).toEqual([
      { from: 'Archive/Plan.md', to: 'Plan (Archive).md' },
      { from: 'Archive/Solo.md', to: 'Solo.md' },
    ]); // media are moved too but are not notes: no link points at them
    expect(res.moved).toBe(3);
  });
});

describe('dissolving a folder inside another folder', () => {
  it('moves what is in it up into the folder above, not to the vault root', () => {
    write('Work/Q4/Goals.md', 'goals');
    write('Work/Q4/Deep/Note.md', 'note');
    write('Work/Plan.md', 'plan');

    const res = deleteFolderMovingContentToRoot(vault, 'Work/Q4', resolve);

    expect(read('Work/Goals.md')).toBe('goals');
    expect(read('Work/Deep/Note.md')).toBe('note');
    expect(read('Work/Plan.md')).toBe('plan');
    expect(exists('Work/Q4')).toBe(false);
    expect(exists('Goals.md')).toBe(false);
    expect(res.moves.sort((a, b) => a.from.localeCompare(b.from))).toEqual([
      { from: 'Work/Q4/Deep/Note.md', to: 'Work/Deep/Note.md' },
      { from: 'Work/Q4/Goals.md', to: 'Work/Goals.md' },
    ]);
  });

  it('never overwrites in the folder above: a note, and a folder, with the same name are renamed around', () => {
    write('Work/Goals.md', 'ABOVE');
    write('Work/Deep/Keep.md', 'ABOVE FOLDER');
    write('Work/Q4/Goals.md', 'INSIDE');
    write('Work/Q4/Deep/Note.md', 'INSIDE FOLDER');

    const res = deleteFolderMovingContentToRoot(vault, 'Work/Q4', resolve);

    expect(read('Work/Goals.md')).toBe('ABOVE');
    expect(read('Work/Goals (Q4).md')).toBe('INSIDE');
    expect(read('Work/Deep/Keep.md')).toBe('ABOVE FOLDER');
    expect(read('Work/Deep (Q4)/Note.md')).toBe('INSIDE FOLDER');
    expect(res.renamed.sort()).toEqual(['Deep → Deep (Q4)', 'Goals.md → Goals (Q4).md']);
    expect(res.moves).toContainEqual({ from: 'Work/Q4/Deep/Note.md', to: 'Work/Deep (Q4)/Note.md' });
  });

  it('moves the history of every note that moved, at any depth', () => {
    write('Work/Q4/Deep/Note.md', 'note');
    write('.noted_history/Work/Q4/Deep/Note.md/2026-07-28T10-00-00-000Z.html', '<p>old</p>');
    write('.noted_history/Work/Q4/Goals.md/2026-07-28T10-00-00-000Z.html', '<p>goals old</p>');
    write('Work/Q4/Goals.md', 'goals');

    deleteFolderMovingContentToRoot(vault, 'Work/Q4', resolve);

    expect(read('.noted_history/Work/Deep/Note.md/2026-07-28T10-00-00-000Z.html')).toBe('<p>old</p>');
    expect(read('.noted_history/Work/Goals.md/2026-07-28T10-00-00-000Z.html')).toBe('<p>goals old</p>');
    expect(exists('.noted_history/Work/Q4')).toBe(false);
  });

  it('puts everything back if a move fails half way', () => {
    write('Work/Q4/A.md', 'a');
    write('Work/Q4/B.md', 'b');
    write('Work/Q4/C.md', 'c');
    // The third destination cannot be written: make the resolver refuse it.
    const failing = (dir: string, rel: string) => {
      if (rel.endsWith('C.md')) throw new Error('disk says no');
      return resolve(dir, rel);
    };
    expect(() => deleteFolderMovingContentToRoot(vault, 'Work/Q4', failing)).toThrow('disk says no');
    // the destinations are resolved while planning, so nothing moved at all
    for (const n of ['A', 'B', 'C']) expect(read(`Work/Q4/${n}.md`)).toBe(n.toLowerCase());
    expect(exists('Work/A.md')).toBe(false);
  });

  it('puts back what already moved when a later move fails for real', () => {
    write('Work/Q4/A.md', 'a');
    write('Work/Q4/B.md', 'b');
    write('Work/Q4/C.md', 'c');
    // After the destinations were chosen, something takes the last one: a folder, which a file cannot replace.
    const racing = (dir: string, rel: string) => {
      if (rel === 'Work/C.md') write('Work/C.md/inside.md', 'someone else');
      return resolve(dir, rel);
    };
    expect(() => deleteFolderMovingContentToRoot(vault, 'Work/Q4', racing)).toThrow();
    for (const n of ['A', 'B', 'C']) expect(read(`Work/Q4/${n}.md`)).toBe(n.toLowerCase()); // all three where they were
    expect(exists('Work/A.md')).toBe(false);
    expect(exists('Work/B.md')).toBe(false);
    expect(read('Work/C.md/inside.md')).toBe('someone else'); // and what appeared is untouched
  });

  it('refuses a name that would not stay valid, before moving anything', () => {
    write('Work/Q4/' + 'n'.repeat(190) + '.md', 'long');
    write('Work/Q4/Ok.md', 'ok');
    write('Work/' + 'n'.repeat(190) + '.md', 'already there, so the incoming one is renamed past the limit');
    expect(() => deleteFolderMovingContentToRoot(vault, 'Work/Q4', resolve)).toThrow(/valid name.*Nothing was changed/);
    expect(exists('Work/Q4/Ok.md')).toBe(true);
    expect(exists('Work/Ok.md')).toBe(false);
  });

  it('keeps a folder it could not empty, and says so, rather than destroying what arrived', () => {
    write('Work/Q4/One.md', 'one');
    const racing = (dir: string, rel: string) => {
      // A file lands in the folder after the entries were listed, while the destinations are being decided.
      if (rel === 'Work/One.md') write('Work/Q4/Late.md', 'late');
      return resolve(dir, rel);
    };
    const res = deleteFolderMovingContentToRoot(vault, 'Work/Q4', racing);
    expect(res.folderKept).toBe(true);
    expect(read('Work/Q4/Late.md')).toBe('late');
    expect(read('Work/One.md')).toBe('one');
  });

  it('refuses what is not a folder, and a folder that is not there', () => {
    write('Work/Note.md', 'x');
    expect(() => deleteFolderMovingContentToRoot(vault, 'Work/Note.md', resolve)).toThrow('is not a folder');
    expect(() => deleteFolderMovingContentToRoot(vault, 'Nope', resolve)).toThrow('not found');
  });
});

describe('moveFolder', () => {
  it('renames a folder, reports every note under it at any depth, and carries the history', () => {
    write('Work/Plan.md', 'plan');
    write('Work/Q4/Goals.md', 'goals');
    write('Work/Q4/Deep/Note.md', 'note');
    write('.noted_history/Work/Q4/Goals.md/2026-07-28T10-00-00-000Z.html', '<p>old goals</p>');

    const res = moveFolder(vault, 'Work', 'Job', resolve);

    expect(exists('Work')).toBe(false);
    expect(read('Job/Q4/Deep/Note.md')).toBe('note');
    expect(res.moves.sort((a, b) => a.from.localeCompare(b.from))).toEqual([
      { from: 'Work/Plan.md', to: 'Job/Plan.md' },
      { from: 'Work/Q4/Deep/Note.md', to: 'Job/Q4/Deep/Note.md' },
      { from: 'Work/Q4/Goals.md', to: 'Job/Q4/Goals.md' },
    ]);
    expect(read('.noted_history/Job/Q4/Goals.md/2026-07-28T10-00-00-000Z.html')).toBe('<p>old goals</p>');
    expect(exists('.noted_history/Work')).toBe(false);
  });

  it('moves a folder under another folder', () => {
    write('Work/Q4/Goals.md', 'goals');
    fs.mkdirSync(path.join(vault, 'Archive/2026'), { recursive: true });
    const res = moveFolder(vault, 'Work/Q4', 'Archive/2026/Q4', resolve);
    expect(read('Archive/2026/Q4/Goals.md')).toBe('goals');
    expect(exists('Work/Q4')).toBe(false);
    expect(exists('Work')).toBe(true); // the parent stays, now empty
    expect(res.moves).toEqual([{ from: 'Work/Q4/Goals.md', to: 'Archive/2026/Q4/Goals.md' }]);
  });

  it('moves an empty folder', () => {
    fs.mkdirSync(path.join(vault, 'Empty'));
    expect(moveFolder(vault, 'Empty', 'Gone', resolve).moves).toEqual([]);
    expect(exists('Gone')).toBe(true);
  });

  it('refuses a move into itself or into something under it, and changes nothing', () => {
    write('Work/Q4/Goals.md', 'goals');
    expect(() => moveFolder(vault, 'Work', 'Work/Q4/Work', resolve)).toThrow('into itself');
    expect(() => moveFolder(vault, 'Work', 'work/new', resolve)).toThrow('into itself');
    expect(() => moveFolder(vault, 'Work', 'Work', resolve)).toThrow('already there');
    expect(read('Work/Q4/Goals.md')).toBe('goals');
  });

  it('refuses an existing destination, a missing parent, a missing folder, a file, and bad names', () => {
    write('Work/A.md', 'a');
    write('Other/B.md', 'b');
    write('plain.md', 'x');
    expect(() => moveFolder(vault, 'Work', 'Other', resolve)).toThrow('already exists');
    expect(() => moveFolder(vault, 'Work', 'Nowhere/Work', resolve)).toThrow('does not exist');
    expect(() => moveFolder(vault, 'Nope', 'Other2', resolve)).toThrow('not found');
    expect(() => moveFolder(vault, 'plain.md', 'x', resolve)).toThrow('is not a folder');
    expect(() => moveFolder(vault, 'Work', '../escape', resolve)).toThrow(/traversal|escapes/);
    expect(() => moveFolder(vault, 'Work', '.hidden', resolve)).toThrow('Hidden');
    expect(read('Work/A.md')).toBe('a');
  });

  it('refuses a move after which a note inside would have a name the app rejects', () => {
    const deep = 'd/'.repeat(14);
    write(`Work/${deep}Note.md`, 'deep');
    expect(() => moveFolder(vault, 'Work', 'x/y/z', resolve)).toThrow('would no longer fit');
    expect(exists(`Work/${deep}Note.md`)).toBe(true);
  });

  it('does not touch the history of a note outside the folder, nor drop a history that is not empty', () => {
    write('Work/A.md', 'a');
    write('Other.md', 'o');
    write('.noted_history/Other.md/2026-07-28T10-00-00-000Z.html', '<p>other</p>');
    write('.noted_history/Work/A.md/2026-07-28T10-00-00-000Z.html', '<p>a</p>');
    write('.noted_history/Work/Stray.md/2026-07-28T10-00-00-000Z.html', '<p>history of a note that is gone</p>');
    moveFolder(vault, 'Work', 'Job', resolve);
    expect(read('.noted_history/Other.md/2026-07-28T10-00-00-000Z.html')).toBe('<p>other</p>');
    expect(read('.noted_history/Job/A.md/2026-07-28T10-00-00-000Z.html')).toBe('<p>a</p>');
    expect(read('.noted_history/Work/Stray.md/2026-07-28T10-00-00-000Z.html')).toBe('<p>history of a note that is gone</p>');
  });

  it('a case-only rename works (on a filesystem that is case-insensitive the destination "exists")', () => {
    write('work/A.md', 'a');
    const res = moveFolder(vault, 'work', 'Work', resolve);
    expect(read('Work/A.md')).toBe('a');
    expect(fs.readdirSync(vault)).toEqual(['Work']);
    expect(res.moves).toEqual([{ from: 'work/A.md', to: 'Work/A.md' }]);
  });
});

