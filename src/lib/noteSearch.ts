// Hybrid retrieval for RAG:
// - lexical TF-IDF (always available, local, deterministic)
// - optional dense embeddings (when enabled/configured)
import { getElectronApi } from './electronApi';

const STOPWORDS = new Set([
  'the', 'and', 'for', 'are', 'but', 'not', 'you', 'all', 'can', 'had', 'her', 'was', 'one', 'our',
  'out', 'day', 'get', 'has', 'him', 'his', 'how', 'its', 'may', 'new', 'now', 'old', 'see', 'two',
  'use', 'way', 'who', 'boy', 'did', 'she', 'too', 'from', 'that', 'this', 'with', 'have', 'will',
  'your', 'they', 'them', 'then', 'than', 'when', 'been', 'were', 'said', 'each', 'what', 'which',
  'their', 'there', 'about', 'would', 'these', 'other', 'into', 'more', 'also', 'some', 'time',
  'per', 'che', 'con', 'del', 'nel', 'sul', 'dal', 'alla', 'delle', 'degli', 'nella', 'dello',
  'nei', 'sui', 'dai', 'agli', 'sulle', 'nelle', 'dai', 'agli', 'tra', 'fra', 'come', 'sono',
  'una', 'uno', 'non', 'una', 'gli', 'lei', 'lui', 'loro', 'anche', 'dopo', 'prima', 'tutto',
  'tutti', 'tutte', 'ogni', 'così', 'dove', 'quando', 'quale', 'quali', 'questo', 'questa',
  'questi', 'queste', 'quello', 'quella', 'quelli', 'quelle', 'molto', 'poco', 'mai', 'già',
  'ancora', 'sempre', 'solo', 'sia', 'essere', 'avere', 'fare', 'dire', 'andare', 'venire',
]);

export interface NoteChunk {
  name: string;
  text: string;
}

export interface HybridRetrievalConfig {
  enabled: boolean;
  provider: 'openai' | 'lmstudio' | 'ollama' | 'none';
  model: string;
  apiKey?: string;
  lmStudioUrl?: string;
}

export interface RetrievalScoredNote {
  note: NoteChunk;
  lexical: number;
  dense: number;
  combined: number;
}

export interface HybridRetrievalResult {
  notes: NoteChunk[];
  mode: 'lexical' | 'hybrid';
  scored: RetrievalScoredNote[];
}

function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[^a-zàáèéìíòóùú0-9\s]/g, ' ')
    .split(/\s+/)
    .filter((t) => t.length > 2 && !STOPWORDS.has(t));
}

function termFreq(tokens: string[]): Map<string, number> {
  const freq = new Map<string, number>();
  for (const t of tokens) freq.set(t, (freq.get(t) ?? 0) + 1);
  return freq;
}

function buildIdf(notes: NoteChunk[]): Map<string, number> {
  const df = new Map<string, number>();
  const n = notes.length;
  for (const note of notes) {
    const seen = new Set(tokenize(note.text));
    for (const term of seen) df.set(term, (df.get(term) ?? 0) + 1);
  }
  const idf = new Map<string, number>();
  for (const [term, count] of df) idf.set(term, Math.log((n + 1) / (count + 1)) + 1);
  return idf;
}

function tfidfVector(tokens: string[], idf: Map<string, number>): Map<string, number> {
  const tf = termFreq(tokens);
  const vec = new Map<string, number>();
  for (const [term, freq] of tf) vec.set(term, freq * (idf.get(term) ?? 1));
  return vec;
}

function cosineSimilaritySparse(a: Map<string, number>, b: Map<string, number>): number {
  let dot = 0;
  let normA = 0;
  let normB = 0;
  for (const [term, fa] of a) {
    dot += fa * (b.get(term) ?? 0);
    normA += fa * fa;
  }
  for (const fb of b.values()) normB += fb * fb;
  return normA === 0 || normB === 0 ? 0 : dot / (Math.sqrt(normA) * Math.sqrt(normB));
}

function cosineSimilarityDense(a: number[], b: number[]): number {
  if (a.length === 0 || b.length === 0 || a.length !== b.length) return 0;
  let dot = 0;
  let normA = 0;
  let normB = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }
  return normA === 0 || normB === 0 ? 0 : dot / (Math.sqrt(normA) * Math.sqrt(normB));
}

function normalizeBaseUrl(url: string): string {
  const trimmed = url.trim().replace(/\/+$/, '');
  if (!trimmed) return 'http://localhost:1234/v1';
  return /^https?:\/\//i.test(trimmed) ? trimmed : `http://${trimmed}`;
}

function quickHash(text: string): string {
  let h = 2166136261;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return (h >>> 0).toString(16);
}

const embeddingCache = new Map<string, number[]>();
const noteEmbeddingKeyIndex = new Map<string, string>();

async function transportFetch(url: string, init: { method: string; headers: Record<string, string>; body: string }): Promise<{ ok: boolean; status: number; text: string; }> {
  const api = getElectronApi();
  if (api?.llmFetch) {
    const res = await api.llmFetch(url, init);
    return { ok: res.ok, status: res.status, text: res.text };
  }
  const res = await fetch(url, init);
  return { ok: res.ok, status: res.status, text: await res.text() };
}

