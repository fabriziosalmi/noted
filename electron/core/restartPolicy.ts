/**
 * Whether a helper process that stopped by itself is started again: up to `max` times within `windowMs`, each a little
 * later than the one before, so a server that fails at once (a port already taken) is not respawned in a tight loop.
 */
export function nextRestart(
  exitsAt: readonly number[],
  now: number,
  { max = 3, windowMs = 5 * 60_000, baseDelayMs = 1_000 } = {},
): { restart: true; delayMs: number } | { restart: false } {
  const recent = exitsAt.filter(t => now - t < windowMs).length;
  if (recent > max) return { restart: false };
  return { restart: true, delayMs: baseDelayMs * 2 ** Math.max(0, recent - 1) };
}
