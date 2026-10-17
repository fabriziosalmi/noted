// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { nextRestart } from './restartPolicy';

describe('nextRestart', () => {
  it('restarts a server that stopped by itself, later each time', () => {
    expect(nextRestart([1_000], 1_000)).toEqual({ restart: true, delayMs: 1_000 });
    expect(nextRestart([1_000, 2_000], 2_000)).toEqual({ restart: true, delayMs: 2_000 });
    expect(nextRestart([1_000, 2_000, 3_000], 3_000)).toEqual({ restart: true, delayMs: 4_000 });
  });

  it('gives up after three restarts within five minutes', () => {
    expect(nextRestart([1_000, 2_000, 3_000, 4_000], 4_000)).toEqual({ restart: false });
  });

  it('forgets exits older than the window', () => {
    expect(nextRestart([0, 1, 2, 10 * 60_000], 10 * 60_000)).toEqual({ restart: true, delayMs: 1_000 });
  });
});
