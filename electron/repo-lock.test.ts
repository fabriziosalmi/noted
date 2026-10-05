// @vitest-environment node
import { describe, it, expect } from 'vitest';
import { withRepoLock } from './repo-lock';

const tick = (ms: number) => new Promise(r => setTimeout(r, ms));

describe('withRepoLock', () => {
  it('runs operations on the same directory strictly one at a time, in order', async () => {
    const log: string[] = [];
    const op = (name: string, ms: number) => withRepoLock('/vault', async () => {
      log.push(`start ${name}`);
      await tick(ms);
      log.push(`end ${name}`);
    });
    await Promise.all([op('a', 30), op('b', 5), op('c', 1)]);
    expect(log).toEqual(['start a', 'end a', 'start b', 'end b', 'start c', 'end c']);
  });

  it('lets different directories run concurrently', async () => {
    const log: string[] = [];
    const op = (dir: string, name: string) => withRepoLock(dir, async () => {
      log.push(`start ${name}`);
      await tick(20);
      log.push(`end ${name}`);
    });
    await Promise.all([op('/one', 'x'), op('/two', 'y')]);
    expect(log.slice(0, 2).sort()).toEqual(['start x', 'start y']);
  });

  it('a failing operation does not block the queue, and its error reaches its own caller', async () => {
    const failing = withRepoLock('/vault2', async () => { throw new Error('boom'); });
    const next = withRepoLock('/vault2', async () => 'ok');
    await expect(failing).rejects.toThrow('boom');
    await expect(next).resolves.toBe('ok');
  });

  it('treats equivalent paths as the same repository', async () => {
    const log: string[] = [];
    const a = withRepoLock('/vault3/x/..', async () => { await tick(20); log.push('a'); });
    const b = withRepoLock('/vault3', async () => { log.push('b'); });
    await Promise.all([a, b]);
    expect(log).toEqual(['a', 'b']);
  });
});
