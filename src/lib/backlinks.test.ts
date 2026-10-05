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
  };

  it('matches case-insensitively, with or without .md, excluding the note itself', () => {
    expect(backlinksOf(idx, 'Target.md')).toEqual(['A.md', 'B.md', 'C.md']);
  });

  it('needs the full folder path', () => {
    expect(backlinksOf(idx, 'Work/Target.md')).toEqual(['Work/E.md']);
    expect(backlinksOf(idx, 'Missing.md')).toEqual([]);
  });
});
