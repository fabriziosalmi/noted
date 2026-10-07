import { describe, expect, it, vi } from 'vitest';
import { runEmbeddingSync, type SyncApi, type SyncProgress } from './embeddingSync';
import type { EmbeddingStatus, IpcResult } from '../../shared/search/embeddingTypes';

const MODEL = { provider: 'lmstudio', model: 'toy' };
const ok = <T,>(data: T): IpcResult<T> => ({ success: true, data });

/** A main process in miniature: a list of chunk hashes, the set that has vectors, a vector size. */
function fakeMain(hashes: string[], opts: { dimension?: number } = {}) {
  const stored = new Map<string, Float32Array>();
  let dimension = opts.dimension ?? 0;
  const status = (): EmbeddingStatus => ({ chunks: hashes.length, embedded: hashes.filter(h => stored.has(h)).length, dimension, capped: false });
  const calls = { pending: 0, put: [] as string[][], clear: 0 };
  const api: SyncApi = {
    embeddingsPending: vi.fn(async (_m, limit) => {
      calls.pending++;
      const missing = hashes.filter(h => !stored.has(h));
      return ok({ items: missing.slice(0, limit).map(hash => ({ hash, text: `text of ${hash}` })), remaining: missing.length, status: status() });
    }),
    embeddingsPut: vi.fn(async (_m, entries) => {
      if (dimension && entries.some(e => e.vector.length !== dimension)) return { success: false, error: 'dimension', mismatch: true } as IpcResult<number>;
      calls.put.push(entries.map(e => e.hash));
      for (const e of entries) { stored.set(e.hash, e.vector); dimension = e.vector.length; }
      return ok(entries.length);
    }),
    embeddingsClear: vi.fn(async () => { stored.clear(); dimension = 0; calls.clear++; return ok(true); }),
  };
  return { api, stored, calls, setDimension: (d: number) => { dimension = d; } };
}
const embedOf = (dim = 4) => vi.fn(async (texts: string[]) => texts.map((_, i) => new Float32Array(dim).fill(i + 1)));

