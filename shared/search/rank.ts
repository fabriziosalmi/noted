// Ranking for retrieval: dense similarity over stored vectors, and the fusion of several rankings into one. Pure: arrays in,
// arrays out. Vectors are unit length (normalised once, when stored), so similarity is a dot product.

/** The reciprocal-rank-fusion constant from the paper that introduced it; 60 is what every system copies, for good reason. */
export const RRF_K = 60;

export interface Fused {
  id: string;
  score: number;
  /** The 1-based position in each input ranking, or null where the ranking did not have it. */
  ranks: (number | null)[];
}

/**
 * Reciprocal rank fusion: an item's score is the sum, over the rankings that have it, of 1 / (k + position). It needs no
 * calibration between rankings (BM25 scores and cosine similarities are not comparable) and rewards what several of them like.
 * Ties go to the item that came first in the earlier ranking.
 */
export function reciprocalRankFusion(rankings: readonly (readonly string[])[], k = RRF_K): Fused[] {
  const byId = new Map<string, Fused>();
  const order: string[] = [];
  rankings.forEach((ranking, r) => {
    const seen = new Set<string>();
    ranking.forEach(id => {
      if (seen.has(id)) return; // a ranking that lists an item twice counts its first place only
      seen.add(id);
      let item = byId.get(id);
      if (!item) { item = { id, score: 0, ranks: rankings.map(() => null) }; byId.set(id, item); order.push(id); }
      item.ranks[r] = seen.size;
      item.score += 1 / (k + seen.size);
    });
  });
  const position = new Map(order.map((id, i) => [id, i]));
  return [...byId.values()].sort((a, b) => b.score - a.score || (position.get(a.id) as number) - (position.get(b.id) as number));
}

/** A copy of the vector scaled to length 1 (a zero vector stays zero). */
export function normalize(vector: ArrayLike<number>): Float32Array {
  const v = Float32Array.from(vector);
  let sum = 0;
  for (const x of v) sum += x * x;
  const norm = Math.sqrt(sum);
  return norm === 0 ? v : v.map(x => x / norm);
}

export interface DenseHit { id: string; score: number }

/**
 * The `k` stored vectors most similar to the query. `rows` holds the vectors back to back (`ids.length * dim` numbers). Only
 * the best k are kept while scanning (a small sorted list), so a vault of a hundred thousand chunks costs one pass.
 */
export function topKDense(query: Float32Array, ids: readonly string[], rows: Float32Array, dim: number, k: number): DenseHit[] {
  if (dim === 0 || query.length !== dim || k <= 0) return [];
  const best: DenseHit[] = [];
  for (let r = 0; r < ids.length; r++) {
    const base = r * dim;
    let dot = 0;
    for (let i = 0; i < dim; i++) dot += query[i] * rows[base + i];
    if (best.length === k && dot <= best[k - 1].score) continue;
    let at = best.length;
    while (at > 0 && best[at - 1].score < dot) at--;
    best.splice(at, 0, { id: ids[r], score: dot });
    if (best.length > k) best.pop();
  }
  return best;
}
