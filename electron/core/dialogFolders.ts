import fs from 'node:fs';
import path from 'node:path';
import { app } from 'electron';
import { writeFileAtomicSync } from './note-io';

// Since Electron 43 an Open dialog given no defaultPath starts in Downloads, and the system no longer remembers the
// folder last used. Each of ours starts where the same dialog was last used, kept in userData/dialog-folders.json.
export type DialogKind = 'choose-vault' | 'export-vault' | 'import-vault' | 'import-enex';

const file = (): string => path.join(app.getPath('userData'), 'dialog-folders.json');
const isDir = (p: string): boolean => { try { return fs.statSync(p).isDirectory(); } catch { return false; } };

function readAll(): Partial<Record<DialogKind, unknown>> {
  try {
    const raw: unknown = JSON.parse(fs.readFileSync(file(), 'utf8'));
    return raw && typeof raw === 'object' ? raw as Partial<Record<DialogKind, unknown>> : {};
  } catch {
    return {};
  }
}

/** Where a dialog of this kind starts: the folder it was last used in, if it is still there, else `fallback` if it is. */
export function dialogStart(kind: DialogKind, fallback?: string): string | undefined {
  const last = readAll()[kind];
  if (typeof last === 'string' && isDir(last)) return last;
  return fallback && isDir(fallback) ? fallback : undefined;
}

/** Remember the folder the next dialog of this kind starts in. A dialog that cannot remember still works. */
export function rememberDialogFolder(kind: DialogKind, folder: string): void {
  try {
    writeFileAtomicSync(file(), JSON.stringify({ ...readAll(), [kind]: folder }));
  } catch { /* the next dialog starts where the system puts it */ }
}
