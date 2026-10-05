import { render, act } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { useVaultIndex } from './useVaultIndex';
import { useStore } from '../store/useStore';
import type { VaultIndexSnapshot, VaultIndexDelta } from '../lib/vaultIndexTypes';

function Harness({ dir }: { dir?: string }) { useVaultIndex(dir); return null; }

const original = window.electronAPI;
let emit: ((d: VaultIndexDelta) => void) | null;
let off: ReturnType<typeof vi.fn>;
let resolveSnapshot: ((s: VaultIndexSnapshot) => void) | null;
let snapshotMock: ReturnType<typeof vi.fn>;

beforeEach(() => {
  vi.useFakeTimers();
  emit = null; off = vi.fn(); resolveSnapshot = null;
  snapshotMock = vi.fn(() => new Promise<VaultIndexSnapshot>(res => { resolveSnapshot = res; }));
  window.electronAPI = {
    ...original,
    getVaultIndexSnapshot: snapshotMock,
    onVaultIndexDelta: (cb: (d: VaultIndexDelta) => void) => { emit = cb; return off; },
  } as unknown as typeof window.electronAPI;
  useStore.setState({ noteLinksIndex: {}, tagIndex: {}, vaultIndexSync: null });
});
afterEach(() => { vi.useRealTimers(); window.electronAPI = original; });

describe('useVaultIndex', () => {
  it('loads a snapshot for the vault and passes the vault dir', async () => {
    render(<Harness dir="/notes" />);
    expect(snapshotMock).toHaveBeenCalledWith('/notes');
    await act(async () => { resolveSnapshot!({ vault: '/notes', seq: 1, notes: { 'A.md': { links: ['B'], tags: ['#a'] } } }); });
    expect(useStore.getState().noteLinksIndex).toEqual({ 'A.md': ['B'] });
  });

  it('buffers a delta that overtakes the snapshot, then applies it once the snapshot lands', async () => {
    render(<Harness dir="/notes" />);
    act(() => { emit!({ vault: '/notes', seq: 3, upserts: { 'A.md': { links: [], tags: ['#after'] } }, removals: [] }); });
    expect(useStore.getState().tagIndex).toEqual({}); // snapshot not here yet: nothing applied
    await act(async () => { resolveSnapshot!({ vault: '/notes', seq: 2, notes: { 'A.md': { links: [], tags: ['#before'] } } }); });
    expect(useStore.getState().tagIndex).toEqual({ '#after': ['A.md'] }); // newer than the snapshot: applied
  });

  it('drops a buffered delta the snapshot already covers', async () => {
    render(<Harness dir="/notes" />);
    act(() => { emit!({ vault: '/notes', seq: 2, upserts: { 'A.md': { links: [], tags: ['#older'] } }, removals: [] }); });
    await act(async () => { resolveSnapshot!({ vault: '/notes', seq: 2, notes: { 'A.md': { links: [], tags: ['#in-snapshot'] } } }); });
    expect(useStore.getState().tagIndex).toEqual({ '#in-snapshot': ['A.md'] });
  });

  it('applies deltas straight away once loaded', async () => {
    render(<Harness dir="/notes" />);
    await act(async () => { resolveSnapshot!({ vault: '/notes', seq: 1, notes: {} }); });
    act(() => { emit!({ vault: '/notes', seq: 2, upserts: { 'N.md': { links: [], tags: ['#n'] } }, removals: [] }); });
    expect(useStore.getState().tagIndex).toEqual({ '#n': ['N.md'] });
  });

  it('retries a failed snapshot, then gives up quietly', async () => {
    snapshotMock.mockRejectedValue(new Error('main busy'));
    render(<Harness />);
    await act(async () => { await vi.advanceTimersByTimeAsync(60_000); });
    expect(snapshotMock).toHaveBeenCalledTimes(3);
  });

  it('unsubscribes on unmount and ignores a snapshot that arrives afterwards', async () => {
    const { unmount } = render(<Harness dir="/notes" />);
    unmount();
    expect(off).toHaveBeenCalled();
    await act(async () => { resolveSnapshot!({ vault: '/notes', seq: 1, notes: { 'Late.md': { links: [], tags: [] } } }); });
    expect(useStore.getState().noteLinksIndex).toEqual({});
  });

  it('reloads for a different vault directory', async () => {
    const { rerender } = render(<Harness dir="/one" />);
    rerender(<Harness dir="/two" />);
    expect(snapshotMock).toHaveBeenNthCalledWith(2, '/two');
    expect(off).toHaveBeenCalledTimes(1);
  });
});
