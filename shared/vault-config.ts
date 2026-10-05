/**
 * Per-vault settings that both the app and a separately-launched MCP server must
 * agree on, stored in `<vault>/.noted/config.json`. The MCP server may be started
 * by another program (a desktop assistant over stdio) that knows nothing about the
 * app's own settings; a file in the vault is the one place both can read. The
 * `.noted` folder is a dot-directory, so it is never listed, indexed or git-synced.
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import * as crypto from 'node:crypto';

export const DEFAULT_TRASH_RETENTION_DAYS = 30;
export const MAX_TRASH_RETENTION_DAYS = 3650;

export interface VaultConfig {
  /** Days a note deleted through MCP stays recoverable; 0 = until removed by hand. */
  trashRetentionDays?: number;
}

export const vaultConfigPath = (notesDir: string): string => path.join(notesDir, '.noted', 'config.json');

export function isValidRetentionDays(v: unknown): v is number {
  return typeof v === 'number' && Number.isInteger(v) && v >= 0 && v <= MAX_TRASH_RETENTION_DAYS;
}

/** Never throws: a missing or corrupt file is simply "no settings". Unknown or invalid fields are dropped. */
export function readVaultConfig(notesDir: string): VaultConfig {
  try {
    const raw = JSON.parse(fs.readFileSync(vaultConfigPath(notesDir), 'utf8')) as unknown;
    if (typeof raw !== 'object' || raw === null) return {};
    const out: VaultConfig = {};
    const r = raw as Record<string, unknown>;
    if (isValidRetentionDays(r.trashRetentionDays)) out.trashRetentionDays = r.trashRetentionDays;
    return out;
  } catch {
    return {};
  }
}

/** Merge `patch` into the file (atomically). Invalid values throw, they are never written. */
export function writeVaultConfig(notesDir: string, patch: VaultConfig): VaultConfig {
  if (patch.trashRetentionDays !== undefined && !isValidRetentionDays(patch.trashRetentionDays)) {
    throw new Error(`trashRetentionDays must be a whole number from 0 to ${MAX_TRASH_RETENTION_DAYS}`);
  }
  const next: VaultConfig = { ...readVaultConfig(notesDir), ...patch };
  const file = vaultConfigPath(notesDir);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.${crypto.randomBytes(6).toString('hex')}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(next, null, 2) + '\n', 'utf8');
  fs.renameSync(tmp, file);
  return next;
}
