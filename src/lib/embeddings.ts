// Embedding text with the user's provider, in batches. The vault's chunks are embedded here (the main process decides which,
// and keeps the vectors: see electron/embeddings.ts), and so is each question put to the chat.

import { getElectronApi } from './electronApi';
import { maskPii } from './piiMasker';
import type { EmbeddingModelRef } from '../../shared/search/embeddingTypes';

export type EmbeddingProvider = 'openai' | 'lmstudio' | 'ollama';

export interface EmbeddingConfig extends EmbeddingModelRef {
  provider: EmbeddingProvider;
  apiKey?: string;
  lmStudioUrl?: string;
  /** Mask personal data before text leaves the machine for a cloud provider (on unless turned off). */
  maskPii?: boolean;
}

/** Texts per request. OpenAI takes up to 2048 inputs, local servers fewer in practice; this suits all of them. */
export const EMBED_BATCH = 32;

/** The model the settings ask for, or null while embeddings are off or not yet configured. */
export function embeddingConfigOf(s: {
  embeddingsEnabled?: boolean; embeddingProvider?: string; embeddingModel?: string; llmApiKey?: string; lmStudioUrl?: string; piiMasking?: boolean;
}): EmbeddingConfig | null {
  const provider = s.embeddingProvider;
  if (!s.embeddingsEnabled || (provider !== 'openai' && provider !== 'lmstudio' && provider !== 'ollama')) return null;
  const model = (s.embeddingModel ?? '').trim();
  if (!model) return null;
  if (provider === 'openai' && !s.llmApiKey) return null;
  return { provider, model, apiKey: s.llmApiKey, lmStudioUrl: s.lmStudioUrl, maskPii: s.piiMasking !== false };
}

/** localhost, loopback, or a name only this machine or the LAN resolves. */
function isLocalHost(hostPart: string): boolean {
  const host = hostPart.split('/')[0].split(':')[0].toLowerCase();
  return host === 'localhost' || host === '0.0.0.0' || host === '[::1]' || host === '::1'
    || /^127\./.test(host) || host.endsWith('.local') || host.endsWith('.localhost');
}

function baseUrl(url: string | undefined): string {
  const trimmed = (url ?? '').trim().replace(/\/+$/, '');
  if (!trimmed) return 'http://localhost:1234/v1';
  if (/^https?:\/\//i.test(trimmed)) return trimmed;
  // A local model server speaks plain HTTP; anything reached over a network is not downgraded because the scheme was left out.
  return `${isLocalHost(trimmed) ? 'http' : 'https'}://${trimmed}`;
}

interface Reply { ok: boolean; status: number; text: string }

async function post(url: string, headers: Record<string, string>, body: unknown): Promise<Reply> {
  const init = { method: 'POST', headers: { 'Content-Type': 'application/json', ...headers }, body: JSON.stringify(body) };
  const api = getElectronApi();
  if (api?.llmFetch) return api.llmFetch(url, init);
  const res = await fetch(url, init);
  return { ok: res.ok, status: res.status, text: await res.text() };
}

/** LM Studio and Ollama load an embedding model on the first request and answer 5xx until it is in memory: one more try after a pause. */
async function postLocal(url: string, body: unknown): Promise<Reply> {
  const res = await post(url, {}, body);
  if (res.ok || res.status < 500) return res;
  await new Promise(resolve => setTimeout(resolve, 1500));
  return post(url, {}, body);
}

export class EmbeddingHttpError extends Error {
  status: number;
  constructor(provider: string, status: number, body: string) {
    super(`${provider} embeddings HTTP ${status}${body ? `: ${body.slice(0, 160)}` : ''}`);
    this.name = 'EmbeddingHttpError';
    this.status = status;
  }
}

function parseOpenAiShape(res: Reply, provider: string, expected: number): Float32Array[] {
  if (!res.ok) throw new EmbeddingHttpError(provider, res.status, res.text);
  const data = (JSON.parse(res.text) as { data?: { index?: number; embedding?: number[] }[] }).data ?? [];
  const sorted = [...data].sort((a, b) => (a.index ?? 0) - (b.index ?? 0));
  if (sorted.length !== expected || sorted.some(d => !d.embedding || d.embedding.length === 0)) throw new Error(`${provider} returned ${sorted.length} embeddings for ${expected} texts`);
  return sorted.map(d => Float32Array.from(d.embedding as number[]));
}

/** One request for up to EMBED_BATCH texts; the vectors come back in the order of the texts. */
export async function embedTexts(cfg: EmbeddingConfig, texts: readonly string[]): Promise<Float32Array[]> {
  if (texts.length === 0) return [];
  if (cfg.provider === 'openai') {
    if (!cfg.apiKey) throw new Error('OpenAI API key missing');
    const input = cfg.maskPii === false ? [...texts] : texts.map(t => maskPii(t).maskedText);
    const res = await post('https://api.openai.com/v1/embeddings', { Authorization: `Bearer ${cfg.apiKey}` }, { model: cfg.model, input });
    return parseOpenAiShape(res, 'OpenAI', texts.length);
  }
  if (cfg.provider === 'lmstudio') {
    const res = await postLocal(`${baseUrl(cfg.lmStudioUrl)}/embeddings`, { model: cfg.model, input: [...texts] });
    return parseOpenAiShape(res, 'LM Studio', texts.length);
  }
  const res = await postLocal('http://localhost:11434/api/embed', { model: cfg.model, input: [...texts] });
  if (res.ok) {
    const embeddings = (JSON.parse(res.text) as { embeddings?: number[][] }).embeddings ?? [];
    if (embeddings.length !== texts.length || embeddings.some(e => e.length === 0)) throw new Error(`Ollama returned ${embeddings.length} embeddings for ${texts.length} texts`);
    return embeddings.map(e => Float32Array.from(e));
  }
  if (res.status !== 404 && res.status !== 405) throw new EmbeddingHttpError('Ollama', res.status, res.text);
  // An Ollama older than /api/embed: one text per request.
  const out: Float32Array[] = [];
  for (const prompt of texts) {
    const one = await postLocal('http://localhost:11434/api/embeddings', { model: cfg.model, prompt });
    if (!one.ok) throw new EmbeddingHttpError('Ollama', one.status, one.text);
    const emb = (JSON.parse(one.text) as { embedding?: number[] }).embedding;
    if (!emb || emb.length === 0) throw new Error('Empty Ollama embedding');
    out.push(Float32Array.from(emb));
  }
  return out;
}

const queryCache = new Map<string, Float32Array>();
const MAX_CACHED_QUERIES = 200;

/** The vector of a question, remembered for the session (asking again, or the same question to retry, costs nothing). */
export async function embedQuery(cfg: EmbeddingConfig, query: string): Promise<Float32Array> {
  const key = `${cfg.provider}\0${cfg.model}\0${query}`;
  const hit = queryCache.get(key);
  if (hit) return hit;
  const [vector] = await embedTexts(cfg, [query]);
  queryCache.set(key, vector);
  while (queryCache.size > MAX_CACHED_QUERIES) queryCache.delete(queryCache.keys().next().value as string);
  return vector;
}

export function clearQueryCache(): void { queryCache.clear(); }
