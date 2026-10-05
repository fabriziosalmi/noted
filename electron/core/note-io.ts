import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { safeResolve } from './paths';

const MAX_HISTORY_SNAPSHOTS = 20;
// Don't snapshot every autosave — a 200 KB note × 6000 saves/day is silly.
// Only snapshot if the content has changed by at least this many chars vs the
// most recent snapshot, OR if enough time has passed since the last one.
const SNAPSHOT_MIN_DIFF_CHARS = 200;
const SNAPSHOT_MIN_INTERVAL_MS = 5 * 60 * 1000; // 5 minutes

export async function saveSnapshot(targetDir: string, fileName: string, content: string, opts?: { force?: boolean }): Promise<void> {
  try {
    const histDir = path.join(targetDir, '.noted_history', fileName);
    await fs.promises.mkdir(histDir, { recursive: true });

    // Compare against the most recent snapshot; skip the write if the delta is
    // small AND we snapshot-ed recently.
    const existing = (await fs.promises.readdir(histDir)).filter(f => f.endsWith('.html')).sort();
    if (existing.length > 0) {
      const latest = existing[existing.length - 1];
      const latestPath = path.join(histDir, latest);
      let prevContent = '';
      try { prevContent = await fs.promises.readFile(latestPath, 'utf-8'); } catch { /* ignore */ }
      const diff = Math.abs(prevContent.length - content.length);
      let ageMs = Infinity;
      try {
        const stat = await fs.promises.stat(latestPath);
        ageMs = Date.now() - stat.mtimeMs;
      } catch { /* ignore */ }
      if (opts?.force) {
        // A change that must be undoable (a link rewrite): keep this exact content,
        // unless it is already the latest snapshot.
        if (prevContent === content) return;
      } else if (diff < SNAPSHOT_MIN_DIFF_CHARS && ageMs < SNAPSHOT_MIN_INTERVAL_MS) {
        return; // not worth a new snapshot
      }
    }

    const ts = new Date().toISOString().replace(/[:.]/g, '-');
    await fs.promises.writeFile(path.join(histDir, `${ts}.html`), content, 'utf-8');
    // Prune oldest beyond limit (re-list since we may have just added one).
    const snapshots = (await fs.promises.readdir(histDir)).filter(f => f.endsWith('.html')).sort();
    for (const old of snapshots.slice(0, Math.max(0, snapshots.length - MAX_HISTORY_SNAPSHOTS))) {
      try {
        await fs.promises.unlink(path.join(histDir, old));
      } catch {
        // best effort
      }
    }
  } catch { /* history is best-effort */ }
}

// Write a file and fsync it so its bytes survive a power loss (not just a crash).
export async function writeFileDurable(filePath: string, content: string): Promise<void> {
  const fh = await fs.promises.open(filePath, 'w');
  try {
    await fh.writeFile(content, 'utf-8');
    await fh.sync();
  } finally {
    await fh.close();
  }
}

// fsync a directory so a rename/create in it is durable. Best-effort: some
// platforms/filesystems reject opening a directory for sync.
export async function fsyncDir(dir: string): Promise<void> {
  let fh: Awaited<ReturnType<typeof fs.promises.open>> | undefined;
  try {
    fh = await fs.promises.open(dir, 'r');
    await fh.sync();
  } catch {
    /* rename is still atomic even if the dir fsync isn't available */
  } finally {
    await fh?.close();
  }
}

/** Durable, atomic note write (temp file, fsync, rename, fsync dir). Same recipe as save-note. */
export async function writeNoteAtomic(targetDir: string, fileName: string, content: string): Promise<void> {
  const filePath = safeResolve(targetDir, fileName);
  const tmpPath = `${filePath}.${process.pid}.${crypto.randomBytes(6).toString('hex')}.tmp`;
  await writeFileDurable(tmpPath, content);
  await fs.promises.rename(tmpPath, filePath);
  await fsyncDir(path.dirname(filePath));
}
