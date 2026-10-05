import { render, act } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { useGitSync } from './useGitSync';
import { useStore } from '../store/useStore';
import { useGitSyncStore } from '../store/gitSyncStore';
import { STARTUP_SYNC_DELAY_MS, ERROR_BACKOFF_MS } from '../lib/gitSyncPolicy';
import type { GitSyncState } from '../lib/gitSyncTypes';

const st = (p: Partial<GitSyncState> = {}): GitSyncState => ({
  phase: 'idle', branch: 'main', upstream: 'origin/main', lastSyncAt: null, message: null, conflicts: [], ...p,
});

function Harness({ dir }: { dir?: string }) {
  useGitSync(dir);
  return null;
}

let syncNow: ReturnType<typeof vi.fn>;
let emit: ((s: GitSyncState) => void) | null;
let off: ReturnType<typeof vi.fn>;
const original = window.electronAPI;

const setSettings = (s: Record<string, unknown>) =>
  act(() => { useStore.setState(prev => ({ settings: { ...prev.settings, ...s } })); });

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date('2026-10-05T12:00:00Z'));
  syncNow = vi.fn().mockResolvedValue(st({ lastSyncAt: Date.now() }));
  off = vi.fn();
  emit = null;
  window.electronAPI = {
    ...original,
    gitSyncNow: syncNow,
    gitSyncState: vi.fn().mockResolvedValue(st()),
    onGitSyncState: (cb: (s: GitSyncState) => void) => { emit = cb; return off; },
  } as unknown as typeof window.electronAPI;
  useGitSyncStore.setState({ state: null, lastErrorAt: null });
  useStore.setState(prev => ({
    activeNoteName: 'a.md', activeNoteContent: '<p>x</p>',
    settings: { ...prev.settings, gitEnabled: true, gitSyncMode: 'off', gitSyncIntervalMin: 5, gitSyncIdleSec: 30 },
  }));
});

afterEach(() => {
  vi.useRealTimers();
  window.electronAPI = original;
});

