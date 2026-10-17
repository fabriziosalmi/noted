import * as fs from 'node:fs';
import * as path from 'node:path';

export interface VaultWatcher {
  close(): void;
}

export interface WatchOptions {
  /** Use the per-directory watcher even where recursive watching is native (tests). */
  forceManual?: boolean;
  /** A folder that is not watched (it cannot be, or the limit is reached): its changes go unnoticed. */
  onUnwatched?: (dir: string, reason: string) => void;
  /** At most this many folders are watched one by one (default MAX_WATCHED_DIRS; lower in tests). */
  maxDirs?: number;
}

// inotify watches are a finite, per-user resource; a vault with more folders than
// this is watched only partly rather than exhausting them.
const MAX_WATCHED_DIRS = 4000;

/**
 * Watch every change under `root`, reporting vault-relative names ('a/b.md').
 *
 * macOS and Windows have a native recursive watcher. Node's Linux one is built
 * in JavaScript, watches everything including `.git`, and froze the whole main
 * process while `git worktree add/prune` created and removed directories under
 * `.git/worktrees` (30 of 30 conflict E2E runs passed with the watcher off, and
 * about one in five hung with it on). On Linux the tree is therefore watched one
 * directory at a time, and hidden directories (`.git`, `.noted`, `.noted_history`)
 * are never entered: none of them holds notes.
 */
export function watchVaultTree(
  root: string,
  onChange: (relName: string) => void,
  opts: WatchOptions = {},
): VaultWatcher {
  if (process.platform !== 'linux' && !opts.forceManual) {
    const w = fs.watch(root, { recursive: true }, (_event, filename) => {
      if (filename) onChange(String(filename).split(path.sep).join('/'));
    });
    return w;
  }
  return watchManually(root, onChange, opts.onUnwatched, opts.maxDirs ?? MAX_WATCHED_DIRS);
}

function isHidden(name: string): boolean {
  return name.startsWith('.');
}

function watchManually(
  root: string,
  onChange: (relName: string) => void,
  onUnwatched: ((dir: string, reason: string) => void) | undefined,
  maxDirs: number,
): VaultWatcher {
  const watchers = new Map<string, fs.FSWatcher>(); // absolute dir -> watcher
  let closed = false;

  const relOf = (abs: string): string => path.relative(root, abs).split(path.sep).join('/');

  function dropDir(abs: string): void {
    for (const [dir, w] of watchers) {
      if (dir === abs || dir.startsWith(abs + path.sep)) {
        try { w.close(); } catch { /* ignore */ }
        watchers.delete(dir);
      }
    }
  }

  // `announce`: the directory appeared while we were watching, so notes created
  // inside it before the watcher attached would otherwise go unreported.
  function addDir(abs: string, announce: boolean): void {
    if (closed || watchers.has(abs)) return;
    if (watchers.size >= maxDirs) { onUnwatched?.(abs, `more than ${maxDirs} folders`); return; }
    let w: fs.FSWatcher;
    try {
      w = fs.watch(abs, (event, filename) => onEvent(abs, event, filename));
    } catch (err) {
      // Gone since it was listed, or not watchable (the system's inotify limit, a filesystem without notifications).
      if (fs.existsSync(abs)) onUnwatched?.(abs, (err as NodeJS.ErrnoException).code ?? (err as Error).message);
      return;
    }
    w.on('error', () => dropDir(abs));
    watchers.set(abs, w);
    let entries: fs.Dirent[];
    try { entries = fs.readdirSync(abs, { withFileTypes: true }); } catch { return; }
    for (const e of entries) {
      if (isHidden(e.name)) continue;
      const child = path.join(abs, e.name);
      if (e.isDirectory()) addDir(child, announce);
      if (announce) onChange(relOf(child));
    }
  }

  function onEvent(dir: string, event: string, filename: string | Buffer | null): void {
    if (closed || !filename) return;
    const name = String(filename);
    if (isHidden(name)) return;
    const abs = path.join(dir, name);
    if (event === 'rename') {
      let st: fs.Stats | null = null;
      try { st = fs.lstatSync(abs); } catch { /* gone */ }
      if (st?.isDirectory()) addDir(abs, true);
      else if (!st) dropDir(abs);
    }
    onChange(relOf(abs));
  }

  addDir(root, false);
  return {
    close() {
      closed = true;
      for (const w of watchers.values()) { try { w.close(); } catch { /* ignore */ } }
      watchers.clear();
    },
  };
}