describe('runEmbeddingSync', () => {
  it('embeds what has no vector, in batches, and reports progress', async () => {
    const main = fakeMain(['a', 'b', 'c', 'd', 'e']);
    const embed = embedOf();
    const seen: SyncProgress[] = [];
    const out = await runEmbeddingSync({ api: main.api, embed, model: MODEL, batch: 2, onProgress: p => seen.push(p) });
    expect(out).toMatchObject({ state: 'done', sent: 5, progress: { chunks: 5, embedded: 5 } });
    expect(main.calls.put).toEqual([['a', 'b'], ['c', 'd'], ['e']]);
    expect(embed.mock.calls.map(c => c[0].length)).toEqual([2, 2, 1]);
    expect(seen[0]).toEqual({ chunks: 5, embedded: 0, capped: false });
    expect(seen.map(p => p.embedded)).toEqual([...seen.map(p => p.embedded)].sort((x, y) => x - y)); // never goes back
    expect(seen[seen.length - 1].embedded).toBe(5);
  });

  it('with everything embedded it asks once and sends nothing', async () => {
    const main = fakeMain(['a', 'b']);
    await runEmbeddingSync({ api: main.api, embed: embedOf(), model: MODEL });
    const embed = embedOf();
    const out = await runEmbeddingSync({ api: main.api, embed, model: MODEL });
    expect(out).toMatchObject({ state: 'done', sent: 0 });
    expect(embed).not.toHaveBeenCalled();
    expect(main.calls.pending).toBe(2 + 1);
  });

  it('a chunk added later is the only one sent', async () => {
    const hashes = ['a', 'b'];
    const main = fakeMain(hashes);
    await runEmbeddingSync({ api: main.api, embed: embedOf(), model: MODEL });
    hashes.push('c');
    main.calls.put.length = 0;
    expect(await runEmbeddingSync({ api: main.api, embed: embedOf(), model: MODEL })).toMatchObject({ state: 'done', sent: 1 });
    expect(main.calls.put).toEqual([['c']]);
  });

  it('stops when told to, between batches, with what was done kept', async () => {
    const main = fakeMain(['a', 'b', 'c', 'd']);
    const controller = new AbortController();
    const embed = vi.fn(async (texts: string[]) => { controller.abort(); return texts.map(() => new Float32Array(2).fill(1)); });
    const out = await runEmbeddingSync({ api: main.api, embed, model: MODEL, batch: 2, signal: controller.signal });
    expect(out.state).toBe('stopped');
    expect(main.stored.size).toBe(0); // aborted while embedding: that batch is not stored
    const again = await runEmbeddingSync({ api: main.api, embed: embedOf(), model: MODEL, batch: 2 });
    expect(again).toMatchObject({ state: 'done', sent: 4 });
  });

  it('a provider failure ends the run with the message; vectors of earlier batches stay', async () => {
    const main = fakeMain(['a', 'b', 'c', 'd']);
    let n = 0;
    const embed = vi.fn(async (texts: string[]) => { if (++n === 2) throw new Error('rate limited'); return texts.map(() => new Float32Array(2).fill(1)); });
    const out = await runEmbeddingSync({ api: main.api, embed, model: MODEL, batch: 2 });
    expect(out).toMatchObject({ state: 'error', error: 'rate limited', sent: 2, progress: { chunks: 4, embedded: 2 } });
    expect(main.stored.size).toBe(2);
  });

  it('a provider that returns the wrong number of vectors is an error, and nothing is stored from it', async () => {
    const main = fakeMain(['a', 'b']);
    const out = await runEmbeddingSync({ api: main.api, embed: async () => [new Float32Array(2)], model: MODEL });
    expect(out).toMatchObject({ state: 'error' });
    expect(main.stored.size).toBe(0);
  });

  it('a model swapped under the same name (vectors of another size) clears the old vectors once and starts over', async () => {
    const main = fakeMain(['a', 'b', 'c'], { dimension: 8 });
    main.stored.set('a', new Float32Array(8));
    const out = await runEmbeddingSync({ api: main.api, embed: embedOf(4), model: MODEL, batch: 2 });
    expect(out).toMatchObject({ state: 'done', progress: { chunks: 3, embedded: 3 } });
    expect(main.calls.clear).toBe(1);
    expect([...main.stored.values()].every(v => v.length === 4)).toBe(true);
  });

  it('does not clear again if the mismatch comes back (a provider that answers with sizes that change)', async () => {
    const main = fakeMain(['a', 'b'], { dimension: 8 });
    (main.api.embeddingsPut as ReturnType<typeof vi.fn>).mockResolvedValue({ success: false, error: 'dimension', mismatch: true });
    const out = await runEmbeddingSync({ api: main.api, embed: embedOf(4), model: MODEL });
    expect(out).toMatchObject({ state: 'error', error: 'dimension' });
    expect(main.calls.clear).toBe(1);
  });

  it('an error from the main process is reported as it is', async () => {
    const api: SyncApi = { ...fakeMain([]).api, embeddingsPending: async () => ({ success: false, error: 'boom' }) };
    expect(await runEmbeddingSync({ api, embed: embedOf(), model: MODEL })).toMatchObject({ state: 'error', error: 'boom', sent: 0 });
  });

  it('a full store ends the run quietly, with the flag', async () => {
    const api: SyncApi = {
      ...fakeMain([]).api,
      embeddingsPending: async () => ok({ items: [], remaining: 0, status: { chunks: 9, embedded: 5, dimension: 4, capped: true } }),
    };
    expect(await runEmbeddingSync({ api, embed: embedOf(), model: MODEL })).toMatchObject({ state: 'done', progress: { chunks: 9, embedded: 5, capped: true } });
  });
});
