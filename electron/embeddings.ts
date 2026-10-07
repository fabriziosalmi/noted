// Retrieval over the whole vault by meaning and by words, at the level of a note's sections.
//
// The main process owns what must be fast and must survive restarts: cutting notes into chunks, the vectors on disk, and the
// ranking. The renderer owns what needs the user's provider and key: it asks for the chunks that have no vector yet
// (`pending`), embeds them in batches, and hands the vectors back (`put`); to search it embeds the question and asks `search`.
//
// A chunk is known by the hash of the text that was embedded (see embedding-store.ts), so an edit costs one chunk, not a
// note, and a note that was only moved costs none.

import fs from 'node:fs';
import path from 'node:path';
import { chunkNote, embedText } from '../shared/search/chunks.js';
import { InvertedIndex, tokenize } from '../shared/search/invertedIndex.js';
import { STOPWORDS } from '../shared/search/stopwords.js';
import { normalize, reciprocalRankFusion, topKDense } from '../shared/search/rank.js';
import { chunkHash, DimensionMismatchError, EmbeddingStore, MAX_STORE_BYTES, storeFile } from './embedding-store.js';
import type { FullTextSearchReadModel } from './fulltext-index.js';

import type { EmbeddingModelRef, EmbeddingStatus, RagChunk } from '../shared/search/embeddingTypes.js';

export type ModelRef = EmbeddingModelRef;

interface ChunkMeta { hash: string; ord: number; headingPath: string[] }
interface TableEntry { mtimeMs: number; title: string; chunks: ChunkMeta[] }

export interface PendingItem { hash: string; text: string }

export interface SearchOutput {
  chunks: RagChunk[];
  /** "hybrid" when meaning took part, "lexical" when only words did (no vectors yet, or none that fit the question's). */
  mode: 'hybrid' | 'lexical';
}

const MAX_NOTE_BYTES = 20 * 1024 * 1024;
const READ_CONCURRENCY = 16;
/** Notes the word ranking looks into (unless the user set another number); and chunks the meaning ranking contributes. */
const LEXICAL_NOTES = 30;
const DENSE_CHUNKS = 60;
const DEFAULT_PER_NOTE = 3;
/** The store is rewritten when it holds this many times the chunks that still exist. */
const COMPACT_RATIO = 1.3;

async function mapLimit<T, R>(items: readonly T[], limit: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const out = new Array<R>(items.length);
  let next = 0;
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (next < items.length) { const i = next++; out[i] = await fn(items[i]); }
  }));
  return out;
}

interface DirState {
  table: Map<string, TableEntry>;
  /** hash -> where it is now (the first place, when the same text is in several). */
  where: Map<string, { name: string; ord: number }>;
  stores: Map<string, EmbeddingStore>;
  building: Promise<void> | null;
}

export class EmbeddingService {
  private readonly byDir = new Map<string, DirState>();

  private readonly fullText: FullTextSearchReadModel;

  constructor(fullText: FullTextSearchReadModel) { this.fullText = fullText; }

  private state(dir: string): DirState {
    const key = path.resolve(dir);
    let s = this.byDir.get(key);
    if (!s) { s = { table: new Map(), where: new Map(), stores: new Map(), building: null }; this.byDir.set(key, s); }
    return s;
  }

  private store(dir: string, model: ModelRef): EmbeddingStore {
    const s = this.state(dir);
    const file = storeFile(path.resolve(dir), model.provider, model.model);
    let store = s.stores.get(file);
    if (!store) { store = EmbeddingStore.open(file); s.stores.set(file, store); }
    return store;
  }

  private async readNote(dir: string, name: string): Promise<string | null> {
    try {
      const file = path.join(dir, name);
      const stat = await fs.promises.stat(file);
      if (!stat.isFile() || stat.size > MAX_NOTE_BYTES) return null;
      return await fs.promises.readFile(file, 'utf-8');
    } catch { return null; }
  }

