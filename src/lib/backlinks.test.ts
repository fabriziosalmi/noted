import { describe, it, expect } from 'vitest';
import { backlinksOf } from './backlinks';

describe('backlinksOf', () => {
  const idx = {
    'A.md': ['Target', 'Other'],
    'B.md': ['target.md'],
    'C.md': ['TARGET'],
    'D.md': ['Target2'],
    'Target.md': ['Target'], // a note linking to itself is not its own backlink
    'Work/E.md': ['Work/Target'],
    'Work/Target.md': [],
  };

  it('matches case-insensitively, with or without .md, excluding the note itself', () => {
    expect(backlinksOf(idx, 'Target.md')).toEqual(['A.md', 'B.md', 'C.md']);
  });

  it('a link with a folder path means that note, not the one at the root with the same name', () => {
    expect(backlinksOf(idx, 'Work/Target.md')).toEqual(['Work/E.md']);
    expect(backlinksOf(idx, 'Missing.md')).toEqual([]);
  });

  it('a bare name finds the note in a folder when there is none at the root (Obsidian)', () => {
    const vault = { 'Home.md': ['Plan', 'Garden'], 'Life/Garden.md': [], 'Work/Plan.md': [], 'Work/Other.md': ['plan'] };
    expect(backlinksOf(vault, 'Work/Plan.md')).toEqual(['Home.md', 'Work/Other.md']);
    expect(backlinksOf(vault, 'Life/Garden.md')).toEqual(['Home.md']);
  });

  it('with the same name in two folders, the link goes to the one next to it, then the shortest path', () => {
    const vault = { 'Home.md': ['Plan'], 'Work/Notes.md': ['Plan'], 'Life/Plan.md': [], 'Work/Plan.md': [] };
    expect(backlinksOf(vault, 'Work/Plan.md')).toEqual(['Work/Notes.md']);
    expect(backlinksOf(vault, 'Life/Plan.md')).toEqual(['Home.md']);
  });
});
