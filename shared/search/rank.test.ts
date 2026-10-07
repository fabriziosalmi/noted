import { describe, it, expect } from 'vitest';
import { normalize, reciprocalRankFusion, RRF_K, topKDense } from './rank';

describe('reciprocalRankFusion', () => {
  it('scores 1 / (k + position) for each ranking that has the item', () => {
    const fused = reciprocalRankFusion([['a', 'b'], ['b', 'c']]);
    expect(fused.map(f => f.id)).toEqual(['b', 'a', 'c']);
    const [b, a, c] = fused;
    expect(b.score).toBeCloseTo(1 / (RRF_K + 2) + 1 / (RRF_K + 1), 12);
    expect(b.ranks).toEqual([2, 1]);
    expect(a.ranks).toEqual([1, null]);
    expect(c.ranks).toEqual([null, 2]);
  });

  it('what two rankings both like beats what one ranks first', () => {
    const out = reciprocalRankFusion([['solo', 'both'], ['other', 'both']]).map(f => f.id);
    expect(out[0]).toBe('both');
  });

  it('needs no calibration: only positions count, not scores', () => {
    expect(reciprocalRankFusion([['x', 'y'], ['y', 'x']]).map(f => f.id)).toEqual(['x', 'y']); // a tie: the earlier ranking decides
  });

  it('counts an item listed twice in one ranking once, at its first place', () => {
    const [first] = reciprocalRankFusion([['a', 'a', 'b'], ['b']]);
    expect(first.id).toBe('b'); // a is first in one ranking only; b is second of one and first of the other
    expect(reciprocalRankFusion([['a', 'a']])[0].ranks).toEqual([1]);
  });

  it('handles no rankings and empty ones', () => {
    expect(reciprocalRankFusion([])).toEqual([]);
    expect(reciprocalRankFusion([[], []])).toEqual([]);
    expect(reciprocalRankFusion([[], ['a']]).map(f => f.id)).toEqual(['a']);
  });
});

describe('normalize', () => {
  it('gives length 1, and leaves a zero vector alone', () => {
    const v = normalize([3, 4]);
    expect(Array.from(v)).toEqual([0.6000000238418579, 0.800000011920929]);
    expect(Array.from(normalize([0, 0]))).toEqual([0, 0]);
  });
});

describe('topKDense', () => {
  const ids = ['x', 'y', 'z', 'w'];
  const rows = new Float32Array([...normalize([1, 0]), ...normalize([1, 1]), ...normalize([0, 1]), ...normalize([-1, 0])]);

  it('returns the k most similar, best first', () => {
    const hits = topKDense(normalize([1, 0.1]), ids, rows, 2, 2);
    expect(hits.map(h => h.id)).toEqual(['x', 'y']);
    expect(hits[0].score).toBeGreaterThan(hits[1].score);
    expect(hits[0].score).toBeCloseTo(0.995, 2);
  });

  it('returns fewer when there are fewer, and all in order when k is large', () => {
    expect(topKDense(normalize([0, 1]), ids, rows, 2, 10).map(h => h.id)).toEqual(['z', 'y', 'x', 'w']);
  });

  it('agrees with sorting everything, on random data', () => {
    let seed = 7;
    const rand = () => { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed / 0x7fffffff - 0.5; };
    const dim = 16;
    const n = 300;
    const all: Float32Array[] = Array.from({ length: n }, () => normalize(Array.from({ length: dim }, rand)));
    const rowsR = new Float32Array(n * dim);
    all.forEach((v, i) => rowsR.set(v, i * dim));
    const idsR = all.map((_, i) => `c${i}`);
    const q = normalize(Array.from({ length: dim }, rand));
    const expected = idsR.map((id, i) => ({ id, score: all[i].reduce((s, x, j) => s + x * q[j], 0) })).sort((a, b) => b.score - a.score).slice(0, 12);
    const got = topKDense(q, idsR, rowsR, dim, 12);
    expect(got.map(h => h.id)).toEqual(expected.map(h => h.id));
  });

  it('refuses what cannot be compared: a query of another size, no rows, k of zero', () => {
    expect(topKDense(normalize([1, 0, 0]), ids, rows, 2, 3)).toEqual([]);
    expect(topKDense(normalize([1, 0]), [], new Float32Array(0), 2, 3)).toEqual([]);
    expect(topKDense(normalize([1, 0]), ids, rows, 2, 0)).toEqual([]);
    expect(topKDense(new Float32Array(0), ids, rows, 0, 3)).toEqual([]);
  });
});
