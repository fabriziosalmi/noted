// @vitest-environment node
import { describe, it, expect } from 'vitest';
import { removeBlankAndDuplicateLines } from './cleanLines';

describe('removeBlankAndDuplicateLines', () => {
  it('removes empty and whitespace-only lines', () => {
    expect(removeBlankAndDuplicateLines('a\n\n  \t\nb')).toBe('a\nb');
  });

  it('dedupes by trimmed equality, keeping the first occurrence as written and in order', () => {
    expect(removeBlankAndDuplicateLines('  apple \nbanana\napple\n\tbanana  \ncherry')).toBe('  apple \nbanana\ncherry');
  });

  it('compares case-sensitively', () => {
    expect(removeBlankAndDuplicateLines('Apple\napple')).toBe('Apple\napple');
  });

  it('returns single-line input unchanged', () => {
    expect(removeBlankAndDuplicateLines('  only ')).toBe('  only ');
  });

  it('returns an empty string for empty or whitespace-only input', () => {
    expect(removeBlankAndDuplicateLines('')).toBe('');
    expect(removeBlankAndDuplicateLines('  \n\t\n')).toBe('');
  });
});
