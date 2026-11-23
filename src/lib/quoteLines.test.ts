// @vitest-environment node
import { describe, it, expect } from 'vitest';
import { toggleQuoteLines } from './quoteLines';

describe('toggleQuoteLines', () => {
  it('quotes non-empty lines, preserving empty lines', () => {
    expect(toggleQuoteLines('apple\n\nfig\npear')).toBe('> apple\n\n> fig\n> pear');
  });

  it('unquotes when every non-empty line is already quoted', () => {
    expect(toggleQuoteLines('> apple\n> fig')).toBe('apple\nfig');
  });

  it('keeps empty lines in place when unquoting', () => {
    expect(toggleQuoteLines('> apple\n\n> fig')).toBe('apple\n\nfig');
  });

  it('quotes all lines when only some are already quoted', () => {
    expect(toggleQuoteLines('> apple\nfig')).toBe('> > apple\n> fig');
  });

  it('toggles back to the original on a second pass', () => {
    expect(toggleQuoteLines(toggleQuoteLines('a\n\nb'))).toBe('a\n\nb');
  });

  it('handles empty input and single lines', () => {
    expect(toggleQuoteLines('')).toBe('');
    expect(toggleQuoteLines('\n\n')).toBe('\n\n');
    expect(toggleQuoteLines('only')).toBe('> only');
    expect(toggleQuoteLines('> only')).toBe('only');
  });
});