describe('useGitSync', () => {
  it('does nothing at all when sync is off', async () => {
    render(<Harness />);
    await act(async () => { await vi.advanceTimersByTimeAsync(10 * 60_000); });
    window.dispatchEvent(new Event('focus'));
    expect(syncNow).not.toHaveBeenCalled();
  });

  it('does nothing when git integration is off even if a sync mode is saved', async () => {
    setSettings({ gitEnabled: false, gitSyncMode: 'interval' });
    render(<Harness />);
    await act(async () => { await vi.advanceTimersByTimeAsync(10 * 60_000); });
    expect(syncNow).not.toHaveBeenCalled();
  });

  it('interval mode: syncs shortly after start, then every N minutes, with the vault dir', async () => {
    setSettings({ gitSyncMode: 'interval', gitSyncIntervalMin: 5 });
    render(<Harness dir="/notes" />);
    expect(syncNow).not.toHaveBeenCalled();
    await act(async () => { await vi.advanceTimersByTimeAsync(STARTUP_SYNC_DELAY_MS); });
    expect(syncNow).toHaveBeenCalledTimes(1);
    expect(syncNow).toHaveBeenCalledWith('/notes');
    await act(async () => { await vi.advanceTimersByTimeAsync(5 * 60_000); });
    expect(syncNow).toHaveBeenCalledTimes(2);
  });

  it('idle mode: waits for edits to settle, restarting the wait on each edit', async () => {
    setSettings({ gitSyncMode: 'idle', gitSyncIdleSec: 30 });
    render(<Harness />);
    await act(async () => { await vi.advanceTimersByTimeAsync(STARTUP_SYNC_DELAY_MS); });
    syncNow.mockClear();

    act(() => { useStore.setState({ activeNoteContent: '<p>x1</p>' }); });
    await act(async () => { await vi.advanceTimersByTimeAsync(20_000); });
    act(() => { useStore.setState({ activeNoteContent: '<p>x12</p>' }); }); // restarts the 30s wait
    await act(async () => { await vi.advanceTimersByTimeAsync(20_000); });
    expect(syncNow).not.toHaveBeenCalled();
    await act(async () => { await vi.advanceTimersByTimeAsync(10_000); });
    expect(syncNow).toHaveBeenCalledTimes(1);
  });

  it('idle mode: switching notes is not an edit', async () => {
    setSettings({ gitSyncMode: 'idle', gitSyncIdleSec: 30 });
    render(<Harness />);
    await act(async () => { await vi.advanceTimersByTimeAsync(STARTUP_SYNC_DELAY_MS); });
    syncNow.mockClear();
    act(() => { useStore.setState({ activeNoteName: 'b.md', activeNoteContent: '<p>other</p>' }); });
    await act(async () => { await vi.advanceTimersByTimeAsync(120_000); });
    expect(syncNow).not.toHaveBeenCalled();
  });

  it('never starts a second sync while one is running', async () => {
    setSettings({ gitSyncMode: 'interval', gitSyncIntervalMin: 1 });
    render(<Harness />);
    await act(async () => { await Promise.resolve(); }); // let the initial state read settle first
    act(() => { useGitSyncStore.getState().setState(st({ phase: 'syncing' })); });
    await act(async () => { await vi.advanceTimersByTimeAsync(STARTUP_SYNC_DELAY_MS + 60_000); });
    expect(syncNow).not.toHaveBeenCalled();
  });

  it('backs off for a minute after a failed sync, then resumes', async () => {
    setSettings({ gitSyncMode: 'interval', gitSyncIntervalMin: 1 });
    render(<Harness />);
    await act(async () => { await Promise.resolve(); });
    act(() => { useGitSyncStore.getState().setState(st({ phase: 'error', message: 'net down' })); });
    await act(async () => { await vi.advanceTimersByTimeAsync(STARTUP_SYNC_DELAY_MS); });
    expect(syncNow).not.toHaveBeenCalled(); // inside the backoff window
    await act(async () => { await vi.advanceTimersByTimeAsync(ERROR_BACKOFF_MS); });
    expect(syncNow).toHaveBeenCalled();
  });

  it('syncs when the window regains focus, but not again within a minute of a sync', async () => {
    setSettings({ gitSyncMode: 'idle' });
    render(<Harness />);
    act(() => { useGitSyncStore.getState().setState(st({ lastSyncAt: Date.now() - 5 * 60_000 })); });
    window.dispatchEvent(new Event('focus'));
    expect(syncNow).toHaveBeenCalledTimes(1);
    syncNow.mockClear();
    act(() => { useGitSyncStore.getState().setState(st({ lastSyncAt: Date.now() })); });
    window.dispatchEvent(new Event('focus'));
    expect(syncNow).not.toHaveBeenCalled();
  });

  it('stops everything on unmount', async () => {
    setSettings({ gitSyncMode: 'interval', gitSyncIntervalMin: 1 });
    const { unmount } = render(<Harness />);
    unmount();
    await act(async () => { await vi.advanceTimersByTimeAsync(10 * 60_000); });
    window.dispatchEvent(new Event('focus'));
    expect(syncNow).not.toHaveBeenCalled();
  });

  it('mirrors engine events into the sync store and unsubscribes on unmount', async () => {
    setSettings({ gitSyncMode: 'idle' });
    const { unmount } = render(<Harness />);
    await act(async () => { await Promise.resolve(); });
    act(() => { emit?.(st({ phase: 'conflict', conflicts: [{} as never] })); });
    expect(useGitSyncStore.getState().state?.phase).toBe('conflict');
    unmount();
    expect(off).toHaveBeenCalled();
  });

  it('changing the mode off stops the timers', async () => {
    setSettings({ gitSyncMode: 'interval', gitSyncIntervalMin: 1 });
    render(<Harness />);
    setSettings({ gitSyncMode: 'off' });
    await act(async () => { await vi.advanceTimersByTimeAsync(10 * 60_000); });
    expect(syncNow).not.toHaveBeenCalled();
  });
});
