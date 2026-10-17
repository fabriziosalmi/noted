// @vitest-environment node
import { describe, expect, it, vi } from 'vitest';
import type * as FsModule from 'node:fs';

// Git panel commands run under the same repository lock as the background sync: one that never returns would hold it
// for ever. Each one is started with a timeout, like the sync's own commands.
const options: unknown[] = [];
vi.mock('simple-git', () => ({
  simpleGit: (_dir: string, opts: unknown) => {
    options.push(opts);
    return { revparse: async () => '.git', raw: async () => '', status: async () => ({ files: [], staged: [], current: 'main', ahead: 0, isClean: () => true }) };
  },
}));
vi.mock('node:fs', async (orig) => {
  const real = await orig<typeof FsModule>();
  return { ...real, existsSync: () => true, default: { ...real, existsSync: () => true } };
});

import { GIT_TIMEOUT_MS, isRepo } from './git-ops';

describe('git-ops', () => {
  it('starts git with a block timeout', async () => {
    await isRepo('/vault');
    expect(options.length).toBeGreaterThan(0);
    for (const o of options) expect(o).toMatchObject({ timeout: { block: GIT_TIMEOUT_MS } });
  });
});
