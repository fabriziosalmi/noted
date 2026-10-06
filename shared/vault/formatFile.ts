/** Reading and writing the vault's format marker (see format.ts). Node only. */

import * as fs from 'node:fs';
import * as path from 'node:path';
import * as crypto from 'node:crypto';
import { VAULT_MARKER, isNoteFormat, type NoteFormat } from './format';

export const vaultMarkerPath = (notesDir: string): string => path.join(notesDir, VAULT_MARKER);

/** Never throws: no marker (or an unreadable or unknown one) means a vault from before the marker existed: HTML. */
export function readVaultFormat(notesDir: string): NoteFormat {
  try {
    const raw = JSON.parse(fs.readFileSync(vaultMarkerPath(notesDir), 'utf8')) as { format?: unknown } | null;
    return raw && isNoteFormat(raw.format) ? raw.format : 'html';
  } catch {
    return 'html';
  }
}

/** Write the marker atomically. Other fields in an existing marker are kept. */
export function writeVaultFormat(notesDir: string, format: NoteFormat): void {
  if (!isNoteFormat(format)) throw new Error(`Unknown note format: ${String(format)}`);
  const file = vaultMarkerPath(notesDir);
  let existing: Record<string, unknown> = {};
  try {
    const parsed = JSON.parse(fs.readFileSync(file, 'utf8')) as unknown;
    if (typeof parsed === 'object' && parsed !== null) existing = parsed as Record<string, unknown>;
  } catch { /* first write */ }
  const tmp = `${file}.${crypto.randomBytes(6).toString('hex')}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify({ ...existing, format }, null, 2) + '\n', 'utf8');
  fs.renameSync(tmp, file);
}
