import fs from 'node:fs';
import path from 'node:path';

export type LogLevel = 'info' | 'warn' | 'error';

export type LogFields = Record<string, string | number | boolean | null | undefined>;

export function newRequestId(prefix: string): string {
  return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

// A packaged app started from the Finder, the Dock or the Start menu has nowhere for stdout to go, so every event is
// also appended to a file in the platform's log folder (Help → Show Logs). Kept to two files of MAX_LOG_BYTES.
const MAX_LOG_BYTES = 5 * 1024 * 1024;
let logFile: string | null = null;

/** Where events are also written from now on (main.ts sets it once the app paths are known); null stops it. */
export function setLogFile(file: string | null): void {
  logFile = file;
  if (file) {
    try { fs.mkdirSync(path.dirname(file), { recursive: true }); } catch { logFile = null; }
  }
}

export function getLogFile(): string | null {
  return logFile;
}

function appendToFile(line: string): void {
  if (!logFile) return;
  try {
    let size = 0;
    try { size = fs.statSync(logFile).size; } catch { /* not created yet */ }
    if (size + line.length > MAX_LOG_BYTES) fs.renameSync(logFile, `${logFile}.1`); // the previous one is kept
    fs.appendFileSync(logFile, line, 'utf8');
  } catch { /* a log that cannot be written must not break what it describes */ }
}

export function logEvent(level: LogLevel, event: string, fields: LogFields = {}): void {
  const payload = {
    ts: new Date().toISOString(),
    level,
    event,
    ...fields,
  };
  const line = JSON.stringify(payload) + '\n';
  if (level === 'error') process.stderr.write(line);
  else if (level === 'warn') process.stderr.write(line);
  else process.stdout.write(line);
  appendToFile(line);
}
