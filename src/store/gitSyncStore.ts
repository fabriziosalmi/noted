import { create } from 'zustand';
import type { GitSyncState } from '../lib/gitSyncTypes';

/**
 * Live state of the background git sync, mirrored from the main process.
 * Deliberately NOT part of the persisted app store: it is runtime state that
 * must start empty on every launch.
 */
interface GitSyncStore {
  state: GitSyncState | null;
  /** Last time a sync ended in 'error'; drives the automatic-trigger backoff. */
  lastErrorAt: number | null;
  setState: (state: GitSyncState) => void;
}

export const useGitSyncStore = create<GitSyncStore>(set => ({
  state: null,
  lastErrorAt: null,
  setState: state => set(prev => ({
    state,
    lastErrorAt: state.phase === 'error' ? Date.now() : state.phase === 'idle' ? null : prev.lastErrorAt,
  })),
}));
