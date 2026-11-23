// @vitest-environment node
import { describe, it, expect } from 'vitest';
import { joinSelectedLines } from './joinLines';

describe('joinSelectedLines', () => {
  it('joins multi-line wrapped text with single spaces, trimming each line', () => {
    expect(joinSelectedLines('  first line\nsecond line  \n  third line')).toBe('first line second line third line');
  });

  it('collapses extra internal spaces indirectly and drops blank/whitespace-only lines', () => {
    expect(joinSelectedLines('hello   world\n\n  \t\nfoo bar')).toBe('hello   world foo bar');
    expect(joinSelectedLines('a\n \nb')).toBe('a b');
  });

  it('returns single-line input trimmed', () => {
    expect(joinSelectedLines('  only one ')).toBe('only one');
  });

  it('returns an empty string for empty or whitespace-only input', () => {
    expect(joinSelectedLines('')).toBe('');
    expect(joinSelectedLines('  \n\t\n ')).toBe('');
  });
});