  /** The chunk table brought up to date with the notes: only notes that changed since the last time are read. */
  private async refreshTable(dir: string, validate: (name: string) => void): Promise<DirState> {
    const state = this.state(dir);
    if (state.building) { await state.building; return state; }
    state.building = (async () => {
      const docs = await this.fullText.docs(dir, validate);
      const present = new Set(docs.map(d => d.id));
      for (const name of [...state.table.keys()]) if (!present.has(name)) state.table.delete(name);
      const stale = docs.filter(d => state.table.get(d.id)?.mtimeMs !== d.mtimeMs);
      await mapLimit(stale, READ_CONCURRENCY, async (doc) => {
        const raw = await this.readNote(dir, doc.id);
        if (raw === null) { state.table.delete(doc.id); return; }
        const chunks = chunkNote(doc.title, raw).map(c => ({ hash: chunkHash(embedText(doc.title, c)), ord: c.ord, headingPath: c.headingPath }));
        state.table.set(doc.id, { mtimeMs: doc.mtimeMs, title: doc.title, chunks });
      });
      state.where = new Map();
      for (const [name, entry] of state.table) for (const c of entry.chunks) if (!state.where.has(c.hash)) state.where.set(c.hash, { name, ord: c.ord });
    })();
    try { await state.building; } finally { state.building = null; }
    return state;
  }

  async status(dir: string, model: ModelRef, validate: (name: string) => void): Promise<EmbeddingStatus> {
    const state = await this.refreshTable(dir, validate);
    const store = this.store(dir, model);
    let embedded = 0;
    for (const hash of state.where.keys()) if (store.has(hash)) embedded++;
    return { chunks: state.where.size, embedded, dimension: store.dimension, capped: store.bytes >= MAX_STORE_BYTES };
  }

  /**
   * The next chunks that have no vector yet (at most `limit`), with the text to embed, and how many are left in all. When
   * nothing is left, vectors of chunks that no longer exist are given back.
   */
  async pending(dir: string, model: ModelRef, limit: number, validate: (name: string) => void): Promise<{ items: PendingItem[]; remaining: number; status: EmbeddingStatus }> {
    const state = await this.refreshTable(dir, validate);
    const store = this.store(dir, model);
    const capped = store.bytes >= MAX_STORE_BYTES;
    const missing: { hash: string; name: string; ord: number }[] = [];
    for (const [hash, at] of state.where) if (!store.has(hash)) missing.push({ hash, ...at });
    const status: EmbeddingStatus = { chunks: state.where.size, embedded: state.where.size - missing.length, dimension: store.dimension, capped };
    if (capped) return { items: [], remaining: 0, status };

    if (missing.length === 0) {
      if (store.size > state.where.size * COMPACT_RATIO + 16) store.retain(new Set(state.where.keys()));
      return { items: [], remaining: 0, status };
    }

    const take = missing.slice(0, Math.max(1, Math.min(256, Math.floor(limit))));
    const byNote = new Map<string, typeof take>();
    for (const m of take) byNote.set(m.name, [...(byNote.get(m.name) ?? []), m]);
    const items: PendingItem[] = [];
    await mapLimit([...byNote.entries()], READ_CONCURRENCY, async ([name, wanted]) => {
      const raw = await this.readNote(dir, name);
      const entry = state.table.get(name);
      if (raw === null || !entry) return;
      const fresh = new Map(chunkNote(entry.title, raw).map(c => { const text = embedText(entry.title, c); return [chunkHash(text), text] as const; }));
      for (const w of wanted) { const text = fresh.get(w.hash); if (text !== undefined) items.push({ hash: w.hash, text }); }
    });
    // A note edited since the table was made no longer has some of these chunks: they are not offered (the next round has the new ones).
    return { items, remaining: missing.length, status };
  }

  /** Stores vectors for chunks. Returns how many were new. Throws DimensionMismatchError if they do not fit the model's store. */
  put(dir: string, model: ModelRef, entries: readonly { hash: string; vector: ArrayLike<number> }[]): number {
    const store = this.store(dir, model);
    if (store.bytes >= MAX_STORE_BYTES) return 0;
    return store.add(entries);
  }

  /** Forgets this model's vectors (the file goes too). */
  clear(dir: string, model: ModelRef): void {
    const state = this.state(dir);
    const file = storeFile(path.resolve(dir), model.provider, model.model);
    (state.stores.get(file) ?? EmbeddingStore.open(file)).clear();
    state.stores.delete(file);
  }

