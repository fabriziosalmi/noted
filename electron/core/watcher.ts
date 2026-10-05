import fs from 'node:fs';
import path from 'node:path';
import { isAppOwnVaultEvent } from '../ipc-utils';
import { watchVaultTree, type VaultWatcher } from '../vault-watch';
import { getActiveVaultDir, getTargetDir } from './paths';
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

export function startVaultWatch(): void {
  const dir = getTargetDir(getActiveVaultDir() || undefined);
  if (watchedDir === dir && vaultWatcher) return;
  try { vaultWatcher?.close(); } catch { /* ignore */ }
  vaultWatcher = null;
  watchedDir = dir;
  // Watch the canonical path. On Windows a vault under a short (8.3) path such as
  // C:\\Users\\RUNNER~1\\... makes Node's recursive watcher compute relative names
  // off by the length difference ("lt/Note.md" for "Note.md"), so changes were
  // reported under names that match no note.
  let watchRoot = dir;
  try { watchRoot = fs.realpathSync.native(dir); } catch { /* keep the configured path */ }
  void vaultIndex.ensure(dir);
  try {
    vaultWatcher = watchVaultTree(watchRoot, (name) => {
      // The app's own bookkeeping (version history, MCP trash and config) is not a note change.
      if (!name.endsWith('.md') || name.includes('.noted_history/') || name.startsWith('.noted/')) return;
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
    });
  } catch { /* fs.watch may be unsupported on some filesystems — best-effort */ }
}
