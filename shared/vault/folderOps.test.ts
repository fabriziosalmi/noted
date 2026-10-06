// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { checkFolderMove, isInsideFolder, movesForDissolve, renamesForFolderMove } from './folderOps';

const names = ['Home.md', 'Work/Plan.md', 'Work/Q4/Goals.md', 'Work/Q4/Deep/Note.md', 'Worker/Other.md', 'Life/Garden.md'];

describe('isInsideFolder', () => {
  it('is the folder or what is under it, whole segments only, any case', () => {
    expect(isInsideFolder('Work', 'Work')).toBe(true);
    expect(isInsideFolder('Work/Q4/x.md', 'Work')).toBe(true);
    expect(isInsideFolder('work/q4', 'Work')).toBe(true);
    expect(isInsideFolder('Worker/x.md', 'Work')).toBe(false);
    expect(isInsideFolder('Home.md', 'Work')).toBe(false);
  });
});

describe('renamesForFolderMove', () => {
  it('renames every note under the folder, at any depth, and nothing else', () => {
    expect(renamesForFolderMove(names, 'Work', 'Archive/Old')).toEqual([
      { from: 'Work/Plan.md', to: 'Archive/Old/Plan.md' },
      { from: 'Work/Q4/Goals.md', to: 'Archive/Old/Q4/Goals.md' },
      { from: 'Work/Q4/Deep/Note.md', to: 'Archive/Old/Q4/Deep/Note.md' },
    ]);
    expect(renamesForFolderMove(names, 'Work/Q4', 'Q4')).toEqual([
      { from: 'Work/Q4/Goals.md', to: 'Q4/Goals.md' },
      { from: 'Work/Q4/Deep/Note.md', to: 'Q4/Deep/Note.md' },
    ]);
  });
});

describe('movesForDissolve', () => {
  it('moves what is in a folder up into the folder above, keeping the structure below', () => {
    expect(movesForDissolve(names, 'Work/Q4')).toEqual([
      { from: 'Work/Q4/Goals.md', to: 'Work/Goals.md' },
      { from: 'Work/Q4/Deep/Note.md', to: 'Work/Deep/Note.md' },
    ]);
  });
  it('a top-level folder dissolves into the vault root', () => {
    expect(movesForDissolve(names, 'Work')).toEqual([
      { from: 'Work/Plan.md', to: 'Plan.md' },
      { from: 'Work/Q4/Goals.md', to: 'Q4/Goals.md' },
      { from: 'Work/Q4/Deep/Note.md', to: 'Q4/Deep/Note.md' },
    ]);
  });
});

describe('checkFolderMove', () => {
  it('accepts a rename and a move to another parent', () => {
    expect(checkFolderMove('Work', 'Job')).toBeNull();
    expect(checkFolderMove('Work/Q4', 'Archive/Q4')).toBeNull();
    expect(checkFolderMove('work', 'Work')).toBeNull(); // a case-only rename is a rename
  });
  it('refuses a move onto itself, into itself, or into what it holds', () => {
    expect(checkFolderMove('Work', 'Work')).toBe('The folder is already there');
    expect(checkFolderMove('Work', 'Work/Q4/Work')).toBe('A folder cannot be moved into itself');
    expect(checkFolderMove('Work', 'work/sub')).toBe('A folder cannot be moved into itself');
    expect(checkFolderMove('Work', 'Worker')).toBeNull(); // a different folder whose name starts the same
  });
  it('refuses bad paths and a result no note inside could keep', () => {
    expect(checkFolderMove('Work', '../outside')).toMatch(/traversal/);
    expect(checkFolderMove('Work', '.hidden')).toMatch(/Hidden/);
    expect(checkFolderMove('Work', 'a'.repeat(300))).toMatch(/too long/);
    const deep = `Work/${'d/'.repeat(14)}Note.md`;
    expect(checkFolderMove('Work', 'x/y/z', deep)).toMatch(/would no longer fit/);
    expect(checkFolderMove('Work', 'Job', 'Work/Q4/Goals.md')).toBeNull();
  });
});
