import { hasHiddenSegment } from '../../shared/vault/paths';
import fs from 'node:fs';
import path from 'node:path';
import { isAppOwnVaultEvent } from '../ipc-utils';
import { watchVaultTree, type VaultWatcher } from '../vault-watch';
import { availableTargetDir, getActiveVaultDir } from './paths';
import { logEvent } from '../structured-log';
import { appWriteMtimes, appDeletes, APP_DELETE_WINDOW_MS } from './app-writes';
import { fullTextSearchIndex, vaultIndex } from './services';
import { getMainWindow } from './windows';

// Watch the vault so writes by anyone other than the app itself (an MCP client,
// a sync client) reach the renderer: it refreshes the note list, and warns the
// user when the note they have open changed underneath them so the editor's
// autosave doesn't silently clobber it. The app's own writes are suppressed by
// recording the mtime we just wrote.
let vaultWatcher: VaultWatcher | null = null;
let watchedDir: string | null = null;

/**
 * Whether changes made outside the app are being noticed. When they are not, the editor's protection against
 * overwriting them (reload, or keep both versions) does not run either, so the renderer says so instead of failing
 * silently.
 */
export type VaultWatchStatus =
  | { state: 'on' }
  | { state: 'off'; reason: string }
  | { state: 'partial'; skipped: number; reason: string };
let watchStatus: VaultWatchStatus = { state: 'on' };

export function getVaultWatchStatus(): VaultWatchStatus {
  return watchStatus;
}

function reportWatch(next: VaultWatchStatus): void {
  watchStatus = next;
  getMainWindow()?.webContents.send('vault-watch-status', next);
}

export function startVaultWatch(): void {
  const dir = availableTargetDir(getActiveVaultDir() || undefined);
  if (dir !== null && watchedDir === dir && vaultWatcher) return;
  try { vaultWatcher?.close(); } catch { /* ignore */ }
  vaultWatcher = null;
  watchedDir = dir;
  // The open vault is not there: watch nothing rather than another vault (the next set-active-vault starts again).
  if (dir === null) {
    logEvent('warn', 'vault_watch_unavailable', { vault: getActiveVaultDir() });
    reportWatch({ state: 'off', reason: 'vault-unavailable' });
    return;
  }
  // Watch the canonical path. On Windows a vault under a short (8.3) path such as
  // C:\\Users\\RUNNER~1\\... makes Node's recursive watcher compute relative names
  // off by the length difference ("lt/Note.md" for "Note.md"), so changes were
  // reported under names that match no note.
  let watchRoot = dir;
  try { watchRoot = fs.realpathSync.native(dir); } catch { /* keep the configured path */ }
  void vaultIndex.ensure(dir);
  let skipped = 0;
  let firstReason = '';
  let starting = true;
  const onUnwatched = (folder: string, reason: string) => {
    skipped++;
    if (skipped === 1) {
      firstReason = reason;
      logEvent('warn', 'vault_watch_partial', { vault: dir, folder, reason });
    }
    if (!starting) reportWatch({ state: 'partial', skipped, reason: firstReason });
  };
  try {
    vaultWatcher = watchVaultTree(watchRoot, (name) => {
      // Only a note is a note change: not the app's own bookkeeping (version history, MCP trash and config), and not
      // anything under a hidden folder at any depth (.obsidian, .git, .trash, ...).
      if (!name.endsWith('.md') || hasHiddenSegment(name)) return;
      // Every change, the app's own included, goes through the index: it compares
      // mtime and size, so an echo of our own save costs a stat and nothing else.
      vaultIndex.scheduleTouch(dir, name);
      fullTextSearchIndex.scheduleRefresh(dir, name);
      // A file we can't stat is gone — deleted, or renamed away. Report those
      // too: dropping them left notes removed by an external writer sitting in
      // the sidebar until the next launch.
      let mtimeMs: number | null = null;
      try { mtimeMs = fs.statSync(path.join(watchRoot, name)).mtimeMs; } catch { /* gone */ }
      if (isAppOwnVaultEvent({
        mtimeMs,
        lastAppWriteMtimeMs: appWriteMtimes.get(name),
        appDeletedAtMs: appDeletes.get(name),
        nowMs: Date.now(),
        deleteWindowMs: APP_DELETE_WINDOW_MS,
      })) return;
      getMainWindow()?.webContents.send('note-changed-externally', name);
    }, { onUnwatched });
    starting = false;
    reportWatch(skipped > 0 ? { state: 'partial', skipped, reason: firstReason } : { state: 'on' });
  } catch (err) {
    // fs.watch is not available on every filesystem (some network and FUSE mounts).
    const reason = (err as NodeJS.ErrnoException).code ?? (err as Error).message;
    logEvent('error', 'vault_watch_failed', { vault: dir, reason });
    reportWatch({ state: 'off', reason });
  }
}
