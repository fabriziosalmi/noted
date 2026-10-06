// @vitest-environment node
import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import { diffSequences, diffStats, diffText, diffWords, splitLines, toHunks, type DiffRow } from './textDiff';

const side = (rows: DiffRow[], kinds: string[]): string[] => rows.filter(r => kinds.includes(r.kind)).map(r => r.segments.map(s => s.text).join(''));

describe('diffText', () => {
  it('has no rows for no text, and only unchanged rows for equal text', () => {
    expect(diffText('', '')).toEqual([]);
    expect(diffText('a\nb\n', 'a\nb\n').every(r => r.kind === 'same')).toBe(true);
  });

  it('numbers lines on both sides', () => {
    const rows = diffText('a\nb\nc\n', 'a\nX\nc\nd\n');
    expect(rows.map(r => [r.kind, r.oldLine, r.newLine])).toEqual([
      ['same', 1, 1], ['del', 2, undefined], ['add', undefined, 2], ['same', 3, 3], ['add', undefined, 4],
    ]);
  });

  it('flags the words that changed inside a rewritten line, and only those', () => {
    const rows = diffText('The quick brown fox jumps.\n', 'The quick red fox jumps.\n');
    const del = rows.find(r => r.kind === 'del')!;
    const add = rows.find(r => r.kind === 'add')!;
    expect(del.segments).toEqual([
      { text: 'The quick ', changed: false }, { text: 'brown', changed: true }, { text: ' fox jumps.', changed: false },
    ]);
    expect(add.segments).toEqual([
      { text: 'The quick ', changed: false }, { text: 'red', changed: true }, { text: ' fox jumps.', changed: false },
    ]);
  });

  it('a pure insertion or deletion is not paired with anything', () => {
    expect(diffText('a\n', 'a\nb\n').map(r => r.kind)).toEqual(['same', 'add']);
    expect(diffText('a\nb\n', 'a\n').map(r => r.kind)).toEqual(['same', 'del']);
    expect(diffText('', 'new\n')[0].segments).toEqual([{ text: 'new', changed: false }]);
  });

  it('treats CRLF and a missing final newline as the same lines', () => {
    expect(diffText('a\r\nb\r\n', 'a\nb').every(r => r.kind === 'same')).toBe(true);
  });

  it('keeps unrelated lines paired by position, and extra lines plain', () => {
    const rows = diffText('one\ntwo\nthree\n', 'uno\n');
    expect(side(rows, ['del'])).toEqual(['one', 'two', 'three']);
    expect(side(rows, ['add'])).toEqual(['uno']);
  });

  it('a Markdown change reads as a change of words, not of syntax', () => {
    const rows = diffText('# Plan\n\nWe ship **Friday**.\n', '# Plan\n\nWe ship **Monday**.\n');
    expect(rows.filter(r => r.kind !== 'same').flatMap(r => r.segments.filter(s => s.changed).map(s => s.text))).toEqual(['Friday', 'Monday']);
  });

  it('rebuilds both texts exactly (generated texts)', () => {
    const line = fc.stringMatching(/^[a-c ]{0,6}$/);
    fc.assert(fc.property(fc.array(line, { maxLength: 12 }), fc.array(line, { maxLength: 12 }), (a, b) => {
      const before = a.join('\n');
      const after = b.join('\n');
      const rows = diffText(before, after);
      expect(side(rows, ['same', 'del'])).toEqual(splitLines(before));
      expect(side(rows, ['same', 'add'])).toEqual(splitLines(after));
    }), { numRuns: 300 });
  });

  it('is minimal where it counts: identical text has no changes, a one-line edit is one pair', () => {
    fc.assert(fc.property(fc.array(fc.stringMatching(/^[a-c]{1,4}$/), { minLength: 1, maxLength: 20 }), fc.nat(), (lines, at) => {
      const i = at % lines.length;
      const edited = lines.map((l, k) => (k === i ? `${l}!` : l));
      const stats = diffStats(diffText(lines.join('\n'), edited.join('\n')));
      expect(stats).toEqual({ added: 1, removed: 1 });
    }), { numRuns: 200 });
  });

  it('copes with a very large rewrite without building a huge table', () => {
    const a = Array.from({ length: 3000 }, (_, i) => `old ${i}`).join('\n');
    const b = Array.from({ length: 3000 }, (_, i) => `new ${i}`).join('\n');
    const rows = diffText(a, b);
    expect(diffStats(rows)).toEqual({ added: 3000, removed: 3000 });
  });
});

describe('diffWords', () => {
  it('flags nothing when nothing changed, and everything when everything did', () => {
    expect(diffWords('same words', 'same words').before.every(s => !s.changed)).toBe(true);
    expect(diffWords('abc', 'xyz')).toEqual({ before: [{ text: 'abc', changed: true }], after: [{ text: 'xyz', changed: true }] });
  });

  it('joins back to the original line on each side', () => {
    fc.assert(fc.property(fc.string({ maxLength: 30 }), fc.string({ maxLength: 30 }), (a, b) => {
      const d = diffWords(a, b);
      expect(d.before.map(s => s.text).join('')).toBe(a);
      expect(d.after.map(s => s.text).join('')).toBe(b);
    }), { numRuns: 300 });
  });
});

describe('diffSequences', () => {
  it('returns runs of equal, deleted and added items', () => {
    expect(diffSequences(['a', 'b', 'c'], ['a', 'c', 'd'])).toEqual([
      { type: 'equal', items: ['a'] }, { type: 'del', items: ['b'] }, { type: 'equal', items: ['c'] }, { type: 'add', items: ['d'] },
    ]);
  });
});

describe('toHunks', () => {
  const rows = diffText(Array.from({ length: 30 }, (_, i) => `line ${i}`).join('\n'), Array.from({ length: 30 }, (_, i) => (i === 3 || i === 25 ? `LINE ${i}` : `line ${i}`)).join('\n'));

  it('keeps the changes with context and says how much was left out', () => {
    const { hunks, skippedAfter } = toHunks(rows, 2);
    expect(hunks).toHaveLength(2);
    expect(hunks[0].skipped).toBe(1); // lines 0 (context starts at line 1)
    expect(hunks[1].skipped).toBe(17);
    expect(skippedAfter).toBe(2);
    expect(hunks.flatMap(h => h.rows).filter(r => r.kind !== 'same')).toHaveLength(4);
  });

  it('is one hunk when changes are close, and none when there are none', () => {
    expect(toHunks(diffText('a\nb\nc\n', 'a\nB\nc\n')).hunks).toHaveLength(1);
    expect(toHunks(diffText('a\n', 'a\n')).hunks).toHaveLength(0);
    expect(toHunks(diffText('a\nb\n', 'a\nb\n')).skippedAfter).toBe(2);
  });
});
