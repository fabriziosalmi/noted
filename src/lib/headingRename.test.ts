import { describe, it, expect } from 'vitest';
import { diffHeadings } from './headingRename';

describe('diffHeadings', () => {
  it('finds the heading whose text changed', () => {
    expect(diffHeadings(['Plan', 'Risks', 'Budget'], ['Plan', 'Threats', 'Budget'])).toEqual([{ index: 1, to: 'Threats' }]);
  });

  it('finds several', () => {
    expect(diffHeadings(['A', 'B', 'C'], ['A2', 'B', 'C2'])).toEqual([{ index: 0, to: 'A2' }, { index: 2, to: 'C2' }]);
  });

  it('finds nothing when nothing changed', () => {
    expect(diffHeadings(['A', 'B'], ['A', 'B'])).toEqual([]);
  });

  it('cannot tell what became what when a heading was added or removed', () => {
    expect(diffHeadings(['A', 'B'], ['A', 'X', 'B'])).toBeNull();
    expect(diffHeadings(['A', 'B'], ['A'])).toBeNull();
  });
});
