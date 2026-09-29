import type { EventEmitter } from 'node:events';

// When the app is launched from Finder, a DMG, or any other detached context,
// stdout/stderr can be a closed pipe: the first write — ours (structured-log)
// or electron-updater's internal console.info — then throws EPIPE, and Electron
// turns that uncaught exception into the "A JavaScript error occurred in the
// main process" dialog. Nothing we log is load-bearing, so EPIPE is swallowed;
// any other stream error still throws, exactly as before.
export function installStdioEpipeGuard(
  streams: EventEmitter[] = [process.stdout, process.stderr],
): void {
  for (const stream of streams) {
    stream.on('error', (err: unknown) => {
      if ((err as { code?: string } | null)?.code !== 'EPIPE') throw err;
    });
  }
}
