import { describe, it, expect } from 'vitest';
import { suggestProject } from './projectSuggestion';

describe('suggestProject', () => {
  it('suggests grouping when other notes share the same title stem', () => {
    const s = suggestProject('Aurora', {
      activeNoteName: 'Aurora.md',
      tagIndex: {},
      noteNames: ['Aurora.md', 'Aurora 2.md', 'Other.md'],
    });
    expect(s).not.toBeNull();
    expect(s!.slug).toBe('aurora');
    expect(s!.tag).toBe('#project/aurora');
    expect(s!.matches).toEqual(['Aurora 2.md']);
  });

  it('suggests joining an existing #project/<slug> that other notes carry', () => {
    const s = suggestProject('Aurora', {
      activeNoteName: 'Notes about it.md',
      tagIndex: { '#project/aurora': ['A.md', 'B.md'] },
      noteNames: ['Notes about it.md', 'A.md', 'B.md'],
    });
    expect(s!.matches).toEqual(['A.md', 'B.md']);
  });

  it('returns null when the note is already in the project', () => {
    const s = suggestProject('Aurora', {
      activeNoteName: 'Aurora.md',
      tagIndex: { '#project/aurora': ['Aurora.md', 'A.md'] },
      noteNames: ['Aurora.md', 'A.md'],
    });
    expect(s).toBeNull();
  });

  it('returns null when nothing else matches', () => {
    expect(suggestProject('Unique Title', {
      activeNoteName: 'Unique Title.md',
      tagIndex: {},
      noteNames: ['Unique Title.md', 'Other.md'],
    })).toBeNull();
  });

  it('ignores very short or empty titles', () => {
    expect(suggestProject('ab', { activeNoteName: 'ab.md', tagIndex: {}, noteNames: ['ab.md', 'ab 2.md'] })).toBeNull();
    expect(suggestProject('   ', { activeNoteName: null, tagIndex: {}, noteNames: [] })).toBeNull();
  });

  it('does not list the active note among its own matches', () => {
    const s = suggestProject('Aurora', {
      activeNoteName: 'Aurora.md',
      tagIndex: { '#project/aurora': ['Aurora.md'] },
      noteNames: ['Aurora.md', 'Aurora 2.md'],
    });
    // active note already tagged → null
    expect(s).toBeNull();
  });
});
