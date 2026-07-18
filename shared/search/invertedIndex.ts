// Pure, fs-free inverted index with BM25 ranking, shared by the Electron
// full-text read model and the MCP server so both rank identically.

export interface TokenizeOptions {
  minLength?: number;
  stopwords?: ReadonlySet<string>;
}

/** Lowercase, split on non-alphanumerics (unicode-aware so accents survive). */
export function tokenize(text: string, opts: TokenizeOptions = {}): string[] {
  const minLength = opts.minLength ?? 2;
  const stop = opts.stopwords;
  const out: string[] = [];
  for (const raw of text.toLowerCase().split(/[^\p{L}\p{N}]+/u)) {
    if (raw.length >= minLength && (!stop || !stop.has(raw))) out.push(raw);
  }
  return out;
}

export interface IndexDocInput {
  id: string;
  title: string;
  text: string;
  mtimeMs: number;
}

export interface RankedHit {
  id: string;
  score: number;
  matchedTerms: string[];
}

export interface SearchParams {
  limit?: number;
  k1?: number;
  b?: number;
  titleBoost?: number;
  allTermsBonus?: number;
}

interface StoredDoc {
  title: string;
  text: string;
  mtimeMs: number;
}

export class InvertedIndex {
  private postings = new Map<string, Map<string, number>>(); // term -> (docId -> term frequency)
  private titleTerms = new Map<string, Set<string>>();        // docId -> title terms
  private docBodyTerms = new Map<string, string[]>();         // docId -> distinct body terms (for O(terms) removal)
  private docLen = new Map<string, number>();                 // docId -> body token count
  private docs = new Map<string, StoredDoc>();
  private totalLen = 0;

  get size(): number { return this.docs.size; }
  has(id: string): boolean { return this.docs.has(id); }
  getDoc(id: string): StoredDoc | undefined { return this.docs.get(id); }

  /** Insert or replace a document. */
  add(doc: IndexDocInput): void {
    this.remove(doc.id); // upsert semantics
    const bodyTokens = tokenize(doc.text);
    const tf = new Map<string, number>();
    for (const term of bodyTokens) tf.set(term, (tf.get(term) ?? 0) + 1);
    for (const [term, count] of tf) {
      let p = this.postings.get(term);
      if (!p) { p = new Map(); this.postings.set(term, p); }
      p.set(doc.id, count);
    }
    this.docBodyTerms.set(doc.id, [...tf.keys()]);
    this.titleTerms.set(doc.id, new Set(tokenize(doc.title)));
    this.docLen.set(doc.id, bodyTokens.length);
    this.totalLen += bodyTokens.length;
    this.docs.set(doc.id, { title: doc.title, text: doc.text, mtimeMs: doc.mtimeMs });
  }

  remove(id: string): void {
    if (!this.docs.has(id)) return;
    for (const term of this.docBodyTerms.get(id) ?? []) {
      const p = this.postings.get(term);
      if (p && p.delete(id) && p.size === 0) this.postings.delete(term);
    }
    this.totalLen -= this.docLen.get(id) ?? 0;
    this.docBodyTerms.delete(id);
    this.titleTerms.delete(id);
    this.docLen.delete(id);
    this.docs.delete(id);
  }

  rename(oldId: string, newId: string, newTitle: string): void {
    const doc = this.docs.get(oldId);
    if (!doc) return;
    this.add({ id: newId, title: newTitle, text: doc.text, mtimeMs: doc.mtimeMs });
    this.remove(oldId);
  }

  clear(): void {
    this.postings.clear();
    this.titleTerms.clear();
    this.docBodyTerms.clear();
    this.docLen.clear();
    this.docs.clear();
    this.totalLen = 0;
  }

  /** BM25 body ranking + a flat title boost and all-terms bonus. */
  search(query: string, params: SearchParams = {}): RankedHit[] {
    const limit = params.limit ?? 25;
    const k1 = params.k1 ?? 1.2;
    const b = params.b ?? 0.75;
    const titleBoost = params.titleBoost ?? 10;
    const allTermsBonus = params.allTermsBonus ?? 5;

    const qTerms = [...new Set(tokenize(query))];
    const N = this.docs.size;
    if (qTerms.length === 0 || N === 0) return [];
    const avgdl = this.totalLen / N || 1;

    const candidates = new Set<string>();
    for (const term of qTerms) {
      const p = this.postings.get(term);
      if (p) for (const id of p.keys()) candidates.add(id);
    }
    for (const [id, tset] of this.titleTerms) {
      if (qTerms.some(t => tset.has(t))) candidates.add(id);
    }

    const hits: RankedHit[] = [];
    for (const id of candidates) {
      const dl = this.docLen.get(id) ?? 0;
      const tset = this.titleTerms.get(id);
      let score = 0;
      const matched: string[] = [];
      for (const term of qTerms) {
        const tf = this.postings.get(term)?.get(id) ?? 0;
        const inTitle = tset?.has(term) ?? false;
        if (tf > 0 || inTitle) matched.push(term);
        if (tf > 0) {
          const df = this.postings.get(term)!.size;
          const idf = Math.log(1 + (N - df + 0.5) / (df + 0.5));
          score += idf * (tf * (k1 + 1)) / (tf + k1 * (1 - b + b * dl / avgdl));
        }
        if (inTitle) score += titleBoost;
      }
      if (matched.length === 0) continue;
      if (matched.length === qTerms.length) score += allTermsBonus;
      hits.push({ id, score, matchedTerms: matched });
    }

    hits.sort((a, c) => (c.score !== a.score
      ? c.score - a.score
      : (this.docs.get(c.id)?.mtimeMs ?? 0) - (this.docs.get(a.id)?.mtimeMs ?? 0)));
    return hits.slice(0, limit);
  }
}
