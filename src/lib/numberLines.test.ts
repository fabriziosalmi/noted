// @vitest-environment node
import { describe, it, expect } from 'vitest';
import { toggleNumberLines } from './numberLines';

describe('toggleNumberLines', () => {
  it('numbers non-empty lines sequentially, preserving empty lines', () => {
    expect(toggleNumberLines('apple\n\nfig\npear')).toBe('1. apple\n\n2. fig\n3. pear');
  });

  it('unnumbers when every non-empty line is already numbered', () => {
    expect(toggleNumberLines('1. apple\n2. fig')).toBe('apple\nfig');
  });

  it('keeps empty lines in place when unnumbering', () => {
    expect(toggleNumberLines('1. apple\n\n99. fig')).toBe('apple\n\nfig');
  });

  it('numbers all lines when only some are already numbered', () => {
    expect(toggleNumberLines('1. apple\nfig')).toBe('1. 1. apple\n2. fig');
  });

  it('toggles back to the original on a second pass', () => {
    expect(toggleNumberLines(toggleNumberLines('a\n\nb'))).toBe('a\n\nb');
  });

  it('handles empty input and single lines', () => {
    expect(toggleNumberLines('')).toBe('');
    expect(toggleNumberLines('\n\n')).toBe('\n\n');
    expect(toggleNumberLines('only')).toBe('1. only');
    expect(toggleNumberLines('1. only')).toBe('only');
  });
});
