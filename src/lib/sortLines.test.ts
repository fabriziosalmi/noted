// @vitest-environment node
import { describe, it, expect } from 'vitest';
import { sortSelectedLines, toggleSortLines } from './sortLines';

describe('sortSelectedLines', () => {
  it('sorts ascending by default, keeping empty lines', () => {
    expect(sortSelectedLines('pear\n\napple\nfig')).toBe('\napple\nfig\npear');
  });

  it('sorts descending as the reverse of ascending', () => {
    expect(sortSelectedLines('pear\napple\nfig', 'desc')).toBe('pear\nfig\napple');
  });

  it('compares case-insensitively', () => {
    expect(sortSelectedLines('banana\nApple\ncherry')).toBe('Apple\nbanana\ncherry');
  });

  it('returns single-line and empty input unchanged', () => {
    expect(sortSelectedLines('only')).toBe('only');
    expect(sortSelectedLines('')).toBe('');
  });
});

describe('toggleSortLines', () => {
  it('sorts ascending when unsorted, then descending when already ascending, then ascending again', () => {
    const ascending = toggleSortLines('b\nc\na');
    expect(ascending).toBe('a\nb\nc');
    const descending = toggleSortLines(ascending);
    expect(descending).toBe('c\nb\na');
    expect(toggleSortLines(descending)).toBe('a\nb\nc');
  });
});
