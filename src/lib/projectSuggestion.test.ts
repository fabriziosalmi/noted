import { describe, it, expect } from 'vitest';
import { suggestProject } from './projectSuggestion';

describe('suggestProject', () => {
  it('suggests grouping when other notes share the same title stem', () => {
    const s = suggestProject('Minerva', {
      activeNoteName: 'Minerva.md',
      tagIndex: {},
      noteNames: ['Minerva.md', 'Minerva 2.md', 'Other.md'],
    });
    expect(s).not.toBeNull();
    expect(s!.slug).toBe('minerva');
    expect(s!.tag).toBe('#project/minerva');
    expect(s!.matches).toEqual(['Minerva 2.md']);
  });

  it('suggests joining an existing #project/<slug> that other notes carry', () => {
    const s = suggestProject('Minerva', {
      activeNoteName: 'Notes about it.md',
      tagIndex: { '#project/minerva': ['A.md', 'B.md'] },
      noteNames: ['Notes about it.md', 'A.md', 'B.md'],
    });
    expect(s!.matches).toEqual(['A.md', 'B.md']);
  });

  it('returns null when the note is already in the project', () => {
    const s = suggestProject('Minerva', {
      activeNoteName: 'Minerva.md',
      tagIndex: { '#project/minerva': ['Minerva.md', 'A.md'] },
      noteNames: ['Minerva.md', 'A.md'],
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
    const s = suggestProject('Minerva', {
      activeNoteName: 'Minerva.md',
      tagIndex: { '#project/minerva': ['Minerva.md'] },
      noteNames: ['Minerva.md', 'Minerva 2.md'],
    });
    // active note already tagged → null
    expect(s).toBeNull();
  });
});
