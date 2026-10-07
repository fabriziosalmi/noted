import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { retrieveChunks } from './ragSearch';
import { clearQueryCache } from './embeddings';

const original = window.electronAPI;
const ragSearch = vi.fn();
const llmFetch = vi.fn();
const chunk = { name: 'A.md', title: 'A', headingPath: ['H'], text: 't', ord: 0, score: 1, lexicalRank: 1, denseRank: null };
const on = { embeddingsEnabled: true, embeddingProvider: 'lmstudio', embeddingModel: 'toy', lmStudioUrl: 'http://localhost:1234/v1' };

beforeEach(() => {
  clearQueryCache();
  ragSearch.mockReset().mockResolvedValue({ success: true, data: { chunks: [chunk], mode: 'hybrid' } });
  llmFetch.mockReset().mockResolvedValue({ ok: true, status: 200, text: JSON.stringify({ data: [{ index: 0, embedding: [1, 2] }] }) });
  window.electronAPI = { ...original, ragSearch, llmFetch } as unknown as typeof window.electronAPI;
});
afterEach(() => { window.electronAPI = original; });

describe('retrieveChunks', () => {
  it('embeds the question and asks the main process with its vector and the model', async () => {
    const out = await retrieveChunks('what is due?', 6, { ...on, syncDirectory: '/vault', ragMaxNotes: 40 });
    expect(out).toEqual({ chunks: [chunk], mode: 'hybrid' });
    expect(ragSearch).toHaveBeenCalledWith('what is due?', expect.any(Float32Array), 6, { provider: 'lmstudio', model: 'toy' }, '/vault', 40);
    expect(Array.from(ragSearch.mock.calls[0][1] as Float32Array)).toEqual([1, 2]);
  });

  it('with embeddings off, it asks for the words alone and calls no provider', async () => {
    await retrieveChunks('q', 4, { embeddingsEnabled: false });
    expect(llmFetch).not.toHaveBeenCalled();
    expect(ragSearch).toHaveBeenCalledWith('q', null, 4, { provider: 'none', model: 'none' }, undefined, undefined);
  });

  it('if embedding the question fails, the words alone answer; it is not an error', async () => {
    llmFetch.mockResolvedValue({ ok: false, status: 500, text: 'down' });
    vi.useFakeTimers();
    try {
      const p = retrieveChunks('q', 4, on);
      await vi.advanceTimersByTimeAsync(2000);
      await p;
    } finally { vi.useRealTimers(); }
    expect(ragSearch).toHaveBeenCalledWith('q', null, 4, { provider: 'lmstudio', model: 'toy' }, undefined, undefined);
  });

  it('gives nothing, without asking, for an empty question; and nothing when the main process fails', async () => {
    expect((await retrieveChunks('  ', 4, on)).chunks).toEqual([]);
    expect(ragSearch).not.toHaveBeenCalled();
    ragSearch.mockResolvedValueOnce({ success: false, error: 'x' });
    expect((await retrieveChunks('q', 4, { embeddingsEnabled: false })).chunks).toEqual([]);
  });
});
