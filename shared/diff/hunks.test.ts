import { describe, it, expect } from 'vitest';
import { compose, reviewable } from './hunks';

const all = (n: number) => new Set(Array.from({ length: n }, (_, i) => i));
const only = (...ids: number[]) => new Set(ids);

describe('reviewable', () => {
  it('makes one change of each run of changed lines, with the unchanged lines between them as pieces', () => {
    const r = reviewable('a\nb\nc\nd\ne', 'a\nB\nc\nd\nE\nF');
    expect(r.changes.map(c => [c.removed.map(x => x.segments.map(s => s.text).join('')), c.added.map(x => x.segments.map(s => s.text).join(''))])).toEqual([
      [['b'], ['B']],
      [['e'], ['E', 'F']],
    ]);
    expect(r.pieces.map(p => (p.kind === 'same' ? p.rows.length : `#${p.id}`))).toEqual([1, '#0', 2, '#1']);
  });

  it('a pure addition has nothing removed, a pure deletion nothing added', () => {
    expect(reviewable('a\nc', 'a\nb\nc').changes[0]).toMatchObject({ removed: [], added: [expect.anything()] });
    expect(reviewable('a\nb\nc', 'a\nc').changes[0]).toMatchObject({ added: [], removed: [expect.anything()] });
  });

  it('identical texts have no change, and an empty text against a text is one', () => {
    expect(reviewable('x\ny', 'x\ny').changes).toEqual([]);
    expect(reviewable('', 'x').changes).toHaveLength(1);
    expect(reviewable('x', '').changes).toHaveLength(1);
    expect(reviewable('', '')).toEqual({ pieces: [], changes: [] });
  });
});

describe('compose', () => {
  const before = 'one\ntwo\nthree\nfour\nfive\nsix\n';
  const after = 'one\nTWO\nthree\nfour\nFIVE\nSIX\nseven\n';
  const r = reviewable(before, after);

  it('takes the changes it is given and leaves the others as they were', () => {
    expect(r.changes).toHaveLength(2);
    expect(compose(before, after, r, only(0))).toBe('one\nTWO\nthree\nfour\nfive\nsix\n');
    expect(compose(before, after, r, only(1))).toBe('one\ntwo\nthree\nfour\nFIVE\nSIX\nseven\n');
  });

  it('all gives the text after and none the text before, exactly', () => {
    expect(compose(before, after, r, all(2))).toBe(after);
    expect(compose(before, after, r, new Set())).toBe(before);
  });

  it('is exact even where the diff cannot see the difference: a missing final newline, CRLF', () => {
    const b = 'a\r\nb\r\n';
    const a = 'a\nB';
    const rr = reviewable(b, a);
    expect(compose(b, a, rr, all(rr.changes.length))).toBe(a);
    expect(compose(b, a, rr, new Set())).toBe(b);
    const b2 = 'a\r\nb\r\nc\r\nd\r\n';
    const a2 = 'a\r\nB\r\nc\r\nD\r\n';
    const r2 = reviewable(b2, a2);
    expect(compose(b2, a2, r2, only(0))).toBe('a\r\nB\r\nc\r\nd\r\n'); // a mixture keeps the line ends of the text before
  });

  it('a deletion that is kept removes the lines, one that is dropped keeps them', () => {
    const rr = reviewable('a\nb\nc\n', 'a\nc\n');
    expect(compose('a\nb\nc\n', 'a\nc\n', rr, new Set())).toBe('a\nb\nc\n');
    expect(compose('a\nb\nc\n', 'a\nc\n', rr, only(0))).toBe('a\nc\n');
  });

  it('for any texts and any choice: taking all or none is exact, and a mixture is made of the lines of one side or the other', () => {
    let seed = 42;
    const rand = (n: number) => { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed % n; };
    const words = ['alpha', 'beta', 'gamma', 'delta', 'eps', '', 'alpha beta', 'x'];
    const randomText = () => Array.from({ length: rand(9) }, () => words[rand(words.length)]).join('\n') + (rand(2) ? '\n' : '');
    for (let i = 0; i < 400; i++) {
      const b = randomText();
      const a = randomText();
      const rr = reviewable(b, a);
      const n = rr.changes.length;
      expect(compose(b, a, rr, all(n))).toBe(a);
      if (n === 0) continue; // nothing to choose: the proposal
      expect(compose(b, a, rr, new Set())).toBe(b);
      if (n < 2) continue;
      const pick = new Set(Array.from({ length: n }, (_, k) => k).filter(() => rand(2) === 1));
      const mixed = compose(b, a, rr, pick);
      const lines = (t: string) => (t === '' ? [] : t.replace(/\n$/, '').split('\n'));
      const expectedCount = rr.pieces.reduce((sum, p) => sum + (p.kind === 'same' ? p.rows.length : (pick.has(p.id) ? rr.changes[p.id].added.length : rr.changes[p.id].removed.length)), 0);
      expect(lines(mixed)).toHaveLength(expectedCount);
      const pool = new Set([...lines(b), ...lines(a)]);
      expect(lines(mixed).every(l => pool.has(l))).toBe(true);
    }
  });
});
