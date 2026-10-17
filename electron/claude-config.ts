import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { withNotedServer, type McpServerEntry } from '../shared/mcp/clientConfig';

export type ClaudeConfigResult = { ok: true; backup: string | null } | { ok: false; reason: 'invalid' };

/**
 * Add the Noted server to Claude Desktop's claude_desktop_config.json. The file is Claude Desktop's: one that cannot be
 * read as a JSON object is left untouched (`invalid`), the previous text is kept beside it as `.bak` before it changes,
 * and the new text is written to a temporary sibling and renamed into place, so an interruption never leaves it torn.
 */
export function writeClaudeConfig(configPath: string, entry: McpServerEntry): ClaudeConfigResult {
  let raw: string | null = null;
  try {
    raw = fs.readFileSync(configPath, 'utf8');
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== 'ENOENT') throw err;
  }
  const next = withNotedServer(raw, entry);
  if (next === null) return { ok: false, reason: 'invalid' };
  if (raw === next) return { ok: true, backup: null };

  fs.mkdirSync(path.dirname(configPath), { recursive: true });
  let backup: string | null = null;
  if (raw !== null) {
    backup = `${configPath}.bak`;
    fs.writeFileSync(backup, raw, 'utf8');
  }
  const tmp = `${configPath}.${process.pid}.${crypto.randomBytes(6).toString('hex')}.tmp`;
  try {
    fs.writeFileSync(tmp, next, 'utf8');
    fs.renameSync(tmp, configPath);
  } catch (err) {
    fs.rmSync(tmp, { force: true });
    throw err;
  }
  return { ok: true, backup };
}
