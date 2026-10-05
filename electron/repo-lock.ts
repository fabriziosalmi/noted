/**
 * repo-lock.ts — serialises git operations per repository directory.
 *
 * The renderer's auto-commit timer and the background sync both mutate the same
 * repo from independent IPC calls. Two overlapping `git add` / `git commit` /
 * `git merge` runs race on `.git/index.lock`, so every mutating operation goes
 * through this queue.
 */

import * as path from 'node:path';

const tails = new Map<string, Promise<unknown>>();

export function withRepoLock<T>(dir: string, fn: () => Promise<T>): Promise<T> {
  const key = path.resolve(dir);
  const prev = tails.get(key) ?? Promise.resolve();
  // Run after the previous holder settles, whether it resolved or rejected.
  const run = prev.then(fn, fn);
  const tail = run.catch(() => undefined);
  tails.set(key, tail);
  void tail.then(() => {
    if (tails.get(key) === tail) tails.delete(key);
  });
  return run;
}
