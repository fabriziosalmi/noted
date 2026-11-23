// @vitest-environment node
import { describe, it, expect } from 'vitest';
import { reverseSelectedLines } from './reverseLines';

describe('reverseSelectedLines', () => {
  it('reverses multi-line order', () => {
    expect(reverseSelectedLines('first\nsecond\nthird')).toBe('third\nsecond\nfirst');
  });

  it('preserves empty lines while reversing', () => {
    expect(reverseSelectedLines('a\n\nb')).toBe('b\n\na');
  });

  it('returns single-line and empty input unchanged', () => {
    expect(reverseSelectedLines('only')).toBe('only');
    expect(reverseSelectedLines('')).toBe('');
  });

  it('is the identity when applied twice', () => {
    const text = 'one\ntwo\n\nthree';
    expect(reverseSelectedLines(reverseSelectedLines(text))).toBe(text);
  });
});