  /**
   * The chunks that best answer a question, from the whole vault: the words rank the sections of the notes BM25 likes best,
   * the vectors (if the caller embedded the question) rank every embedded section by meaning, and reciprocal rank fusion
   * merges the two. Without a usable question vector it is the words alone.
   */
  async search(
    dir: string,
    model: ModelRef,
    query: string,
    queryVector: ArrayLike<number> | null,
    topK: number,
    validate: (name: string) => void,
    opts: { maxPerNote?: number; pool?: number } = {},
  ): Promise<SearchOutput> {
    const k = Math.max(1, Math.min(50, Math.floor(topK)));
    const perNote = Math.max(1, opts.maxPerNote ?? DEFAULT_PER_NOTE);
    const pool = Math.max(5, Math.min(100, Math.floor(opts.pool ?? LEXICAL_NOTES)));
    const noteCache = new Map<string, Promise<{ title: string; chunks: ReturnType<typeof chunkNote>; hashes: string[] } | null>>();
    const noteChunks = (name: string, title: string) => {
      let p = noteCache.get(name);
      if (!p) {
        p = this.readNote(dir, name).then(raw => {
          if (raw === null) return null;
          const chunks = chunkNote(title, raw);
          return { title, chunks, hashes: chunks.map(c => chunkHash(embedText(title, c))) };
        });
        noteCache.set(name, p);
      }
      return p;
    };

    // Words: BM25 picks the notes, then the sections of those notes are ranked against the question.
    const { candidates } = await this.fullText.candidates(dir, query, pool, validate);
    const lexical = new InvertedIndex();
    const meta = new Map<string, { name: string; ord: number }>();
    for (const cand of candidates) {
      const note = await noteChunks(cand.name, cand.title);
      for (const c of note?.chunks ?? []) {
        const id = `${cand.name}#${c.ord}`;
        meta.set(id, { name: cand.name, ord: c.ord });
        lexical.add({ id, title: c.headingPath.join(' '), text: c.text, mtimeMs: 0 });
      }
    }
    const significant = [...new Set(tokenize(query).filter(w => !STOPWORDS.has(w)))];
    const lexicalHits = lexical.search(query, { limit: DENSE_CHUNKS, titleBoost: 2, allTermsBonus: 0 });
    const lexicalIds = lexicalHits.map(h => h.id);
    const coverage = new Map(lexicalHits.map(h => [h.id, significant.length === 0 ? 0 : h.matchedTerms.filter(t => significant.includes(t)).length / significant.length]));

    // Meaning: every embedded section, by similarity to the question.
    let denseIds: string[] = [];
    const similarity = new Map<string, number>();
    let usedDense = false;
    if (queryVector && queryVector.length > 0) {
      const state = await this.refreshTable(dir, validate);
      const store = this.store(dir, model);
      const { ids, rows, dim } = store.matrix();
      if (store.size > 0 && dim === queryVector.length) {
        usedDense = true;
        denseIds = [];
        for (const hit of topKDense(normalize(queryVector), ids, rows, dim, DENSE_CHUNKS)) {
          const w = state.where.get(hit.id);
          if (!w) continue;
          const id = `${w.name}#${w.ord}`;
          if (!meta.has(id)) meta.set(id, w);
          similarity.set(id, hit.score);
          denseIds.push(id);
        }
      }
    }

    const fused = reciprocalRankFusion(usedDense ? [lexicalIds, denseIds] : [lexicalIds]);
    const results: RagChunk[] = [];
    const perNoteCount = new Map<string, number>();
    for (const f of fused) {
      if (results.length >= k) break;
      const at = meta.get(f.id);
      if (!at) continue;
      if ((perNoteCount.get(at.name) ?? 0) >= perNote) continue;
      const title = this.state(dir).table.get(at.name)?.title ?? candidates.find(c => c.name === at.name)?.title ?? at.name.replace(/\.md$/i, '');
      const note = await noteChunks(at.name, title);
      const chunk = note?.chunks.find(c => c.ord === at.ord);
      if (!note || !chunk) continue; // the note changed or went since it was indexed
      perNoteCount.set(at.name, (perNoteCount.get(at.name) ?? 0) + 1);
      results.push({
        name: at.name, title: note.title, headingPath: chunk.headingPath, text: chunk.text, ord: chunk.ord,
        score: f.score, lexicalRank: f.ranks[0], denseRank: usedDense ? f.ranks[1] : null,
        coverage: coverage.get(f.id) ?? 0, similarity: similarity.get(f.id) ?? null,
      });
    }
    return { chunks: results, mode: usedDense ? 'hybrid' : 'lexical' };
  }
}

export { DimensionMismatchError };
