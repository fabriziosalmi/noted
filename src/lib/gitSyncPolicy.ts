/**
 * Pure rules for the background git sync: how the user's settings are read, when
 * an automatic sync may start, and how a sync state is summarised for the UI.
 * Kept free of React and Electron so it can be tested exhaustively.
 */

import type { GitSyncPhase, GitSyncState } from './gitSyncTypes';

export type GitSyncMode = 'off' | 'interval' | 'idle';

export const SYNC_INTERVAL_MIN = { min: 1, max: 120, def: 5 } as const;
export const SYNC_IDLE_SEC = { min: 10, max: 600, def: 30 } as const;

/** After a failed sync, automatic triggers stay quiet this long (manual ones never do). */
export const ERROR_BACKOFF_MS = 60_000;
/** Regaining window focus syncs, but never more often than this. */
export const FOCUS_SYNC_MIN_GAP_MS = 60_000;
/** First sync after launch / after turning sync on. */
export const STARTUP_SYNC_DELAY_MS = 3_000;

export interface SyncSettingsInput {
  gitEnabled?: boolean;
  gitSyncMode?: string;
  gitSyncIntervalMin?: number;
  gitSyncIdleSec?: number;
}

export interface SyncPrefs {
  mode: GitSyncMode;
  intervalMs: number;
  idleMs: number;
}

const clamp = (v: unknown, r: { min: number; max: number; def: number }): number => {
  const n = typeof v === 'number' && Number.isFinite(v) ? Math.round(v) : r.def;
  return Math.min(r.max, Math.max(r.min, n));
};

/** Settings -> effective preferences. Anything unrecognised or incomplete means "off". */
export function readSyncPrefs(s: SyncSettingsInput): SyncPrefs {
  const wanted = s.gitSyncMode === 'interval' || s.gitSyncMode === 'idle' ? s.gitSyncMode : 'off';
  return {
    mode: s.gitEnabled ? wanted : 'off',
    intervalMs: clamp(s.gitSyncIntervalMin, SYNC_INTERVAL_MIN) * 60_000,
    idleMs: clamp(s.gitSyncIdleSec, SYNC_IDLE_SEC) * 1000,
  };
}

export function canAutoSync(a: {
  prefs: SyncPrefs;
  phase: GitSyncPhase | undefined;
  now: number;
  lastErrorAt: number | null;
}): boolean {
  if (a.prefs.mode === 'off') return false;
  if (a.phase === 'syncing') return false; // single flight
  if (a.lastErrorAt !== null && a.now - a.lastErrorAt < ERROR_BACKOFF_MS) return false;
  return true;
}

/** Should regaining focus start a sync? */
export function shouldSyncOnFocus(a: { prefs: SyncPrefs; lastSyncAt: number | null; now: number }): boolean {
  if (a.prefs.mode === 'off') return false;
  return a.lastSyncAt === null || a.now - a.lastSyncAt >= FOCUS_SYNC_MIN_GAP_MS;
}

export type SyncTone = 'off' | 'ok' | 'busy' | 'attention' | 'error';
export type SyncSummary =
  | { kind: 'off'; tone: 'off' }
  | { kind: 'never'; tone: 'ok' }
  | { kind: 'synced'; tone: 'ok'; at: number }
  | { kind: 'syncing'; tone: 'busy' }
  | { kind: 'conflict'; tone: 'attention'; count: number }
  | { kind: 'unconfigured'; tone: 'attention' }
  | { kind: 'error'; tone: 'error'; message: string | null };

export function summarizeSync(state: GitSyncState | null, mode: GitSyncMode): SyncSummary {
  if (state?.phase === 'syncing') return { kind: 'syncing', tone: 'busy' };
  if (state?.phase === 'conflict') return { kind: 'conflict', tone: 'attention', count: state.conflicts.length };
  if (mode === 'off') return { kind: 'off', tone: 'off' };
  if (!state) return { kind: 'never', tone: 'ok' };
  if (state.phase === 'unconfigured') return { kind: 'unconfigured', tone: 'attention' };
  if (state.phase === 'error') return { kind: 'error', tone: 'error', message: state.message };
  return state.lastSyncAt === null ? { kind: 'never', tone: 'ok' } : { kind: 'synced', tone: 'ok', at: state.lastSyncAt };
}

/** "2 minutes ago" in the user's language, from a timestamp. */
export function formatAgo(at: number, now: number, language: string): string {
  const seconds = Math.max(0, Math.round((now - at) / 1000));
  const rtf = new Intl.RelativeTimeFormat(language, { numeric: 'auto' });
  if (seconds < 45) return rtf.format(0, 'second');
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return rtf.format(-minutes, 'minute');
  const hours = Math.round(minutes / 60);
  if (hours < 48) return rtf.format(-hours, 'hour');
  return rtf.format(-Math.round(hours / 24), 'day');
}
