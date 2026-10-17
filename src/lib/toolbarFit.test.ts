import { describe, expect, it } from 'vitest';
import { groupsThatFit, TOOLBAR_BUTTON_WIDTH as B, TOOLBAR_MORE_WIDTH as M, TOOLBAR_SEPARATOR_WIDTH as S } from './toolbarFit';

const sizes = [2, 3, 6, 4, 1, 2, 1]; // the formatting bar's groups
const full = sizes.reduce((a, n) => a + n * B, 0) + (sizes.length - 1) * S;

describe('groupsThatFit', () => {
  it('shows every group when there is room, with no "more" button', () => {
    expect(groupsThatFit(sizes, full)).toBe(sizes.length);
    expect(groupsThatFit(sizes, 2000)).toBe(sizes.length);
  });

  it('keeps the groups from the start that fit next to the "more" button', () => {
    expect(groupsThatFit(sizes, full - 1)).toBeLessThan(sizes.length);
    const firstThree = M + 2 * B + (3 * B + S) + (6 * B + S);
    expect(groupsThatFit(sizes, firstThree)).toBe(3);
    expect(groupsThatFit(sizes, firstThree - 1)).toBe(2);
  });

  it('always keeps at least the first group', () => {
    expect(groupsThatFit(sizes, 10)).toBe(1);
  });
});
