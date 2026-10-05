import { describe, it, expect, vi, afterEach } from 'vitest';
import { fetchRetrievalCandidates, candidatePoolSize, DEFAULT_CANDIDATE_POOL } from './ragRetrieval';

const original = window.electronAPI;
afterEach(() => { window.electronAPI = original; });
const withApi = (ragCandidates: unknown) => { window.electronAPI = { ...original, ragCandidates } as unknown as typeof window.electronAPI; };

describe('candidatePoolSize', () => {
  it('defaults, rounds and clamps to a range that is cheap to re-rank', () => {
    expect(candidatePoolSize(undefined)).toBe(DEFAULT_CANDIDATE_POOL);
    expect(candidatePoolSize(NaN)).toBe(DEFAULT_CANDIDATE_POOL);
    expect(candidatePoolSize(12.6)).toBe(13);
    expect(candidatePoolSize(1)).toBe(5);
    expect(candidatePoolSize(500)).toBe(100);
  });
});

describe('fetchRetrievalCandidates', () => {
  it('asks the main process for the question\'s candidates and maps them to chunks', async () => {
    const rag = vi.fn().mockResolvedValue({ success: true, data: { candidates: [{ name: 'a.md', title: 'a', text: 'alpha', score: 2 }, { name: 'b.md', title: 'b', text: 'beta', score: 1 }], truncated: false, indexed: 900 } });
    withApi(rag);
    expect(await fetchRetrievalCandidates('what is alpha', 40, '/vault')).toEqual([{ name: 'a.md', text: 'alpha' }, { name: 'b.md', text: 'beta' }]);
    expect(rag).toHaveBeenCalledWith('what is alpha', 40, '/vault');
  });

  it('is empty for a blank question, a failed call, or no backend — never throws on those', async () => {
    const rag = vi.fn().mockResolvedValue({ success: false, error: 'nope' });
    withApi(rag);
    expect(await fetchRetrievalCandidates('   ', 30, undefined)).toEqual([]);
    expect(rag).not.toHaveBeenCalled();
    expect(await fetchRetrievalCandidates('q', 30, undefined)).toEqual([]);
    window.electronAPI = { ...original, ragCandidates: undefined } as unknown as typeof window.electronAPI;
    expect(await fetchRetrievalCandidates('q', 30, undefined)).toEqual([]);
  });

  it('clamps the pool it asks for', async () => {
    const rag = vi.fn().mockResolvedValue({ success: true, data: { candidates: [], truncated: false, indexed: 0 } });
    withApi(rag);
    await fetchRetrievalCandidates('q', 100000, undefined);
    expect(rag.mock.calls[0][1]).toBe(100);
  });
});
