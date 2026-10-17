/** How long a reloaded renderer must stay up before another crash earns another reload. */
export const RELOAD_WINDOW_MS = 60_000;

/**
 * What to do when the window's renderer process is gone. A crash (out of memory on a huge note, a GPU failure, a kill)
 * leaves a blank window that answers nothing, so it is loaded again; a second crash within a minute of the last reload
 * is not, since a renderer that dies at every start would reload for ever. A clean exit is the app closing.
 */
export function afterRendererGone(reason: string, lastReloadAt: number | null, now: number): 'reload' | 'leave' {
  if (reason === 'clean-exit') return 'leave';
  if (lastReloadAt !== null && now - lastReloadAt < RELOAD_WINDOW_MS) return 'leave';
  return 'reload';
}
