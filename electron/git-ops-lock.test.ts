// @vitest-environment node
import { describe, expect, it, vi } from 'vitest';

// Every git command that changes a repository waits its turn behind the background sync: preparing a pull-request
// branch checks out other branches in the user's folder, and doing that in the middle of a sync commits on the wrong one.
const log: string[] = [];
vi.mock('simple-git', () => ({
  default: () => ({
    add: async () => { log.push('add'); },
    commit: async () => { log.push('commit'); return { commit: 'abc' }; },
    status: async () => ({ staged: [], current: 'main' }),
    branchLocal: async () => ({ all: [], current: 'main' }),
    checkoutLocalBranch: async () => { log.push('checkout -b'); },
    checkout: async () => { log.push('checkout'); },
    getRemotes: async () => [],
    addRemote: async () => { log.push('remote add'); },
    push: async () => { log.push('push'); },
  }),
}));

import { commitNote, preparePrBranch, pushBranch } from './git-ops';
import { withRepoLock } from './repo-lock';

const heldBySync = () => {
  let release!: () => void;
  const held = withRepoLock('/vault', () => new Promise<void>(r => { release = () => { log.push('sync done'); r(); }; }));
  return { held, release: () => release() };
};

describe('git-ops under the repository lock', () => {
  it.each([
    ['commitNote', () => commitNote('/vault', 'Plan.md')],
    ['preparePrBranch', () => preparePrBranch('/vault', 'Plan.md')],
    ['pushBranch', () => pushBranch('/vault', 'note/plan', 'https://github.com/o/r.git')],
  ])('%s waits for a sync in progress', async (_name, run) => {
    log.length = 0;
    const sync = heldBySync();
    const op = run();
    await new Promise(r => setTimeout(r, 20));
    expect(log).toEqual([]); // nothing ran while the sync held the repository
    sync.release();
    await sync.held;
    await op;
    expect(log[0]).toBe('sync done');
    expect(log.length).toBeGreaterThan(1);
  });
});
