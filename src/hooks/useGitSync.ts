import { useEffect, useMemo, useRef } from 'react';
import { useStore } from '../store/useStore';
import { useGitSyncStore } from '../store/gitSyncStore';
import { getElectronApi } from '../lib/electronApi';
import {
  readSyncPrefs, canAutoSync, shouldSyncOnFocus, STARTUP_SYNC_DELAY_MS,
} from '../lib/gitSyncPolicy';

/**
 * Drives the background git sync from the renderer: mirrors the engine's state
 * into the sync store and decides WHEN to ask for a cycle (the engine itself
 * lives in the main process and serialises cycles).
 *
 * Triggers, per the user's mode:
 *   interval  every N minutes
 *   idle      N seconds after the last edit settles
 * both of them: once shortly after launch / enabling, and when the window regains
 * focus (so edits from another device show up as soon as you come back).
 * Automatic triggers are skipped while a sync runs, and for a minute after one
 * failed; see canAutoSync.
 */
export function useGitSync(syncDirectory: string | undefined): void {
  const gitEnabled = useStore(s => s.settings.gitEnabled);
  const mode = useStore(s => s.settings.gitSyncMode);
  const intervalMin = useStore(s => s.settings.gitSyncIntervalMin);
  const idleSec = useStore(s => s.settings.gitSyncIdleSec);
  const prefs = useMemo(
    () => readSyncPrefs({ gitEnabled, gitSyncMode: mode, gitSyncIntervalMin: intervalMin, gitSyncIdleSec: idleSec }),
    [gitEnabled, mode, intervalMin, idleSec],
  );
  const prefsRef = useRef(prefs);
  useEffect(() => { prefsRef.current = prefs; }, [prefs]);

  // Mirror the engine's state (it also reports manual and externally-started syncs).
  useEffect(() => {
    const api = getElectronApi();
    if (!api?.onGitSyncState || !api.gitSyncState || !gitEnabled) return;
    const set = useGitSyncStore.getState().setState;
    let cancelled = false;
    const off = api.onGitSyncState(set);
    void api.gitSyncState(syncDirectory).then(st => { if (!cancelled) set(st); }).catch(() => undefined);
    return () => { cancelled = true; off(); };
  }, [gitEnabled, syncDirectory]);

  // The triggers.
  useEffect(() => {
    const api = getElectronApi();
    if (!api?.gitSyncNow || prefs.mode === 'off') return;

    const run = () => {
      const { state, lastErrorAt } = useGitSyncStore.getState();
      if (!canAutoSync({ prefs: prefsRef.current, phase: state?.phase, now: Date.now(), lastErrorAt })) return;
      // The engine reports its state through the event stream; the return value is only a fallback.
      void api.gitSyncNow(syncDirectory).then(st => useGitSyncStore.getState().setState(st)).catch(() => undefined);
    };

    const startup = setTimeout(run, STARTUP_SYNC_DELAY_MS);
    let interval: ReturnType<typeof setInterval> | undefined;
    let idleTimer: ReturnType<typeof setTimeout> | undefined;
    let unsubscribeEdits: (() => void) | undefined;

    if (prefs.mode === 'interval') {
      interval = setInterval(run, prefs.intervalMs);
    } else {
      // An edit = the open note's content changed while it stayed the same note
      // (switching notes is not an edit).
      unsubscribeEdits = useStore.subscribe((s, prev) => {
        if (s.activeNoteName === prev.activeNoteName && s.activeNoteContent !== prev.activeNoteContent) {
          clearTimeout(idleTimer);
          idleTimer = setTimeout(run, prefs.idleMs);
        }
      });
    }

    const onFocus = () => {
      const lastSyncAt = useGitSyncStore.getState().state?.lastSyncAt ?? null;
      if (shouldSyncOnFocus({ prefs: prefsRef.current, lastSyncAt, now: Date.now() })) run();
    };
    window.addEventListener('focus', onFocus);

    return () => {
      clearTimeout(startup);
      clearTimeout(idleTimer);
      if (interval) clearInterval(interval);
      unsubscribeEdits?.();
      window.removeEventListener('focus', onFocus);
    };
  }, [prefs, syncDirectory]);
}
