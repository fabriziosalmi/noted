// @vitest-environment node
import { describe, it, expect, afterEach } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { watchVaultTree, type VaultWatcher } from './vault-watch';

// The manual (per-directory) watcher is what Linux uses; force it so the suite
// exercises it on every platform.
let dir: string;
let watcher: VaultWatcher | null = null;
const seen: string[] = [];

// FSEvents (macOS) takes a moment to go live; inotify (Linux) is immediate.
async function start(): Promise<void> {
  dir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'noted-watch-')));
  fs.mkdirSync(path.join(dir, 'sub'));
  fs.mkdirSync(path.join(dir, '.git', 'worktrees'), { recursive: true });
  seen.length = 0;
  watcher = watchVaultTree(dir, name => seen.push(name), { forceManual: true });
  await new Promise(r => setTimeout(r, 250));
  seen.length = 0; // FSEvents replays the setup's own mkdirs
}

async function until(pred: () => boolean, ms = 4000): Promise<void> {
  const t0 = Date.now();
  while (!pred()) {
    if (Date.now() - t0 > ms) throw new Error(`timed out; saw ${JSON.stringify(seen)}`);
    await new Promise(r => setTimeout(r, 25));
  }
}

afterEach(() => {
  watcher?.close();
  watcher = null;
  try { fs.rmSync(dir, { recursive: true, force: true }); } catch { /* ignore */ }
});

describe('watchVaultTree (per-directory)', () => {
  it('reports a note created, changed and removed at the root and in a folder', async () => {
    await start();
    fs.writeFileSync(path.join(dir, 'A.md'), 'x');
    fs.writeFileSync(path.join(dir, 'sub', 'B.md'), 'x');
    await until(() => seen.includes('A.md') && seen.includes('sub/B.md'));
    seen.length = 0;
    fs.writeFileSync(path.join(dir, 'sub', 'B.md'), 'changed');
    await until(() => seen.includes('sub/B.md'));
    seen.length = 0;
    fs.rmSync(path.join(dir, 'A.md'));
    await until(() => seen.includes('A.md'));
  });

  it('follows a folder created later, including a note already in it', async () => {
    await start();
    fs.mkdirSync(path.join(dir, 'new'));
    fs.writeFileSync(path.join(dir, 'new', 'Early.md'), 'x');
    await until(() => seen.includes('new/Early.md'));
    seen.length = 0;
    fs.writeFileSync(path.join(dir, 'new', 'Late.md'), 'x');
    await until(() => seen.includes('new/Late.md'));
  });

  it('stops following a folder once it is gone, and survives it coming back', async () => {
    await start();
    fs.rmSync(path.join(dir, 'sub'), { recursive: true });
    await until(() => seen.includes('sub'));
    seen.length = 0;
    fs.mkdirSync(path.join(dir, 'sub'));
    fs.writeFileSync(path.join(dir, 'sub', 'Again.md'), 'x');
    await until(() => seen.includes('sub/Again.md'));
  });

  it('never looks inside hidden folders: git churn there is invisible and harmless', async () => {
    await start();
    for (let i = 0; i < 50; i++) {
      const wt = path.join(dir, '.git', 'worktrees', `noted-sync-${i}`);
      fs.mkdirSync(wt);
      fs.writeFileSync(path.join(wt, 'gitdir'), 'x');
      fs.rmSync(wt, { recursive: true });
    }
    fs.writeFileSync(path.join(dir, 'Marker.md'), 'x');
    await until(() => seen.includes('Marker.md'));
    expect(seen.filter(n => n.startsWith('.git'))).toEqual([]);
  });

  it('close() stops all reporting', async () => {
    await start();
    watcher!.close();
    fs.writeFileSync(path.join(dir, 'Quiet.md'), 'x');
    await new Promise(r => setTimeout(r, 300));
    expect(seen).toEqual([]);
  });
});
