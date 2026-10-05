import { describe, it, expect } from 'vitest';
import {
  readSyncPrefs, canAutoSync, shouldSyncOnFocus, summarizeSync, formatAgo,
  ERROR_BACKOFF_MS, FOCUS_SYNC_MIN_GAP_MS, SYNC_INTERVAL_MIN, SYNC_IDLE_SEC,
  type SyncPrefs,
} from './gitSyncPolicy';
import type { GitSyncState, GitSyncConflict } from './gitSyncTypes';

const state = (p: Partial<GitSyncState> = {}): GitSyncState => ({
  phase: 'idle', branch: 'main', upstream: 'origin/main', lastSyncAt: null, message: null, conflicts: [], ...p,
});
const prefs = (mode: SyncPrefs['mode']): SyncPrefs => ({ mode, intervalMs: 300_000, idleMs: 30_000 });

describe('readSyncPrefs', () => {
  it('is off by default and for anything unrecognised', () => {
    expect(readSyncPrefs({}).mode).toBe('off');
    expect(readSyncPrefs({ gitEnabled: true }).mode).toBe('off');
    expect(readSyncPrefs({ gitEnabled: true, gitSyncMode: 'always' }).mode).toBe('off');
  });

  it('is off whenever git integration itself is off, whatever the sync mode says', () => {
    expect(readSyncPrefs({ gitEnabled: false, gitSyncMode: 'interval' }).mode).toBe('off');
    expect(readSyncPrefs({ gitSyncMode: 'idle' }).mode).toBe('off');
  });

  it('accepts the two real modes', () => {
    expect(readSyncPrefs({ gitEnabled: true, gitSyncMode: 'interval' }).mode).toBe('interval');
    expect(readSyncPrefs({ gitEnabled: true, gitSyncMode: 'idle' }).mode).toBe('idle');
  });

  it('defaults and clamps the numbers, including garbage', () => {
    expect(readSyncPrefs({}).intervalMs).toBe(SYNC_INTERVAL_MIN.def * 60_000);
    expect(readSyncPrefs({}).idleMs).toBe(SYNC_IDLE_SEC.def * 1000);
    expect(readSyncPrefs({ gitSyncIntervalMin: 0 }).intervalMs).toBe(SYNC_INTERVAL_MIN.min * 60_000);
    expect(readSyncPrefs({ gitSyncIntervalMin: 9999 }).intervalMs).toBe(SYNC_INTERVAL_MIN.max * 60_000);
    expect(readSyncPrefs({ gitSyncIdleSec: -5 }).idleMs).toBe(SYNC_IDLE_SEC.min * 1000);
    expect(readSyncPrefs({ gitSyncIdleSec: 1e9 }).idleMs).toBe(SYNC_IDLE_SEC.max * 1000);
    expect(readSyncPrefs({ gitSyncIntervalMin: NaN }).intervalMs).toBe(SYNC_INTERVAL_MIN.def * 60_000);
    expect(readSyncPrefs({ gitSyncIntervalMin: Infinity }).intervalMs).toBe(SYNC_INTERVAL_MIN.def * 60_000);
    expect(readSyncPrefs({ gitSyncIntervalMin: '5' as unknown as number }).intervalMs).toBe(SYNC_INTERVAL_MIN.def * 60_000);
    expect(readSyncPrefs({ gitSyncIntervalMin: 2.6 }).intervalMs).toBe(3 * 60_000);
  });
});

describe('canAutoSync', () => {
  const base = { phase: 'idle' as const, now: 1_000_000, lastErrorAt: null };
  it('never when off', () => expect(canAutoSync({ ...base, prefs: prefs('off') })).toBe(false));
  it('yes when on and quiet', () => {
    expect(canAutoSync({ ...base, prefs: prefs('interval') })).toBe(true);
    expect(canAutoSync({ ...base, prefs: prefs('idle'), phase: undefined })).toBe(true);
  });
  it('single flight: not while a sync is running', () => {
    expect(canAutoSync({ ...base, prefs: prefs('interval'), phase: 'syncing' })).toBe(false);
  });
  it('backs off after an error, then resumes', () => {
    const lastErrorAt = base.now - 1000;
    expect(canAutoSync({ ...base, prefs: prefs('interval'), lastErrorAt })).toBe(false);
    expect(canAutoSync({ ...base, prefs: prefs('interval'), lastErrorAt: base.now - ERROR_BACKOFF_MS })).toBe(true);
  });
  it('keeps trying while paused on a conflict (commits local edits, re-checks the remote)', () => {
    expect(canAutoSync({ ...base, prefs: prefs('interval'), phase: 'conflict' })).toBe(true);
  });
});

describe('shouldSyncOnFocus', () => {
  const now = 10_000_000;
  it('syncs on focus when never synced or stale, not when recent, never when off', () => {
    expect(shouldSyncOnFocus({ prefs: prefs('idle'), lastSyncAt: null, now })).toBe(true);
    expect(shouldSyncOnFocus({ prefs: prefs('idle'), lastSyncAt: now - FOCUS_SYNC_MIN_GAP_MS, now })).toBe(true);
    expect(shouldSyncOnFocus({ prefs: prefs('idle'), lastSyncAt: now - 5000, now })).toBe(false);
    expect(shouldSyncOnFocus({ prefs: prefs('off'), lastSyncAt: null, now })).toBe(false);
  });
});

describe('summarizeSync', () => {
  it('reports syncing and conflicts even when the mode is off (they are facts, not settings)', () => {
    expect(summarizeSync(state({ phase: 'syncing' }), 'off').kind).toBe('syncing');
    const c = summarizeSync(state({ phase: 'conflict', conflicts: [{} as GitSyncConflict, {} as GitSyncConflict] }), 'off');
    expect(c).toEqual({ kind: 'conflict', tone: 'attention', count: 2 });
  });
  it('is quiet when off and nothing is wrong', () => {
    expect(summarizeSync(null, 'off').kind).toBe('off');
    expect(summarizeSync(state({ lastSyncAt: 5 }), 'off').kind).toBe('off');
  });
  it('describes the normal progression', () => {
    expect(summarizeSync(null, 'interval').kind).toBe('never');
    expect(summarizeSync(state(), 'interval').kind).toBe('never');
    expect(summarizeSync(state({ lastSyncAt: 123 }), 'interval')).toEqual({ kind: 'synced', tone: 'ok', at: 123 });
  });
  it('surfaces errors and a missing upstream', () => {
    expect(summarizeSync(state({ phase: 'error', message: 'boom' }), 'idle')).toEqual({ kind: 'error', tone: 'error', message: 'boom' });
    expect(summarizeSync(state({ phase: 'unconfigured', message: 'x' }), 'idle').kind).toBe('unconfigured');
  });
});

describe('formatAgo', () => {
  const now = 1_700_000_000_000;
  it('says "now" for the last moments, then minutes, hours, days', () => {
    expect(formatAgo(now - 10_000, now, 'en')).toMatch(/now|second/i);
    expect(formatAgo(now - 5 * 60_000, now, 'en')).toBe('5 minutes ago');
    expect(formatAgo(now - 3 * 3_600_000, now, 'en')).toBe('3 hours ago');
    expect(formatAgo(now - 72 * 3_600_000, now, 'en')).toBe('3 days ago');
  });
  it('localises', () => {
    expect(formatAgo(now - 5 * 60_000, now, 'it')).toBe('5 minuti fa');
  });
  it('never goes negative on clock skew', () => {
    expect(formatAgo(now + 60_000, now, 'en')).toMatch(/now|second/i);
  });
});
