/**
 * What agents (MCP clients) may reach in a vault: the policy file `.noted/mcp-policy.yaml`.
 *
 *     default: read-only        # read-write when the file says nothing
 *     folders:
 *       private: hidden         # not listed, not read, not searched, not written: as if it were not there
 *       drafts: staged          # can be read; a change is held for the user to approve, then made
 *       inbox: read-write
 *
 * The most specific folder wins (`inbox/drafts` over `inbox`); case and Unicode form do not matter. This module is the
 * rules only (parse, write, decide); the server and the app both use it, so what Settings shows is what the server enforces.
 * A policy that cannot be read is not guessed at: the caller is told, and treats every note as out of reach.
 */
import { parse as parseYaml, stringify as stringifyYaml } from 'yaml';

export const ACCESS_LEVELS = ['hidden', 'read-only', 'staged', 'read-write'] as const;
export type Access = (typeof ACCESS_LEVELS)[number];

export interface McpPolicy {
  default: Access;
  /** Folder (normalized: lower case, `/` separators, no outer slashes) -> access. */
  folders: Record<string, Access>;
}

export const DEFAULT_POLICY: McpPolicy = { default: 'read-write', folders: {} };
export const MAX_POLICY_FOLDERS = 200;

const RANK: Record<Access, number> = { hidden: 0, 'read-only': 1, staged: 2, 'read-write': 3 };
export const isAccess = (v: unknown): v is Access => typeof v === 'string' && (ACCESS_LEVELS as readonly string[]).includes(v);

/** The less access of two. */
export const lessAccess = (a: Access, b: Access): Access => (RANK[a] <= RANK[b] ? a : b);
export const canRead = (a: Access): boolean => a !== 'hidden';
/** May change the note at once. */
export const canWrite = (a: Access): boolean => a === 'read-write';
/** May propose a change that the user approves before it is made. */
export const isStaged = (a: Access): boolean => a === 'staged';

/** How a folder or note path is compared: `\` as `/`, no outer slashes, Unicode-normalized, lower case. */
export function normalizePolicyPath(p: string): string {
  return p.normalize('NFC').replace(/\\/g, '/').replace(/^\/+|\/+$/g, '').replace(/\/{2,}/g, '/').toLowerCase();
}

export type PolicyResult = { ok: true; policy: McpPolicy } | { ok: false; error: string };

/** Read the text of a policy file. An empty file is the default policy; anything unknown or malformed is an error, never ignored. */
export function parsePolicy(text: string): PolicyResult {
  let raw: unknown;
  try { raw = parseYaml(text, { maxAliasCount: 10 }); } catch (err) { return { ok: false, error: `not valid YAML (${(err as Error).message.split('\n')[0]})` }; }
  if (raw === null || raw === undefined) return { ok: true, policy: { ...DEFAULT_POLICY, folders: {} } };
  if (typeof raw !== 'object' || Array.isArray(raw)) return { ok: false, error: 'it must be a mapping with `default` and `folders`' };
  const top = raw as Record<string, unknown>;
  for (const key of Object.keys(top)) {
    if (key !== 'default' && key !== 'folders') return { ok: false, error: `unknown key "${key}" (expected default and folders)` };
  }
  let def: Access = DEFAULT_POLICY.default;
  if (top.default !== undefined) {
    if (!isAccess(top.default)) return { ok: false, error: `default must be one of ${ACCESS_LEVELS.join(', ')}` };
    def = top.default;
  }
  const folders: Record<string, Access> = {};
  if (top.folders !== undefined && top.folders !== null) {
    if (typeof top.folders !== 'object' || Array.isArray(top.folders)) return { ok: false, error: 'folders must be a mapping of folder to access' };
    const entries = Object.entries(top.folders as Record<string, unknown>);
    if (entries.length > MAX_POLICY_FOLDERS) return { ok: false, error: `at most ${MAX_POLICY_FOLDERS} folders` };
    for (const [folder, access] of entries) {
      const key = normalizePolicyPath(folder);
      if (!key || key.split('/').some(s => s === '' || s === '.' || s === '..')) return { ok: false, error: `"${folder}" is not a folder path` };
      if (!isAccess(access)) return { ok: false, error: `"${folder}": access must be one of ${ACCESS_LEVELS.join(', ')}` };
      if (key in folders && folders[key] !== access) return { ok: false, error: `"${folder}" is given two different accesses` };
      folders[key] = access;
    }
  }
  return { ok: true, policy: { default: def, folders } };
}

/** The access a note has under the policy: that of the longest folder (or the note itself) that contains it, else the default. */
export function accessFor(policy: McpPolicy, notePath: string): Access {
  const note = normalizePolicyPath(notePath);
  let best = '';
  let access = policy.default;
  for (const [folder, level] of Object.entries(policy.folders)) {
    const inside = note === folder || note.startsWith(`${folder}/`);
    if (inside && folder.length >= best.length) { best = folder; access = level; }
  }
  return access;
}

/** The file's text for a policy: stable order (default first, folders by name), ready to be read back by `parsePolicy`. */
export function serializePolicy(policy: McpPolicy): string {
  const folders = Object.fromEntries(Object.entries(policy.folders).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)));
  const header = '# Which parts of the vault agents (MCP clients) can reach. Changes apply to the next request.\n';
  return header + stringifyYaml({ default: policy.default, ...(Object.keys(folders).length > 0 ? { folders } : {}) });
}
