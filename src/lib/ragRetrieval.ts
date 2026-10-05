import { getElectronApi } from './electronApi';
import type { NoteChunk } from './noteSearch';

export const DEFAULT_CANDIDATE_POOL = 30;

/** Pool size from the setting: whole numbers, kept to a range that is cheap to re-rank. */
export function candidatePoolSize(setting: number | undefined): number {
  const n = typeof setting === 'number' && Number.isFinite(setting) ? Math.round(setting) : DEFAULT_CANDIDATE_POOL;
  return Math.max(5, Math.min(100, n));
}

/**
 * The candidate notes for a question, from the main process's index of the whole
 * vault. Nothing is read from disk here: the vault was indexed once, and the
 * index is kept current, so opening the chat panel costs nothing and a question
 * costs one IPC call. The caller re-ranks these few (lexical and, if enabled,
 * dense) — never the whole vault.
 */
export async function fetchRetrievalCandidates(query: string, pool: number | undefined, syncDir: string | undefined): Promise<NoteChunk[]> {
  const api = getElectronApi();
  if (!api?.ragCandidates || !query.trim()) return [];
  const res = await api.ragCandidates(query, candidatePoolSize(pool), syncDir);
  if (!res.success || !res.data) return [];
  return res.data.candidates.map(c => ({ name: c.name, text: c.text }));
}
