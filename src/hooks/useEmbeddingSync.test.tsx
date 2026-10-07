import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, renderHook, waitFor } from '@testing-library/react';
import { useEmbeddingSync } from './useEmbeddingSync';
import { useStore } from '../store/useStore';

const original = window.electronAPI;
const llmFetch = vi.fn();
let pending: ReturnType<typeof vi.fn>;
let put: ReturnType<typeof vi.fn>;
let stored: Set<string>;
const ALL = ['a'.repeat(32), 'b'.repeat(32), 'c'.repeat(32)];
const status = () => ({ chunks: ALL.length, embedded: ALL.filter(h => stored.has(h)).length, dimension: 2, capped: false });

const settingsOf = (over: Record<string, unknown> = {}) => ({
  ...useStore.getState().settings, embeddingsEnabled: true, embeddingProvider: 'lmstudio', embeddingModel: 'toy', lmStudioUrl: 'http://localhost:1234/v1', syncDirectory: '', ...over,
});

beforeEach(() => {
  stored = new Set();
  pending = vi.fn(async (_m: unknown, limit: number) => {
    const missing = ALL.filter(h => !stored.has(h));
    return { success: true, data: { items: missing.slice(0, limit).map(hash => ({ hash, text: `t ${hash}` })), remaining: missing.length, status: status() } };
  });
  put = vi.fn(async (_m: unknown, entries: { hash: string }[]) => { entries.forEach(e => stored.add(e.hash)); return { success: true, data: entries.length }; });
  llmFetch.mockReset().mockImplementation(async (_url: string, init: { body: string }) => {
    const input = (JSON.parse(init.body) as { input: string[] }).input;
    return { ok: true, status: 200, text: JSON.stringify({ data: input.map((_, index) => ({ index, embedding: [1, 2] })) }) };
  });
  window.electronAPI = { ...original, llmFetch, embeddingsPending: pending, embeddingsPut: put, embeddingsClear: vi.fn() } as unknown as typeof window.electronAPI;
  useStore.setState({ settings: settingsOf(), notes: [], embeddingProgress: { state: 'off', chunks: 0, embedded: 0, capped: false } });
});
afterEach(() => { window.electronAPI = original; vi.useRealTimers(); });

describe('useEmbeddingSync', () => {
  it('does nothing while embeddings are off or not configured', async () => {
    useStore.setState({ settings: settingsOf({ embeddingsEnabled: false }) });
    renderHook(() => useEmbeddingSync());
    await new Promise(r => setTimeout(r, 20));
    expect(pending).not.toHaveBeenCalled();
    expect(useStore.getState().embeddingProgress.state).toBe('off');
    useStore.setState({ settings: settingsOf({ embeddingModel: '' }) });
    await new Promise(r => setTimeout(r, 20));
    expect(pending).not.toHaveBeenCalled();
  });

  it('embeds the vault when switched on, and shows how far it got', async () => {
    renderHook(() => useEmbeddingSync());
    await waitFor(() => expect(useStore.getState().embeddingProgress).toMatchObject({ state: 'idle', chunks: 3, embedded: 3 }));
    expect(stored.size).toBe(3);
    expect(llmFetch).toHaveBeenCalledTimes(1); // the three chunks went in one batch
  });

  it('switching the model starts a run for the new one; switching off stops and shows off', async () => {
    renderHook(() => useEmbeddingSync());
    await waitFor(() => expect(useStore.getState().embeddingProgress.state).toBe('idle'));
    stored.clear();
    act(() => { useStore.setState({ settings: settingsOf({ embeddingModel: 'other' }) }); });
    await waitFor(() => expect(pending.mock.calls.some(c => (c[0] as { model: string }).model === 'other')).toBe(true));
    await waitFor(() => expect(useStore.getState().embeddingProgress.state).toBe('idle'));
    act(() => { useStore.setState({ settings: settingsOf({ embeddingsEnabled: false }) }); });
    expect(useStore.getState().embeddingProgress.state).toBe('off');
  });

  it('shows a provider failure, and the next run (a timer here) tries again and recovers', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    llmFetch.mockResolvedValueOnce({ ok: false, status: 401, text: 'bad key' });
    renderHook(() => useEmbeddingSync());
    await waitFor(() => expect(useStore.getState().embeddingProgress.state).toBe('error'));
    expect(useStore.getState().embeddingProgress.error).toMatch(/401/);
    await act(async () => { await vi.advanceTimersByTimeAsync(2 * 60_000 + 100); });
    await waitFor(() => expect(useStore.getState().embeddingProgress).toMatchObject({ state: 'idle', embedded: 3 }));
  });

  it('a change in the notes triggers a run after a few seconds, and a burst of changes one run', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    renderHook(() => useEmbeddingSync());
    await waitFor(() => expect(useStore.getState().embeddingProgress.state).toBe('idle'));
    const before = pending.mock.calls.length;
    act(() => { useStore.setState({ notes: [{ name: 'a.md', path: 'a.md', stats: { mtimeMs: 1, ctimeMs: 1, size: 1 } }] }); });
    act(() => { useStore.setState({ notes: [{ name: 'b.md', path: 'b.md', stats: { mtimeMs: 2, ctimeMs: 2, size: 1 } }] }); });
    await act(async () => { await vi.advanceTimersByTimeAsync(1_000); });
    expect(pending.mock.calls.length).toBe(before); // not yet: it waits for the changes to settle
    await act(async () => { await vi.advanceTimersByTimeAsync(4_000); });
    await waitFor(() => expect(pending.mock.calls.length).toBe(before + 1));
  });

  it('a trigger during a run asks for one more when it ends, never two at once', async () => {
    let release: () => void = () => undefined;
    const gate = new Promise<void>(r => { release = r; });
    pending.mockImplementationOnce(async () => { await gate; return { success: true, data: { items: [], remaining: 0, status: status() } }; });
    renderHook(() => useEmbeddingSync());
    await waitFor(() => expect(pending).toHaveBeenCalledTimes(1));
    act(() => { window.dispatchEvent(new Event('focus')); });
    await new Promise(r => setTimeout(r, 20));
    expect(pending).toHaveBeenCalledTimes(1); // the first is still running
    release();
    await waitFor(() => expect(pending.mock.calls.length).toBeGreaterThanOrEqual(2));
  });
});
