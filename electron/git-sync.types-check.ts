/**
 * Compile-time guard, no runtime. `electron/` is bundled by esbuild (no type
 * check), and must not import from `src/`, so the sync shapes exist twice. This
 * file makes `tsc -b` fail if the two copies ever diverge — and, because it
 * imports the engine, type-checks the engine itself in CI.
 */
import type { SyncState, SyncConflict, ConflictResolution } from './git-sync';
import type { GitSyncState, GitSyncConflict, GitConflictResolution } from '../src/lib/gitSyncTypes';

type Equal<A, B> = [A] extends [B] ? ([B] extends [A] ? true : false) : false;

export const syncStateMatches: Equal<SyncState, GitSyncState> = true;
export const syncConflictMatches: Equal<SyncConflict, GitSyncConflict> = true;
export const resolutionMatches: Equal<ConflictResolution, GitConflictResolution> = true;
