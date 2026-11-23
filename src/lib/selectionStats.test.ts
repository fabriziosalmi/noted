// @vitest-environment node
import { describe, it, expect } from 'vitest';
import { computeTextStats, formatStatsLabel } from './selectionStats';

describe('computeTextStats', () => {
  it('returns zeros for an empty string', () => {
    expect(computeTextStats('')).toEqual({ words: 0, chars: 0, charsNoSpaces: 0, tokensEstimate: 0 });
  });

  it('counts whitespace-only text as chars but no words or tokens', () => {
    expect(computeTextStats(' \n\t ')).toEqual({ words: 0, chars: 4, charsNoSpaces: 0, tokensEstimate: 0 });
  });

  it('estimates at least one token for a single word', () => {
    expect(computeTextStats('hi')).toEqual({ words: 1, chars: 2, charsNoSpaces: 2, tokensEstimate: 1 });
  });

  it('handles multiline Unicode text', () => {
    const stats = computeTextStats('héllo wörld\n日本語 テスト');
    expect(stats.words).toBe(4);
    expect(stats.chars).toBe(19);
    expect(stats.charsNoSpaces).toBe(16);
    expect(stats.tokensEstimate).toBe(5);
  });
});

describe('formatStatsLabel', () => {
  it('is empty when there are no chars', () => {
    expect(formatStatsLabel(computeTextStats(''))).toBe('');
  });

  it('formats words, chars and tokens', () => {
    expect(formatStatsLabel({ words: 3, chars: 11, charsNoSpaces: 9, tokensEstimate: 3 })).toBe('3w · 11c · ~3t');
  });
});
