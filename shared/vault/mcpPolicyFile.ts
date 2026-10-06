/** Reading and writing the agent policy file of a vault (see mcpPolicy.ts). Node only. */
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as crypto from 'node:crypto';
import { DEFAULT_POLICY, parsePolicy, serializePolicy, type McpPolicy } from './mcpPolicy';

export const policyPath = (notesDir: string): string => path.join(notesDir, '.noted', 'mcp-policy.yaml');

export type LoadedPolicy = { ok: true; policy: McpPolicy; present: boolean } | { ok: false; error: string };

/** The vault's policy: the default when there is no file; an error (never a guess) when it cannot be read or understood. */
export function loadPolicy(notesDir: string): LoadedPolicy {
  let text: string;
  try {
    text = fs.readFileSync(policyPath(notesDir), 'utf8');
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return { ok: true, policy: { ...DEFAULT_POLICY, folders: {} }, present: false };
    return { ok: false, error: `.noted/mcp-policy.yaml cannot be read (${(err as Error).message})` };
  }
  const parsed = parsePolicy(text);
  return parsed.ok ? { ok: true, policy: parsed.policy, present: true } : { ok: false, error: `.noted/mcp-policy.yaml is invalid: ${parsed.error}` };
}

/** Write the policy atomically; the default policy removes the file (a vault that sets nothing has nothing). */
export function savePolicy(notesDir: string, policy: McpPolicy): void {
  const file = policyPath(notesDir);
  const check = parsePolicy(serializePolicy(policy)); // what is written must read back as what was meant
  if (!check.ok) throw new Error(check.error);
  if (check.policy.default === DEFAULT_POLICY.default && Object.keys(check.policy.folders).length === 0) {
    fs.rmSync(file, { force: true });
    return;
  }
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.${crypto.randomBytes(6).toString('hex')}.tmp`;
  fs.writeFileSync(tmp, serializePolicy(check.policy), 'utf8');
  fs.renameSync(tmp, file);
}

/** The policy file's modification time and size, to tell a change cheaply ('' when there is no file). */
export function policyStamp(notesDir: string): string {
  try {
    const stat = fs.statSync(policyPath(notesDir));
    return `${stat.mtimeMs}:${stat.size}`;
  } catch { return ''; }
}
