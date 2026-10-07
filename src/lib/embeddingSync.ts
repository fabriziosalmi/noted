// Keeping the vault's vectors up to date: ask the main process which chunks have none, embed them with the user's provider in
// batches, hand the vectors back. It is the same loop after the first run as before it: what is unchanged is never asked for.

import type { EmbeddingModelRef, EmbeddingStatus, IpcResult } from '../../shared/search/embeddingTypes';

export interface SyncApi {
  embeddingsPending: (model: EmbeddingModelRef, limit: number, syncDir?: string) => Promise<IpcResult<{ items: { hash: string; text: string }[]; remaining: number; status: EmbeddingStatus }>>;
  embeddingsPut: (model: EmbeddingModelRef, entries: { hash: string; vector: Float32Array }[], syncDir?: string) => Promise<IpcResult<number>>;
  embeddingsClear: (model: EmbeddingModelRef, syncDir?: string) => Promise<IpcResult<boolean>>;
}

export interface SyncProgress { chunks: number; embedded: number; capped: boolean }

export type SyncOutcome =
  | { state: 'done'; progress: SyncProgress; sent: number }
  | { state: 'stopped'; progress: SyncProgress; sent: number }
  | { state: 'error'; progress: SyncProgress; sent: number; error: string };

export interface SyncOptions {
  api: SyncApi;
  /** Embeds a batch of texts; the vectors come back in the same order. */
  embed: (texts: string[]) => Promise<Float32Array[]>;
  model: EmbeddingModelRef;
  syncDir?: string;
  signal?: AbortSignal;
  onProgress?: (progress: SyncProgress) => void;
  batch?: number;
}

const EMPTY: SyncProgress = { chunks: 0, embedded: 0, capped: false };

export async function runEmbeddingSync(opts: SyncOptions): Promise<SyncOutcome> {
  const { api, embed, model, syncDir, signal, onProgress } = opts;
  const batch = opts.batch ?? 32;
  let progress = EMPTY;
  let sent = 0;
  let restarted = false;
  const fail = (error: string): SyncOutcome => ({ state: 'error', progress, sent, error });

  for (;;) {
    if (signal?.aborted) return { state: 'stopped', progress, sent };
    const next = await api.embeddingsPending(model, batch, syncDir);
    if (!next.success) return fail(next.error);
    const { items, status } = next.data;
    progress = { chunks: status.chunks, embedded: status.embedded, capped: status.capped };
    onProgress?.(progress);
    if (items.length === 0) {
      // Nothing to offer: either all is embedded, or the store is full, or the only chunks left changed under us (the next run has them).
      return { state: 'done', progress, sent };
    }

    let vectors: Float32Array[];
    try {
      vectors = await embed(items.map(i => i.text));
    } catch (err) {
      if (signal?.aborted) return { state: 'stopped', progress, sent };
      return fail((err as Error).message);
    }
    if (vectors.length !== items.length) return fail(`the provider returned ${vectors.length} vectors for ${items.length} texts`);
    if (signal?.aborted) return { state: 'stopped', progress, sent };

    const put = await api.embeddingsPut(model, items.map((item, i) => ({ hash: item.hash, vector: vectors[i] })), syncDir);
    if (!put.success) {
      // The model of that name now produces vectors of another size (it was swapped under the same name): what is stored cannot be used.
      if (put.mismatch && !restarted) {
        restarted = true;
        const cleared = await api.embeddingsClear(model, syncDir);
        if (!cleared.success) return fail(cleared.error);
        progress = { ...progress, embedded: 0 };
        continue;
      }
      return fail(put.error);
    }
    sent += items.length;
    progress = { chunks: status.chunks, embedded: status.embedded + items.length, capped: status.capped };
    onProgress?.(progress);
  }
}

const SYNC_REQUEST = 'noted-embedding-sync';

/** Asks the running app to look for chunks without vectors now (after the index was thrown away, say). */
export function requestEmbeddingSync(): void { window.dispatchEvent(new Event(SYNC_REQUEST)); }
export const EMBEDDING_SYNC_EVENT = SYNC_REQUEST;
