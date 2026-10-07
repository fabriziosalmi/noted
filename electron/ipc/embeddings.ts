import { ipcMain } from 'electron';
import { validateFileName } from '../ipc-utils';
import { getTargetDir } from '../core/paths';
import { embeddingService } from '../core/services';
import { DimensionMismatchError } from '../embedding-store';
import type { ModelRef } from '../embeddings';

// What the renderer asks of the vault's embeddings: see embeddings.ts for who does what. Inputs are checked here, at the edge.
const MAX_BATCH = 256;
const MAX_DIMENSIONS = 8192;
const HASH = /^[0-9a-f]{32}$/;

function parseModel(value: unknown): ModelRef {
  const m = value as { provider?: unknown; model?: unknown } | null;
  if (!m || typeof m.provider !== 'string' || typeof m.model !== 'string' || !m.provider || !m.model || m.provider.length > 40 || m.model.length > 200) {
    throw new Error('Invalid embedding model');
  }
  return { provider: m.provider, model: m.model };
}

function parseVector(value: unknown): Float32Array {
  if (!(Array.isArray(value) || ArrayBuffer.isView(value)) || (value as ArrayLike<number>).length === 0 || (value as ArrayLike<number>).length > MAX_DIMENSIONS) throw new Error('Invalid vector');
  const v = Float32Array.from(value as ArrayLike<number>);
  for (const x of v) if (!Number.isFinite(x)) throw new Error('Invalid vector');
  return v;
}

const reply = async <T>(fn: () => Promise<T> | T): Promise<{ success: true; data: T } | { success: false; error: string; mismatch?: boolean }> => {
  try { return { success: true, data: await fn() }; } catch (err) {
    return { success: false, error: (err as Error).message, ...(err instanceof DimensionMismatchError ? { mismatch: true } : {}) };
  }
};

export function registerEmbeddingHandlers(): void {
  const validate = (name: string) => validateFileName(name);

  ipcMain.handle('embeddings-status', (_, model: unknown, syncDir?: string) =>
    reply(() => embeddingService.status(getTargetDir(syncDir), parseModel(model), validate)));

  ipcMain.handle('embeddings-pending', (_, model: unknown, limit: unknown, syncDir?: string) =>
    reply(() => embeddingService.pending(getTargetDir(syncDir), parseModel(model), typeof limit === 'number' && Number.isFinite(limit) ? limit : 32, validate)));

  ipcMain.handle('embeddings-put', (_, model: unknown, entries: unknown, syncDir?: string) =>
    reply(() => {
      if (!Array.isArray(entries) || entries.length > MAX_BATCH) throw new Error('Invalid batch');
      const parsed = entries.map((e: { hash?: unknown; vector?: unknown }) => {
        if (typeof e?.hash !== 'string' || !HASH.test(e.hash)) throw new Error('Invalid chunk hash');
        return { hash: e.hash, vector: parseVector(e.vector) };
      });
      return embeddingService.put(getTargetDir(syncDir), parseModel(model), parsed);
    }));

  ipcMain.handle('embeddings-clear', (_, model: unknown, syncDir?: string) =>
    reply(() => { embeddingService.clear(getTargetDir(syncDir), parseModel(model)); return true; }));

  ipcMain.handle('rag-search', (_, query: unknown, vector: unknown, topK: unknown, model: unknown, syncDir?: string, pool?: unknown) =>
    reply(() => {
      if (typeof query !== 'string' || query.length > 4000) throw new Error('Invalid query');
      const k = typeof topK === 'number' && Number.isFinite(topK) ? topK : 8;
      return embeddingService.search(getTargetDir(syncDir), parseModel(model), query, vector == null ? null : parseVector(vector), k, validate,
        { pool: typeof pool === 'number' && Number.isFinite(pool) ? pool : undefined });
    }));
}
