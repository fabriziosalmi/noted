import { describe, expect, it } from 'vitest';
import { computeMetrics } from './textMetrics';

/**
 * Target: src/lib/textMetrics.ts :: computeMetrics
 *
 * Every assertion below pins an exact, hand-derived value so that any mutation
 * of the production arithmetic (coefficients, thresholds, rounding, ordering,
 * caps, branch polarity, fallbacks) is observable in at least one test.
 */

/** Deterministic builder: `count` repeats of `word` joined by spaces. */
function repeat(word: string, count: number): string {
  return Array.from({ length: count }, () => word).join(' ');
}

/** `count` distinct "suffled<N>" tokens joined by spaces. */
function suffled(count: number): string {
  return Array.from({ length: count }, (_, i) => `suffled${i}`).join(' ');
}

describe('computeMetrics', () => {
  // ---------------------------------------------------------------- empty
  describe('empty and whitespace-only input', () => {
    it('returns an all-zero snapshot for the empty string', () => {
      expect(computeMetrics('')).toEqual({
        words: 0,
        chars: 0,
        sentences: 0,
        paragraphs: 0,
        readingTimeMin: 0,
        fleschScore: 0,
        fleschLabelKey: '',
        avgWordsPerSentence: 0,
        topKeywords: [],
        tone: 'neutral',
      });
    });

    it.each([' ', '\t', '\n', '   \t \n \n   '])(
      'returns an all-zero snapshot for whitespace-only input %j',
      (input) => {
        expect(computeMetrics(input)).toEqual({
          words: 0,
          chars: 0,
          sentences: 0,
          paragraphs: 0,
          readingTimeMin: 0,
          fleschScore: 0,
          fleschLabelKey: '',
          avgWordsPerSentence: 0,
          topKeywords: [],
          tone: 'neutral',
        });
      },
    );

    it('trims surrounding whitespace before measuring', () => {
      const padded = '   repeated   ';
      const plain = 'repeated';
      const paddedMetrics = computeMetrics(padded);
      const plainMetrics = computeMetrics(plain);
      expect(paddedMetrics.chars).toBe(plainMetrics.chars);
      expect(paddedMetrics.chars).toBe(8);
      expect(paddedMetrics.words).toBe(1);
    });
  });

  // ------------------------------------------------------- basic counting
  describe('word, character, sentence and paragraph counts', () => {
    it('counts characters of the trimmed text and words via \\b\\w+\\b', () => {
      const m = computeMetrics('Hello, world! This works.');
      expect(m.chars).toBe(25); // 'Hello, world! This works.'.length
      expect(m.words).toBe(4); // Hello, world, This, works
    });

    it('counts a hyphenated token as two words (\\b split on the hyphen)', () => {
      // "state-of-the-art" splits into state/of/the/art
      const m = computeMetrics('state-of-the-art');
      expect(m.words).toBe(4);
    });

    it('counts sentences from terminal punctuation runs', () => {
      const m = computeMetrics('One. Two! Three?');
      expect(m.sentences).toBe(3);
    });

    it('treats trailing text without punctuation as one sentence', () => {
      const m = computeMetrics('no terminal punctuation here');
      expect(m.sentences).toBe(1);
    });

    it('counts one sentence per punctuation run even with multiple marks', () => {
      const m = computeMetrics('Wow!! Really?! Okay.');
      expect(m.sentences).toBe(3);
    });

    it('counts paragraphs separated by blank lines', () => {
      const m = computeMetrics('First para one.\n\nSecond para two.\n\nThird para three.');
      expect(m.paragraphs).toBe(3);
    });

    it('counts a single-line block as one paragraph', () => {
      const m = computeMetrics('Just one paragraph here.');
      expect(m.paragraphs).toBe(1);
    });

    it('ignores empty paragraph splits (blank-line-only segments do not count)', () => {
      // The split on /\n\s*\n/ yields ["alpha","beta"] (empty segments filtered).
      const m = computeMetrics('alpha\n\n\n\nbeta');
      expect(m.paragraphs).toBe(2);
    });

    it('keeps words together when a newline is the only separator', () => {
      // \n without a blank line is not a paragraph break.
      const m = computeMetrics('line one\nline two');
      expect(m.paragraphs).toBe(1);
      expect(m.words).toBe(4);
    });
  });

  // ----------------------------------------------------------- reading time
  describe('readingTimeMin at 200 words per minute', () => {
    it('is 0 for empty input (short-circuit before the minimum)', () => {
      expect(computeMetrics('').readingTimeMin).toBe(0);
      expect(computeMetrics('   ').readingTimeMin).toBe(0);
    });

    it('is 1 for a single word (minimum applies)', () => {
      expect(computeMetrics('word').readingTimeMin).toBe(1);
    });

    it('is 1 at exactly 200 words (200/200 = 1)', () => {
      const m = computeMetrics(repeat('word', 200));
      expect(m.words).toBe(200);
      expect(m.readingTimeMin).toBe(1);
    });

    it('is 2 at 201 words (rounds up, not down)', () => {
      const m = computeMetrics(repeat('word', 201));
      expect(m.words).toBe(201);
      expect(m.readingTimeMin).toBe(2);
    });

    it('is 2 at 202 words', () => {
      expect(computeMetrics(repeat('word', 202)).readingTimeMin).toBe(2);
    });

    it('is 2 at 400 words', () => {
      const m = computeMetrics(repeat('word', 400));
      expect(m.words).toBe(400);
      expect(m.readingTimeMin).toBe(2);
    });

    it('is 3 at 401 words', () => {
      expect(computeMetrics(repeat('word', 401)).readingTimeMin).toBe(3);
    });

    it('is 5 at 801 words (long input, keeps ceiling behaviour)', () => {
      const m = computeMetrics(repeat('word', 801));
      expect(m.words).toBe(801);
      expect(m.readingTimeMin).toBe(5);
    });

    it('is 3 at 600 words (3.0 exactly, no rounding drift)', () => {
      const m = computeMetrics(repeat('word', 600));
      expect(m.words).toBe(600);
      expect(m.readingTimeMin).toBe(3);
    });
  });

  // -------------------------------------------------------- flesch clamping
  describe('Flesch score clamping', () => {
    it('clamps at 100 for very short, easy words', () => {
      // avgSentenceLen=1, avgSyllables=1 → 206.835 - 1.015 - 84.6 = 121.22 → 121 → 100
      const m = computeMetrics('cat.');
      expect(m.words).toBe(1);
      expect(m.sentences).toBe(1);
      expect(m.fleschScore).toBe(100);
    });

    it('clamps at 0 for many multi-syllable words crammed into one sentence', () => {
      // 30 "suffled<N>" tokens → fleschScore raw = 7 → NOT 0. Need 40+ tokens.
      // Verified: 40 "suffled<N>" tokens give raw score 0 after clamping.
      const m = computeMetrics(suffled(40));
      expect(m.words).toBe(40);
      expect(m.sentences).toBe(1);
      expect(m.fleschScore).toBe(0);
    });

    it('clamps at 0 for repeated long words in a single sentence', () => {
      // Verified: 40 repeats of "internationalization" → fleschScore 0.
      const m = computeMetrics(repeat('internationalization', 40));
      expect(m.words).toBe(40);
      expect(m.sentences).toBe(1);
      expect(m.fleschScore).toBe(0);
    });

    it('produces an unclamped mid-range score exactly', () => {
      // 40 "cat" (1-syllable) words in one sentence:
      // 206.835 - 40.6 - 84.6 = 81.635 → 82.
      const m = computeMetrics(repeat('cat', 40));
      expect(m.words).toBe(40);
      expect(m.sentences).toBe(1);
      expect(m.fleschScore).toBe(82);
    });

    it('matches the unclamped arithmetic for a two-sentence sample', () => {
      // words=6, sentences=2 → avgSentenceLen=3; 6 one-syllable words.
      // 206.835 - 3.045 - 84.6 = 119.19 → 119 → clamp 100.
      const m = computeMetrics('cat dog pig. cat dog pig.');
      expect(m.words).toBe(6);
      expect(m.sentences).toBe(2);
      expect(m.avgWordsPerSentence).toBe(3);
      expect(m.fleschScore).toBe(100);
    });

    it('clamps at exactly 100, not above', () => {
      expect(computeMetrics('cat.').fleschScore).toBe(100);
      expect(computeMetrics('a b.').fleschScore).toBe(100);
      expect(computeMetrics('a b.').fleschScore).toBeLessThanOrEqual(100);
    });

    it('clamps at exactly 0, not below', () => {
      const m = computeMetrics(suffled(50));
      expect(m.fleschScore).toBe(0);
      expect(m.fleschScore).toBeGreaterThanOrEqual(0);
    });

    it('is 0 for empty input (short-circuit, not derived)', () => {
      expect(computeMetrics('').fleschScore).toBe(0);
    });

    it('produces a raw unclamped score in (0, 100) for a mixed sample', () => {
      // 18 "suffled<N>" tokens → raw 19 (not clamped).
      const m = computeMetrics(suffled(18));
      expect(m.fleschScore).toBe(19);
    });
  });

  // ---------------------------------------------------------- flesch labels
  describe('Flesch label thresholds', () => {
    it('maps 100 to fleschVeryEasy', () => {
      expect(computeMetrics('cat.').fleschLabelKey).toBe('fleschVeryEasy');
    });

    it('maps 89 to fleschEasy (below the 90 boundary)', () => {
      // 33 "cat" words, one sentence: 206.835 - 33.495 - 84.6 = 88.74 → 89.
      const m = computeMetrics(repeat('cat', 33));
      expect(m.words).toBe(33);
      expect(m.sentences).toBe(1);
      expect(m.fleschScore).toBe(89);
      expect(m.fleschLabelKey).toBe('fleschEasy');
    });

    it('maps 80 to fleschEasy and 79 to fleschFairlyEasy (both sides of the 80 boundary)', () => {
      // 42 "cat" words, one sentence: 206.835 - 42.63 - 84.6 = 79.605 → 80.
      const m80 = computeMetrics(repeat('cat', 42));
      expect(m80.fleschScore).toBe(80);
      expect(m80.fleschLabelKey).toBe('fleschEasy');

      // 43 "cat" words, one sentence: 206.835 - 43.645 - 84.6 = 78.59 → 79.
      const m79 = computeMetrics(repeat('cat', 43));
      expect(m79.fleschScore).toBe(79);
      expect(m79.fleschLabelKey).toBe('fleschFairlyEasy');
    });

    it('maps 70 to fleschFairlyEasy and 69 to fleschStandard (both sides of the 70 boundary)', () => {
      // 51 "cat" words, one sentence: 206.835 - 51.765 - 84.6 = 70.47 → 70.
      const m70 = computeMetrics(repeat('cat', 51));
      expect(m70.fleschScore).toBe(70);
      expect(m70.fleschLabelKey).toBe('fleschFairlyEasy');

      // 52 "cat" words, one sentence: 206.835 - 52.78 - 84.6 = 69.455 → 69.
      const m69 = computeMetrics(repeat('cat', 52));
      expect(m69.fleschScore).toBe(69);
      expect(m69.fleschLabelKey).toBe('fleschStandard');
    });

    it('maps 60 to fleschStandard and 59 to fleschFairlyDifficult (both sides of the 60 boundary)', () => {
      // 61 "cat" words, one sentence: 206.835 - 61.915 - 84.6 = 60.32 → 60.
      const m60 = computeMetrics(repeat('cat', 61));
      expect(m60.fleschScore).toBe(60);
      expect(m60.fleschLabelKey).toBe('fleschStandard');

      // 62 "cat" words, one sentence: 206.835 - 62.93 - 84.6 = 59.305 → 59.
      const m59 = computeMetrics(repeat('cat', 62));
      expect(m59.fleschScore).toBe(59);
      expect(m59.fleschLabelKey).toBe('fleschFairlyDifficult');
    });

    it('maps 50 to fleschFairlyDifficult and 49 to fleschDifficult (both sides of the 50 boundary)', () => {
      // 71 "cat" words, one sentence: 206.835 - 72.065 - 84.6 = 50.17 → 50.
      const m50 = computeMetrics(repeat('cat', 71));
      expect(m50.fleschScore).toBe(50);
      expect(m50.fleschLabelKey).toBe('fleschFairlyDifficult');

      // 72 "cat" words, one sentence: 206.835 - 73.08 - 84.6 = 49.155 → 49.
      const m49 = computeMetrics(repeat('cat', 72));
      expect(m49.fleschScore).toBe(49);
      expect(m49.fleschLabelKey).toBe('fleschDifficult');
    });

    it('maps 30 to fleschDifficult and 29 to fleschVeryDifficult (both sides of the 30 boundary)', () => {
      // 91 "cat" words, one sentence: 206.835 - 92.365 - 84.6 = 29.87 → 30.
      const m30 = computeMetrics(repeat('cat', 91));
      expect(m30.fleschScore).toBe(30);
      expect(m30.fleschLabelKey).toBe('fleschDifficult');

      // 92 "cat" words, one sentence: 206.835 - 93.38 - 84.6 = 28.855 → 29.
      const m29 = computeMetrics(repeat('cat', 92));
      expect(m29.fleschScore).toBe(29);
      expect(m29.fleschLabelKey).toBe('fleschVeryDifficult');
    });

    it('returns the empty key (not a label) for empty input', () => {
      expect(computeMetrics('').fleschLabelKey).toBe('');
    });
  });

  // ------------------------------------------------- avgWordsPerSentence
  describe('avgWordsPerSentence rounding to one decimal', () => {
    it('is 0 for empty input', () => {
      expect(computeMetrics('').avgWordsPerSentence).toBe(0);
    });

    it('rounds a clean integer down to one decimal (4.0)', () => {
      // 8 words, 2 sentences → 4.0 exact.
      const m = computeMetrics('a b c d. a b c d.');
      expect(m.words).toBe(8);
      expect(m.sentences).toBe(2);
      expect(m.avgWordsPerSentence).toBe(4);
    });

    it('keeps 2.5 exact (no rounding needed at the half)', () => {
      // words=5, sentences=2 → 2.5 exact.
      // Every segment must end with punctuation so each is counted as a sentence.
      const m = computeMetrics('one two three. four five.');
      expect(m.words).toBe(5);
      expect(m.sentences).toBe(2);
      expect(m.avgWordsPerSentence).toBe(2.5);
    });

    it('rounds 2.333… to 2.3 (one-decimal rounding)', () => {
      // words=7, sentences=3 → 2.3333 → 2.3.
      const m = computeMetrics('aa bb. cc dd. ee ff gg.');
      expect(m.words).toBe(7);
      expect(m.sentences).toBe(3);
      expect(m.avgWordsPerSentence).toBe(2.3);
    });

    it('rounds 1.666… to 1.7 (rounds up past the half)', () => {
      // words=5, sentences=3 → 1.6666 → 1.7.
      const m = computeMetrics('aa bb. cc dd. ee.');
      expect(m.words).toBe(5);
      expect(m.sentences).toBe(3);
      expect(m.avgWordsPerSentence).toBe(1.7);
    });

    it('rounds 2.25 to 2.3 (Math.round at *10 then /10)', () => {
      // words=9, sentences=4 → 2.25 → 22.5 → Math.round → 23 → 2.3.
      const m = computeMetrics('aa bb. cc dd. ee ff. gg hh ii.');
      expect(m.words).toBe(9);
      expect(m.sentences).toBe(4);
      expect(m.avgWordsPerSentence).toBe(2.3);
    });

    it('rounds 2.75 to 2.8 (Math.round rounds .5 up)', () => {
      // words=11, sentences=4 → 2.75 → 27.5 → 28 → 2.8.
      const m = computeMetrics('aa bb. cc dd. ee ff. gg hh ii jj kk.');
      expect(m.words).toBe(11);
      expect(m.sentences).toBe(4);
      expect(m.avgWordsPerSentence).toBe(2.8);
    });

    it('handles a large sentence count correctly (30 words in 10 sentences)', () => {
      // 30 words, 10 sentences → 3.0 exact.
      const text = Array.from({ length: 10 }, () => 'aa bb cc.').join(' ');
      const m = computeMetrics(text);
      expect(m.words).toBe(30);
      expect(m.sentences).toBe(10);
      expect(m.avgWordsPerSentence).toBe(3);
    });
  });

  // ------------------------------------------------------------ keywords
  describe('keyword filtering, ordering and cap', () => {
    it('filters stopwords (length >= 3 but in the stopword set)', () => {
      const m = computeMetrics('the and for with banana');
      expect(m.topKeywords).toEqual([{ word: 'banana', count: 1 }]);
    });

    it('filters words shorter than 3 characters even when repeated', () => {
      const m = computeMetrics('go to be an ai io');
      expect(m.topKeywords).toEqual([]);
    });

    it('keeps a 3-character word (boundary of the min-length rule)', () => {
      const m = computeMetrics('cat');
      expect(m.topKeywords).toEqual([{ word: 'cat', count: 1 }]);
    });

    it('drops a 2-character word (just below the boundary)', () => {
      const m = computeMetrics('go');
      expect(m.topKeywords).toEqual([]);
    });

    it('lowercases keywords and merges case variants into one entry', () => {
      const m = computeMetrics('Apple apple APPLE');
      expect(m.topKeywords).toEqual([{ word: 'apple', count: 3 }]);
    });

    it('orders keywords by descending count', () => {
      const m = computeMetrics('alpha alpha alpha beta beta gamma');
      expect(m.topKeywords).toEqual([
        { word: 'alpha', count: 3 },
        { word: 'beta', count: 2 },
        { word: 'gamma', count: 1 },
      ]);
    });

    it('keeps the descending order stable across distinct counts', () => {
      // Use words that are not in any stopword list ('mu' is an Italian stopword).
      const m = computeMetrics('zeta zeta yotta yotta yotta delta delta delta delta');
      expect(m.topKeywords.map((k) => k.word)).toEqual(['delta', 'yotta', 'zeta']);
      expect(m.topKeywords.map((k) => k.count)).toEqual([4, 3, 2]);
    });

    it('caps the result at exactly 10 keywords (15 distinct present)', () => {
      const distinct = Array.from({ length: 15 }, (_, i) => `kw${i}zz`);
      const m = computeMetrics(distinct.join(' '));
      expect(m.topKeywords).toHaveLength(10);
    });

    it('caps the result at exactly 10 keywords (11 distinct present)', () => {
      const distinct = Array.from({ length: 11 }, (_, i) => `kw${i}zz`);
      const m = computeMetrics(distinct.join(' '));
      expect(m.topKeywords).toHaveLength(10);
    });

    it('returns all of them when exactly 10 distinct keywords exist', () => {
      const distinct = Array.from({ length: 10 }, (_, i) => `kw${i}zz`);
      const m = computeMetrics(distinct.join(' '));
      expect(m.topKeywords).toHaveLength(10);
    });

    it('returns empty keywords for empty input', () => {
      expect(computeMetrics('').topKeywords).toEqual([]);
    });

    it('returns empty keywords when every token is a stopword or too short', () => {
      const m = computeMetrics('the a an i o go do');
      expect(m.topKeywords).toEqual([]);
    });

    it('mixes stopwords, short words and real keywords correctly', () => {
      const m = computeMetrics('the cat and the dog cat');
      expect(m.topKeywords).toEqual([
        { word: 'cat', count: 2 },
        { word: 'dog', count: 1 },
      ]);
    });

    it('keeps only the 10 highest-count keywords when more than 10 exist', () => {
      // 11 distinct keywords where 'zzz0' dominates.
      const text = `${Array.from({ length: 5 }, () => 'zzz0').join(' ')} ${Array.from({ length: 10 }, (_, i) => `zzz${i + 1}`).join(' ')}`;
      const m = computeMetrics(text);
      expect(m.topKeywords).toHaveLength(10);
      // The top entry must be the most frequent.
      expect(m.topKeywords[0]).toEqual({ word: 'zzz0', count: 5 });
    });
  });

  // ---------------------------------------------------------------- tone
  describe('tone heuristic', () => {
    it('is neutral for empty input', () => {
      expect(computeMetrics('').tone).toBe('neutral');
    });

    it('is informal for short words in short sentences', () => {
      // avgWordLen = chars/words must be < 4 and avgSentenceLen < 12.
      // 'yo yo yo. yo yo yo.' → words=6, chars=19 → 19/6 = 3.17 < 4; avgSent=3 < 12.
      const m = computeMetrics('yo yo yo. yo yo yo.');
      expect(m.words).toBe(6);
      expect(m.avgWordsPerSentence).toBe(3);
      expect(m.chars).toBe(19);
      expect(m.tone).toBe('informal');
    });

    it('is formal for long words in long sentences', () => {
      // avgWordLen > 5.5 AND avgSentenceLen > 18.
      // 19 "internationalization" (20 chars each) in one sentence.
      // chars = 19*20 + 18 spaces = 398 → 398/19 = 20.9 > 5.5.
      // avgSentenceLen = 19 > 18. ✔
      const text = repeat('internationalization', 19);
      const m = computeMetrics(text);
      expect(m.words).toBe(19);
      expect(m.avgWordsPerSentence).toBe(19);
      expect(m.chars).toBe(398);
      expect(m.tone).toBe('formal');
    });

    it('stays neutral when only one tone condition is met (long words, short sentences)', () => {
      // avgWordLen > 5.5 but avgSentenceLen <= 18 → not formal; not informal.
      // 5 "internationalization" in one sentence: avgSent = 5 (< 18).
      const text = repeat('internationalization', 5);
      const m = computeMetrics(text);
      expect(m.avgWordsPerSentence).toBe(5);
      expect(m.tone).toBe('neutral');
    });

    it('stays neutral when only one tone condition is met (short words, long sentences)', () => {
      // avgWordLen < 4 but avgSentenceLen >= 12 → not informal; not formal.
      // 20 "cat" in one sentence: avgSent = 20 (> 18, so formal check fails
      // because avgWordLen is 3 < 5.5) → neutral.
      const text = repeat('cat', 20);
      const m = computeMetrics(text);
      expect(m.avgWordsPerSentence).toBe(20);
      expect(m.tone).toBe('neutral');
    });

    it('is informal at the exact boundary: 11 words, avgSentenceLen = 11 < 12', () => {
      // 11 words of 'ab' (2 chars): chars = 11*2 + 10 = 32 → 32/11 = 2.9 < 4.
      // avgSentenceLen = 11 < 12. ✔
      const text = repeat('ab', 11);
      const m = computeMetrics(text);
      expect(m.words).toBe(11);
      expect(m.avgWordsPerSentence).toBe(11);
      expect(m.tone).toBe('informal');
    });

    it('is NOT informal at 12 words, avgSentenceLen = 12 (not < 12)', () => {
      // 12 words of 'ab': avgSent = 12, not < 12 → neutral.
      const text = repeat('ab', 12);
      const m = computeMetrics(text);
      expect(m.avgWordsPerSentence).toBe(12);
      expect(m.tone).toBe('neutral');
    });

    it('is formal at the exact boundary: avgWordLen > 5.5 and avgSentenceLen = 19 > 18', () => {
      // 19 words of 'abcdefghi' (9 chars): chars = 19*9 + 18 = 189 → 189/19 = 9.9 > 5.5.
      // avgSentenceLen = 19 > 18. ✔
      const text = repeat('abcdefghi', 19);
      const m = computeMetrics(text);
      expect(m.avgWordsPerSentence).toBe(19);
      expect(m.tone).toBe('formal');
    });

    it('is neutral exactly at the formal boundary (avgSentenceLen == 18 is not > 18)', () => {
      // 18 words of 'internationalization' → avgSent = 18, not > 18 → not formal.
      const text = repeat('internationalization', 18);
      const m = computeMetrics(text);
      expect(m.avgWordsPerSentence).toBe(18);
      expect(m.tone).toBe('neutral');
    });

    it('is informal when avgWordLen is just under 4 and avgSentenceLen just under 12', () => {
      // 5 words of 'abcd' (4 chars) + 4 spaces = 24 chars → 24/5 = 4.8 (not < 4).
      // Use 5 words of 'abc' (3 chars): chars = 5*3 + 4 = 19 → 19/5 = 3.8 < 4.
      // avgSentenceLen = 5 < 12. ✔
      const text = repeat('abc', 5);
      const m = computeMetrics(text);
      expect(m.words).toBe(5);
      expect(m.avgWordsPerSentence).toBe(5);
      expect(m.tone).toBe('informal');
    });
  });

  // ----------------------------------------- syllable-count edge cases
  // syllableCount is exercised indirectly through fleschScore: any change to
  // its boundary handling (length <= 3, silent-e decrement, "le" increment,
  // Math.max(1, …) floor) shifts totalSyllables and therefore fleschScore.
  describe('syllableCount boundaries observed via fleschScore', () => {
    it('treats a single letter as one syllable (w.length <= 3 early return)', () => {
      // 1 char word: 206.835 - 1.015 - 84.6 = 121.22 → 121 → clamp 100.
      const m = computeMetrics('a.');
      expect(m.words).toBe(1);
      expect(m.sentences).toBe(1);
      expect(m.fleschScore).toBe(100);
    });

    it('treats a 3-letter word as one syllable (w.length <= 3 early return)', () => {
      // 'cat' is 3 letters: early return 1 before vowel-group matching.
      // 206.835 - 1.015 - 84.6 = 121.22 → 121 → 100.
      const m = computeMetrics('cat.');
      expect(m.fleschScore).toBe(100);
    });

    it('does not decrement for a 3-letter word ending in silent e (guard keeps >= 1)', () => {
      // 'ate' ends in 'e': count-- would give 0, but Math.max(1, …) floors at 1.
      // 4 words, 1 sentence: 206.835 - 4.06 - 84.6 = 118.175 → 118 → 100.
      const m = computeMetrics(repeat('ate', 4));
      expect(m.words).toBe(4);
      expect(m.fleschScore).toBe(100);
    });

    it('counts vowel groups, not vowels ("book" = 1 group)', () => {
      // 'book' → /[aeiouy]+/ matches "oo" as one group → count = 1.
      // 10 "book" words: 206.835 - 10.15 - 84.6 = 112.085 → 112 → 100.
      const m = computeMetrics(repeat('book', 10));
      expect(m.words).toBe(10);
      expect(m.fleschScore).toBe(100);
    });
  });

  // ------------------------------------------------- derived-field coherence
  describe('returned object shape', () => {
    it('returns every documented field', () => {
      const m = computeMetrics('Hello world. Second sentence here!');
      expect(Object.keys(m).sort()).toEqual([
        'avgWordsPerSentence',
        'chars',
        'fleschLabelKey',
        'fleschScore',
        'paragraphs',
        'readingTimeMin',
        'sentences',
        'tone',
        'topKeywords',
        'words',
      ]);
    });

    it('keeps topKeywords entries shaped as {word, count}', () => {
      const m = computeMetrics('banana banana');
      expect(m.topKeywords[0]).toEqual({ word: 'banana', count: 2 });
      expect(Object.keys(m.topKeywords[0]).sort()).toEqual(['count', 'word']);
    });
  });
});
