import { describe, it, expect, vi, afterEach } from 'vitest';
import { renderHook } from '@testing-library/react';
import { useViews } from './useViews';
import { useStore } from '../store/useStore';

const original = window.electronAPI;
afterEach(() => { window.electronAPI = original; });

const viewNamed = (name: string) => ({ id: name, name, source: { kind: 'all' }, filters: [], sort: [], columns: [], layout: 'table' });

describe('useViews', () => {
  it('loads the vault\'s views, and starts over when another vault is chosen', async () => {
    const loadViews = vi.fn()
      .mockResolvedValueOnce({ success: true, data: [viewNamed('first')] })
      .mockResolvedValueOnce({ success: true, data: [viewNamed('second')] });
    window.electronAPI = { ...original, loadViews } as unknown as typeof window.electronAPI;
    const { rerender } = renderHook(({ dir }) => useViews(dir), { initialProps: { dir: '/a' as string | undefined } });
    await vi.waitFor(() => expect(useStore.getState().views.map(v => v.name)).toEqual(['first']));
    rerender({ dir: '/b' });
    await vi.waitFor(() => expect(useStore.getState().views.map(v => v.name)).toEqual(['second']));
    expect(loadViews).toHaveBeenCalledTimes(2);
  });
});
