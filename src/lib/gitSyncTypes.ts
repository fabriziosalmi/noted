/**
 * Shapes shared by the main-process sync engine (electron/git-sync.ts, which
 * keeps its own copy so electron/ never imports from src/) and the renderer.
 * The IPC contract test keeps the method names in step; keep these in step by hand.
 */

export type GitSyncPhase = 'idle' | 'syncing' | 'conflict' | 'error' | 'unconfigured';

export interface GitSyncConflict {
  path: string;
  kind: 'both-modified' | 'both-added' | 'deleted-by-us' | 'deleted-by-them';
  binary: boolean;
  base: string | null;
  ours: string | null;
  theirs: string | null;
  oursSha: string | null;
  theirsSha: string | null;
}

export interface GitSyncState {
  phase: GitSyncPhase;
  branch: string | null;
  upstream: string | null;
  lastSyncAt: number | null;
  message: string | null;
  conflicts: GitSyncConflict[];
}

export interface GitConflictResolution {
  path: string;
  oursSha: string | null;
  theirsSha: string | null;
  choice: 'ours' | 'theirs' | 'content' | 'delete';
  content?: string;
}
