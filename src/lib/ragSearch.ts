import { getElectronApi } from './electronApi';
import { embeddingConfigOf, embedQuery } from './embeddings';
import type { RagChunk } from '../../shared/search/embeddingTypes';

export interface RagResult { chunks: RagChunk[]; mode: 'hybrid' | 'lexical' }

/** The "model" asked of the main process when there is none to ask for: the words alone are used. */
const NO_MODEL = { provider: 'none', model: 'none' };

export const EMPTY_RAG: RagResult = { chunks: [], mode: 'lexical' };

/**
 * The sections of the vault that best answer a question. With embeddings set up the question is embedded and meaning takes
 * part; if that fails (provider down, no vectors yet) it is the words alone, never an error: the chat answers either way.
 */
export async function retrieveChunks(
  query: string,
  topK: number,
  settings: Parameters<typeof embeddingConfigOf>[0] & { syncDirectory?: string | null; ragMaxNotes?: number },
): Promise<RagResult> {
  const api = getElectronApi();
  if (!api?.ragSearch || !query.trim()) return EMPTY_RAG;
  const cfg = embeddingConfigOf(settings);
  let vector: Float32Array | null = null;
  if (cfg) { try { vector = await embedQuery(cfg, query); } catch { vector = null; } }
  const model = cfg ? { provider: cfg.provider, model: cfg.model } : NO_MODEL;
  const res = await api.ragSearch(query, vector, topK, model, settings.syncDirectory || undefined, settings.ragMaxNotes);
  return res.success ? res.data : EMPTY_RAG;
}
