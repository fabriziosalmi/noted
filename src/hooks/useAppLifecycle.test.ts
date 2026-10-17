import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, renderHook } from '@testing-library/react';
import { useAppLifecycle } from './useAppLifecycle';
import { useStore } from '../store/useStore';

describe('useAppLifecycle auto-commit', () => {
  const original = window.electronAPI.gitCommitAll;
  afterEach(() => { window.electronAPI.gitCommitAll = original; vi.useRealTimers(); });
  beforeEach(() => {
    vi.useFakeTimers();
    useStore.setState({ settings: { ...useStore.getState().settings, gitEnabled: true, enableAutoCommit: true, autoCommitInterval: 1 } });
  });

  it('says a failure once, says it again only after a success or a different error', async () => {
    const replies = [
      { success: false, error: 'index.lock exists' },
      { success: false, error: 'index.lock exists' },
      { success: true, data: { hash: 'abc' } },
      { success: false, error: 'index.lock exists' },
      { success: false, error: 'disk full' },
    ];
    window.electronAPI.gitCommitAll = vi.fn(async () => replies.shift()!) as typeof original;
    const onAutoCommitError = vi.fn();
    renderHook(() => useAppLifecycle({ activeNoteName: null, fetchNotes: vi.fn(async () => undefined), loadApiKey: vi.fn(async () => undefined), onAutoCommitError }));

    for (let i = 0; i < 5; i++) await act(async () => { await vi.advanceTimersByTimeAsync(60_000); });

    expect(window.electronAPI.gitCommitAll).toHaveBeenCalledTimes(5);
    expect(onAutoCommitError.mock.calls.map(c => c[0])).toEqual(['index.lock exists', 'index.lock exists', 'disk full']);
  });
});