async function fetchEmbedding(provider: HybridRetrievalConfig['provider'], model: string, input: string, apiKey?: string, lmStudioUrl?: string): Promise<number[]> {
  if (provider === 'none' || !model.trim()) throw new Error('Embeddings not configured');

  if (provider === 'openai') {
    if (!apiKey) throw new Error('OpenAI API key missing');
    const res = await transportFetch('https://api.openai.com/v1/embeddings', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
      body: JSON.stringify({ model, input }),
    });
    if (!res.ok) throw new Error(`OpenAI embeddings HTTP ${res.status}`);
    const data = JSON.parse(res.text) as { data?: { embedding?: number[] }[] };
    const emb = data.data?.[0]?.embedding;
    if (!emb || emb.length === 0) throw new Error('Empty OpenAI embedding');
    return emb;
  }

  if (provider === 'lmstudio') {
    const base = normalizeBaseUrl(lmStudioUrl ?? '');
    const res = await transportFetch(`${base}/embeddings`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ model, input }),
    });
    if (!res.ok) throw new Error(`LM Studio embeddings HTTP ${res.status}`);
    const data = JSON.parse(res.text) as { data?: { embedding?: number[] }[] };
    const emb = data.data?.[0]?.embedding;
    if (!emb || emb.length === 0) throw new Error('Empty LM Studio embedding');
    return emb;
  }

  const res = await transportFetch('http://localhost:11434/api/embeddings', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ model, prompt: input }),
  });
  if (!res.ok) throw new Error(`Ollama embeddings HTTP ${res.status}`);
  const data = JSON.parse(res.text) as { embedding?: number[] };
  if (!data.embedding || data.embedding.length === 0) throw new Error('Empty Ollama embedding');
  return data.embedding;
}

function lexicalRank(query: string, notes: NoteChunk[]): { note: NoteChunk; score: number }[] {
  const qTokens = tokenize(query);
  if (qTokens.length === 0) return notes.map((note) => ({ note, score: 0 }));

  const idf = buildIdf(notes);
  const qVec = tfidfVector(qTokens, idf);

  return notes.map((note) => {
    const nVec = tfidfVector(tokenize(note.text), idf);
    return { note, score: cosineSimilaritySparse(qVec, nVec) };
  });
}

export function findRelevantNotes(query: string, notes: NoteChunk[], topK = 3): NoteChunk[] {
  if (notes.length === 0) return [];
  const ranked = lexicalRank(query, notes)
    .sort((a, b) => b.score - a.score)
    .slice(0, topK)
    .filter((s) => s.score > 0)
    .map((s) => s.note);
  return ranked.length > 0 ? ranked : notes.slice(0, topK);
}

export async function findRelevantNotesHybrid(
  query: string,
  notes: NoteChunk[],
  topK: number,
  cfg: HybridRetrievalConfig,
): Promise<HybridRetrievalResult> {
  if (notes.length === 0) return { notes: [], mode: 'lexical', scored: [] };

  const lexical = lexicalRank(query, notes);
  if (!cfg.enabled || cfg.provider === 'none' || !cfg.model.trim()) {
    const scored = lexical
      .map((row) => ({ note: row.note, lexical: row.score, dense: 0, combined: row.score }))
      .sort((a, b) => b.combined - a.combined)
      .slice(0, topK);
    const picked = scored.filter((s) => s.combined > 0).map((s) => s.note);
    return { notes: picked.length > 0 ? picked : notes.slice(0, topK), mode: 'lexical', scored };
  }

  try {
    const queryKey = `q:${cfg.provider}:${cfg.model}:${quickHash(query)}`;
    let queryEmb = embeddingCache.get(queryKey);
    if (!queryEmb) {
      queryEmb = await fetchEmbedding(cfg.provider, cfg.model, query, cfg.apiKey, cfg.lmStudioUrl);
      embeddingCache.set(queryKey, queryEmb);
    }

    const denseScores = await Promise.all(notes.map(async (note) => {
      const nKey = `n:${cfg.provider}:${cfg.model}:${note.name}:${quickHash(note.text)}`;
      const noteIndexKey = `${cfg.provider}:${cfg.model}:${note.name}`;
      const prevKey = noteEmbeddingKeyIndex.get(noteIndexKey);
      if (prevKey && prevKey !== nKey) embeddingCache.delete(prevKey);
      noteEmbeddingKeyIndex.set(noteIndexKey, nKey);
      let emb = embeddingCache.get(nKey);
      if (!emb) {
        emb = await fetchEmbedding(cfg.provider, cfg.model, note.text.slice(0, 2400), cfg.apiKey, cfg.lmStudioUrl);
        embeddingCache.set(nKey, emb);
      }
      return { name: note.name, dense: cosineSimilarityDense(queryEmb, emb) };
    }));
    const denseMap = new Map(denseScores.map((s) => [s.name, s.dense]));

    const combined = lexical
      .map((row) => ({
        note: row.note,
        lexical: row.score,
        dense: denseMap.get(row.note.name) ?? 0,
        combined: row.score * 0.45 + (denseMap.get(row.note.name) ?? 0) * 0.55,
      }))
      .sort((a, b) => b.combined - a.combined)
      .slice(0, topK)
      .filter((s) => s.combined > 0);

    return {
      notes: combined.length > 0 ? combined.map((s) => s.note) : findRelevantNotes(query, notes, topK),
      mode: 'hybrid',
      scored: combined,
    };
  } catch {
    const scored = lexical
      .map((row) => ({ note: row.note, lexical: row.score, dense: 0, combined: row.score }))
      .sort((a, b) => b.combined - a.combined)
      .slice(0, topK);
    return { notes: findRelevantNotes(query, notes, topK), mode: 'lexical', scored };
  }
}
