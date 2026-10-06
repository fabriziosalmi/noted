/**
 * Noted MCP Server — exposes Noted notes as MCP tools so any MCP-compatible
 * LLM client (Claude Code, Claude Desktop, …) can read and write notes on
 * the user's behalf.
 *
 * Transport: stdio (no open ports, no auth needed).
 *
 * Usage:
 *   node dist-mcp/index.cjs [--notes-dir /path/to/notes]
 *
 * If --notes-dir is omitted the server auto-detects the production Noted data
 * directory for the platform:
 *   macOS    ~/Library/Application Support/Noted/notes
 *   Windows  %APPDATA%\Noted\notes
 *   Linux    ~/.config/Noted/notes
 * falling back to ~/Documents/Noted if the first path does not exist.
 */

import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { SSEServerTransport } from '@modelcontextprotocol/sdk/server/sse.js';
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
  type Tool,
  McpError,
  ErrorCode,
} from '@modelcontextprotocol/sdk/types.js';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import * as crypto from 'node:crypto';
import * as http from 'node:http';
import { URL } from 'node:url';
import { marked } from 'marked';
import { stripUnsafeHtml } from '../shared/security/htmlPolicy.node.js';
import { extractMarkdownFrontmatter, prependFrontmatterComment } from '../shared/markdown/frontmatter.js';
import { InvertedIndex } from '../shared/search/invertedIndex.js';
import {
  readAgentMetadata,
  writeAgentMetadata,
  advance,
  approveGate,
  rejectGate,
  applyTaskStatusToWorkflow,
  AgentEngineError,
  type AgentMetadata,
  type EngineContext,
  type EngineResult,
} from '../shared/agent/index.js';
import pkg from '../package.json';
import { moveToTrash, listTrash, restoreFromTrash, purgeTrash, parseRetentionDays, DEFAULT_RETENTION_DAYS, TrashError } from './trash';
import { readVaultConfig } from '../shared/vault-config.js';
import { accessFor, canRead, canWrite, lessAccess, type Access, type McpPolicy } from '../shared/vault/mcpPolicy.js';
import { loadPolicy, policyStamp, type LoadedPolicy } from '../shared/vault/mcpPolicyFile.js';
import { isMigrationLocked, readVaultFormat } from '../shared/vault/formatFile.js';
import { checkFolderPath, checkNotePath } from '../shared/vault/paths.js';
import { walkVaultSync } from '../shared/vault/walk.js';
import type { NoteFormat } from '../shared/vault/format.js';
import type { DomEnv } from '../shared/markdown/html.js';
import { appendStored, describeStored, etagOf, storedToText, toStored, type StorageDeps } from './storage';
import { extractTasks, withoutTaskLines } from '../shared/tasks/parse.js';
import { queryTasks, localDay, type NoteTask, type TaskFilter } from '../shared/tasks/query.js';
import { extractTags } from '../shared/vault/extract.js';
import { appendToSectionBody, findSection, replaceSectionBody } from '../shared/markdown/sections.js';
import { parseFrontmatterBlock } from '../shared/markdown/yamlFrontmatter.js';
import { extractMarkdownFrontmatter as splitFront } from '../shared/markdown/frontmatter.js';

// ─── Notes-directory resolution ───────────────────────────────────────────────

// ─── Timestamp formatting ─────────────────────────────────────────────────────

/**
 * Render a timestamp in the machine's local timezone.
 *
 * `toISOString()` renders UTC while looking local, which shows a note written
 * at 00:36 CEST as 22:36 the day before — wrong twice over when the question
 * being answered is "which note did I touch today".
 */
export function formatLocal(d: Date, withTime = false): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  const date = `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  if (!withTime) return date;
  return `${date} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
}

/**
 * Where Noted keeps its default vault, per platform — the same directory
 * Electron's `app.getPath('userData')` resolves to, plus `/notes`.
 *
 * Exported and fully parameterised so the resolution order is testable off the
 * platform it describes.
 */
export function defaultNotesDirCandidates(
  home: string,
  platform: NodeJS.Platform,
  appData?: string,
): string[] {
  const userData =
    platform === 'darwin' ? path.join(home, 'Library', 'Application Support', 'Noted')
    : platform === 'win32' ? path.join(appData || path.join(home, 'AppData', 'Roaming'), 'Noted')
    : path.join(home, '.config', 'Noted');
  return [path.join(userData, 'notes'), path.join(home, 'Documents', 'Noted')];
}

export function resolveNotesDir(): string {
  // Accept --notes-dir <path> or --notes-dir=<path>
  const argv = process.argv.slice(2);
  const eqIdx = argv.findIndex(a => a.startsWith('--notes-dir='));
  if (eqIdx !== -1) return path.resolve(argv[eqIdx].slice('--notes-dir='.length));
  const spaceIdx = argv.indexOf('--notes-dir');
  if (spaceIdx !== -1 && argv[spaceIdx + 1]) return path.resolve(argv[spaceIdx + 1]);

  const candidates = defaultNotesDirCandidates(os.homedir(), process.platform, process.env.APPDATA);
  return candidates.find(p => fs.existsSync(p)) ?? candidates[0];
}

const NOTES_DIR = resolveNotesDir();

/**
 * How long trashed notes are kept, in whole days (0 = until removed by hand).
 * Resolved on every use so a change made in the app applies without restarting
 * this server. Precedence: `--trash-retention-days N`, then
 * NOTED_MCP_TRASH_RETENTION_DAYS, then the vault's `.noted/config.json` (written
 * by the app's settings), then 30.
 */
export function trashRetentionDays(): number {
  const argv = process.argv.slice(2);
  const eq = argv.find(a => a.startsWith('--trash-retention-days='));
  const i = argv.indexOf('--trash-retention-days');
  const explicit = eq ? eq.slice('--trash-retention-days='.length) : i !== -1 ? argv[i + 1] : process.env.NOTED_MCP_TRASH_RETENTION_DAYS;
  if (explicit !== undefined && explicit.trim() !== '') return parseRetentionDays(explicit);
  return readVaultConfig(NOTES_DIR).trashRetentionDays ?? DEFAULT_RETENTION_DAYS;
}

// ─── Path security ────────────────────────────────────────────────────────────

/** Validates a note name and throws McpError (InvalidParams) on failure. Any depth; the rules are shared/vault/paths.ts's. */
export function validateNoteName(name: unknown): asserts name is string {
  const problem = checkNotePath(name, 'Note name');
  if (problem) throw new McpError(ErrorCode.InvalidParams, problem);
}

/** Validates a folder path (any depth) given to a read-only tool, such as list_notes. */
export function validateFolderPath(folder: unknown): asserts folder is string {
  const problem = checkFolderPath(folder, 'Folder name');
  if (problem) throw new McpError(ErrorCode.InvalidParams, problem);
}

/** Validates a folder name and throws McpError (InvalidParams) on failure. */
export function validateFolderName(name: unknown): asserts name is string {
  if (typeof name !== 'string' || !name.trim()) {
    throw new McpError(ErrorCode.InvalidParams, 'Folder name must be a non-empty string');
  }
  if (name.includes('..') || name.includes('/') || name.includes('\\')) {
    throw new McpError(ErrorCode.InvalidParams, 'Folder name must not contain "..", slashes, or backslashes');
  }
  // eslint-disable-next-line no-control-regex
  if (/[\x00-\x1F\x7F\\/:*?"<>|;`$]/.test(name)) {
    throw new McpError(
      ErrorCode.InvalidParams,
      'Folder name contains invalid characters: reserved characters (\\ / : * ? " < > | ; ` $) are not allowed',
    );
  }
}

/** Returns the absolute path to a note, validated to stay inside NOTES_DIR. */
export function safeNotePath(name: string): string {
  validateNoteName(name);
  const root = path.resolve(NOTES_DIR);
  const rootReal = fs.existsSync(root) ? fs.realpathSync(root) : root;
  const target = path.resolve(root, name);

  // Resolve the physical path of the nearest part of the target that exists, so a symbolic link anywhere on the way
  // (a folder that points outside the vault, however many levels above the new file) cannot carry a write out of the
  // vault. The names below it do not exist yet, so they cannot be links. A link that points nowhere is refused.
  let existing = target;
  const missing: string[] = [];
  for (;;) {
    try { fs.lstatSync(existing); break; } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== 'ENOENT') throw new McpError(ErrorCode.InvalidParams, 'Path traversal detected');
      const parent = path.dirname(existing);
      if (parent === existing) break;
      missing.unshift(path.basename(existing));
      existing = parent;
    }
  }
  let resolved: string;
  try { resolved = path.join(fs.realpathSync(existing), ...missing); } catch { throw new McpError(ErrorCode.InvalidParams, 'Path traversal detected'); }

  if (resolved !== rootReal && !resolved.startsWith(rootReal + path.sep)) {
    throw new McpError(ErrorCode.InvalidParams, 'Path traversal detected');
  }
  return resolved;
}

// ─── Agent access policy (.noted/mcp-policy.yaml) ─────────────────────────────

let policyCache: { stamp: string; result: LoadedPolicy } | null = null;

/** The vault's policy, read again whenever its file changes. A policy that cannot be read is an error, never a guess. */
function currentPolicy(): McpPolicy {
  const stamp = policyStamp(NOTES_DIR);
  if (!policyCache || policyCache.stamp !== stamp) policyCache = { stamp, result: loadPolicy(NOTES_DIR) };
  if (!policyCache.result.ok) {
    throw new McpError(ErrorCode.InternalError, `${policyCache.result.error}. No note can be reached until it is fixed (Settings → MCP, or delete the file).`);
  }
  return policyCache.result.policy;
}

/** What agents may do with a note: what the policy says of its name, and of where it really is (a link cannot lead out of a scope). */
export function accessTo(name: string, resolved?: string): Access {
  const policy = currentPolicy();
  let access = accessFor(policy, name);
  if (resolved !== undefined) {
    const root = path.resolve(NOTES_DIR);
    const rootReal = fs.existsSync(root) ? fs.realpathSync(root) : root;
    access = lessAccess(access, accessFor(policy, path.relative(rootReal, resolved)));
  }
  return access;
}

/**
 * The file of a note for a tool, after the policy: a note agents cannot read is reported as not there at all (nothing
 * tells it exists); one they can read but not write says it is read-only. `create` says "not allowed" for a hidden place
 * instead, since the note does not exist to be missing.
 */
function guardedPath(name: string, need: 'read' | 'write' | 'create'): string {
  const file = safeNotePath(name);
  const access = accessTo(name, file);
  if (!canRead(access)) {
    throw new McpError(ErrorCode.InvalidParams, need === 'create'
      ? `Not allowed: agents cannot write ${name} (vault policy)`
      : `Note not found: ${name}`);
  }
  if (need !== 'read' && !canWrite(access)) {
    throw new McpError(ErrorCode.InvalidParams, `Not allowed: ${name} is read-only for agents (vault policy)`);
  }
  return file;
}


// ─── Markdown → HTML (marked-powered) ───────────────────────────────────────

/**
 * marked renders a GFM task list as `<li><p><input type="checkbox"> text</p></li>`
 * inside a plain `<ul>`. The editor's TaskList extension only recognises its own
 * shape (`<ul data-type="taskList"><li data-type="taskItem" data-checked>…`), so
 * without this a checklist written through MCP opens as inert, disabled boxes.
 * Rewrite marked's output into that shape so the checkboxes are interactive.
 */
export function taskListsToTiptap(html: string): string {
  // marked wraps items in <p> for "loose" lists and omits it for "tight" ones,
  // so both the <p> and its close are optional here.
  const withItems = html.replace(
    /<li>\s*(?:<p>\s*)?<input([^>]*?)type="checkbox"([^>]*?)>\s*([\s\S]*?)(?:<\/p>)?\s*<\/li>/g,
    (_m, pre: string, post: string, text: string) => {
      const checked = /\bchecked\b/.test(pre) || /\bchecked\b/.test(post);
      return `<li data-type="taskItem" data-checked="${checked}"><label><input type="checkbox"${checked ? ' checked' : ''}><span></span></label><div><p>${text.trim()}</p></div></li>`;
    },
  );
  // Flag every <ul> that now holds a taskItem as a taskList.
  return withItems.replace(
    /<ul>((?:(?!<\/ul>)[\s\S])*?data-type="taskItem"(?:(?!<\/ul>)[\s\S])*?)<\/ul>/g,
    '<ul data-type="taskList">$1</ul>',
  );
}

export function markdownToHtml(md: string): string {
  return taskListsToTiptap(marked.parse(md, { breaks: true, gfm: true, async: false }) as string);
}

// ─── HTML sanitisation (mirrors electron/ipc-utils.ts) ───────────────────────

export { stripUnsafeHtml };

// ─── Markdown → HTML conversion ───────────────────────────────────────────────

export function toHtml(content: string): string {
  const trimmed = content.trimStart();
  // If the content already looks like HTML, sanitise and return as-is
  if (trimmed.startsWith('<')) {
    return stripUnsafeHtml(content);
  }
  const { frontmatter, body } = extractMarkdownFrontmatter(content);
  const sanitizedBody = stripUnsafeHtml(markdownToHtml(body));
  return prependFrontmatterComment(sanitizedBody, frontmatter);
}

// ─── Plain-text extraction ────────────────────────────────────────────────────

export function htmlToText(html: string): string {
  return html
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/p>/gi, '\n')
    .replace(/<\/li>/gi, '\n')
    .replace(/<\/h[1-6]>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

// ─── Vault format (ADR 0001) ──────────────────────────────────────────────────

/** How this vault stores its notes: the app and this server both go by the vault's marker file. */
export function vaultFormat(): NoteFormat {
  return readVaultFormat(NOTES_DIR);
}

let domEnv: DomEnv | null = null;

/** A DOM for converting HTML a client sent to a Markdown vault; jsdom is slow to load, so only when needed. */
async function loadDom(): Promise<DomEnv> {
  if (!domEnv) {
    const { JSDOM } = await import('jsdom');
    const { window } = new JSDOM('<!doctype html><html><body></body></html>');
    domEnv = { document: window.document, DOMParser: window.DOMParser as unknown as typeof DOMParser };
  }
  return domEnv;
}

const storage: StorageDeps = { toHtml, htmlToText, stripUnsafeHtml, dom: loadDom };

/** What to write for text a client sent, in the vault's format. */
const toStoredNote = (content: string): Promise<string> => toStored(content, vaultFormat(), storage);
const appendToStored = (existing: string, addition: string): Promise<string> => appendStored(existing, addition, vaultFormat(), storage);
const noteText = (stored: string, format: NoteFormat = vaultFormat()): string => storedToText(stored, format, storage);

/** The app is converting the vault between formats: a note written now could be missed or written in the old one. */
function assertNotMigrating(): void {
  if (isMigrationLocked(NOTES_DIR)) {
    throw new McpError(ErrorCode.InternalError, 'The vault is being converted to another note format. Try again in a minute.');
  }
}

// ─── Atomic file write ────────────────────────────────────────────────────────

function atomicWrite(filePath: string, content: string): void {
  assertNotMigrating();
  const dir = path.dirname(filePath);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  const tmp = filePath + '.' + crypto.randomBytes(6).toString('hex') + '.tmp';
  fs.writeFileSync(tmp, content, 'utf8');
  fs.renameSync(tmp, filePath); // atomic on same filesystem
}

// ─── Note listing ─────────────────────────────────────────────────────────────

interface NoteEntry {
  name: string;      // e.g. "folder/note.md" or "note.md"
  mtime: Date;
  size: number;
}

function listAllNotes(folder?: string): NoteEntry[] {
  if (!fs.existsSync(NOTES_DIR)) return [];

  // Every note at any depth: never a hidden folder, never a symbolic link, never a name the other tools would refuse.
  const entries: NoteEntry[] = [];
  const policy = currentPolicy();
  for (const name of walkVaultSync(NOTES_DIR).notes) {
    if (!canRead(accessFor(policy, name))) continue; // a note agents may not see is not even looked at
    try {
      const stat = fs.statSync(path.join(NOTES_DIR, name));
      entries.push({ name, mtime: stat.mtime, size: stat.size });
    } catch { /* gone since it was listed */ }
  }
  entries.sort((a, b) => b.mtime.getTime() - a.mtime.getTime());

  if (folder) {
    // A folder means everything under it, sub-folders included.
    const normalized = folder.replace(/\/$/, '');
    return entries.filter(n => n.name.startsWith(`${normalized}/`));
  }
  return entries;
}

// ─── Full-text search index (shared BM25) ─────────────────────────────────────

// The same bounds as the app's own index (electron/fulltext-index.ts): measured at 10,000 notes (25 MB) the whole
// scan takes about a second and search answers in under 10 ms (bench/index-scale.bench.ts).
const FT_MAX_FILES = 20_000;
const FT_MAX_TOTAL_BYTES = 200 * 1024 * 1024;
const FT_MAX_FILE_BYTES = 20 * 1024 * 1024;
const INDEX_STALE_MS = 30_000;

let searchIndex: InvertedIndex | null = null;
let indexScannedAt = 0;
let indexPolicyStamp: string | null = null;

// Lazily bring the index up to date once per staleness window instead of on every query. After the first build only
// the notes whose modification time moved are read again, so a refresh of a big vault costs a stat per note, not a
// read per note. Incremental hooks on create/update/delete keep a warm (SSE-session) index fresh; the staleness
// window catches external edits.
function ensureSearchIndex(): InvertedIndex {
  const now = Date.now();
  // A change to the policy takes effect at once: never serve what the index holds from before it.
  const stamp = policyStamp(NOTES_DIR);
  if (searchIndex && now - indexScannedAt < INDEX_STALE_MS && stamp === indexPolicyStamp) return searchIndex;
  const idx = searchIndex ?? new InvertedIndex();
  const format = vaultFormat();
  const wanted = new Set<string>();
  let totalBytes = 0;
  for (const note of listAllNotes()) { // newest first, so the bounds keep the most recent notes
    if (wanted.size >= FT_MAX_FILES) break;
    if (note.size > FT_MAX_FILE_BYTES) continue;
    if ((totalBytes += note.size) > FT_MAX_TOTAL_BYTES) break;
    wanted.add(note.name);
    if (idx.getDoc(note.name)?.mtimeMs === note.mtime.getTime()) continue;
    try {
      const html = fs.readFileSync(safeNotePath(note.name), 'utf8');
      idx.add({ id: note.name, title: note.name, text: noteText(html, format), mtimeMs: note.mtime.getTime() });
    } catch { /* skip unreadable */ }
  }
  for (const id of idx.ids()) if (!wanted.has(id)) idx.remove(id);
  searchIndex = idx;
  indexScannedAt = now;
  indexPolicyStamp = stamp;
  return idx;
}

// Keep a live index in sync after a mutation (no-op until the index is built).
function indexUpsert(name: string, html: string): void {
  if (!canRead(accessFor(currentPolicy(), name))) return;
  searchIndex?.add({ id: name, title: name, text: noteText(html), mtimeMs: Date.now() });
}
function indexRemove(name: string): void {
  searchIndex?.remove(name);
}

/** Test seam: force a rebuild on the next search (tests mutate mockFiles directly). */
export function __resetSearchIndex(): void {
  searchIndex = null;
  indexScannedAt = 0;
  indexPolicyStamp = null;
  policyCache = null;
}

// ─── Excerpt helper ───────────────────────────────────────────────────────────

export function excerpt(text: string, query: string, windowChars = 120): string {
  const lower = text.toLowerCase();
  const idx = lower.indexOf(query.toLowerCase());
  if (idx === -1) return text.slice(0, windowChars).replace(/\s+$/, '') + '…';
  const start = Math.max(0, idx - 40);
  const end = Math.min(text.length, idx + query.length + 80);
  const snip = text.slice(start, end).replace(/\s+/g, ' ').trim();
  return (start > 0 ? '…' : '') + snip + (end < text.length ? '…' : '');
}

const TOOL_NAME = {
  LIST_NOTES: 'list_notes',
  READ_NOTE: 'read_note',
  CREATE_NOTE: 'create_note',
  UPDATE_NOTE: 'update_note',
  EDIT_NOTE: 'edit_note',
  LIST_TASKS: 'list_tasks',
  SEARCH_NOTES: 'search_notes',
  DELETE_NOTE: 'delete_note',
  RESTORE_NOTE: 'restore_note',
  LIST_TRASH: 'list_trash',
  CREATE_AGENT_WORKFLOW: 'create_agent_workflow',
  APPEND_AGENT_EVENT: 'append_agent_event',
  ADVANCE_AGENT_STATE: 'advance_agent_state',
  APPROVE_AGENT_GATE: 'approve_agent_gate',
  REJECT_AGENT_GATE: 'reject_agent_gate',
} as const;

type ToolName = (typeof TOOL_NAME)[keyof typeof TOOL_NAME];

type AgentApprovalMode = 'autonomous' | 'plan' | 'action' | 'review' | 'release' | 'manual';

interface AgentTaskInput {
  id: string;
  title: string;
  parent_id?: string;
  depends_on?: string[];
}

interface AgentWorkflowFile {
  name: string;
  content: string;
}

const AGENT_APPROVAL_MODES = new Set<AgentApprovalMode>([
  'autonomous',
  'plan',
  'action',
  'review',
  'release',
  'manual',
]);

function validateAgentId(value: unknown, label: string): string {
  if (typeof value !== 'string' || !value.trim()) {
    throw new McpError(ErrorCode.InvalidParams, `${label} must be a non-empty string`);
  }
  const id = value.trim();
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/.test(id)) {
    throw new McpError(
      ErrorCode.InvalidParams,
      `${label} must use only letters, numbers, dots, underscores, or dashes, and must start with a letter or number`,
    );
  }
  return id;
}

function validateNonEmptyString(value: unknown, label: string): string {
  if (typeof value !== 'string' || !value.trim()) {
    throw new McpError(ErrorCode.InvalidParams, `${label} must be a non-empty string`);
  }
  return value.trim();
}

function slugify(value: string, fallback: string): string {
  const slug = value
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 48);
  return slug || fallback;
}

function codeBlockJson(value: unknown): string {
  return ['```json', JSON.stringify(value, null, 2), '```'].join('\n');
}

function agentMetadataBlock(value: unknown): string {
  return ['## Agent Metadata', codeBlockJson(value)].join('\n\n');
}

function parseAgentTasks(value: unknown): AgentTaskInput[] {
  if (value === undefined) {
    return [{ id: 'T001', title: 'Define plan and acceptance criteria' }];
  }
  if (!Array.isArray(value)) {
    throw new McpError(ErrorCode.InvalidParams, 'tasks must be an array when provided');
  }
  if (value.length === 0) {
    return [{ id: 'T001', title: 'Define plan and acceptance criteria' }];
  }

  const seen = new Set<string>();
  return value.map((item, index) => {
    if (!item || typeof item !== 'object') {
      throw new McpError(ErrorCode.InvalidParams, `tasks[${index}] must be an object`);
    }
    const raw = item as Record<string, unknown>;
    const id = validateAgentId(raw.id, `tasks[${index}].id`);
    if (seen.has(id)) {
      throw new McpError(ErrorCode.InvalidParams, `duplicate task id: ${id}`);
    }
    seen.add(id);

    const task: AgentTaskInput = {
      id,
      title: validateNonEmptyString(raw.title, `tasks[${index}].title`),
    };
    if (raw.parent_id !== undefined) {
      task.parent_id = validateAgentId(raw.parent_id, `tasks[${index}].parent_id`);
    }
    if (raw.depends_on !== undefined) {
      if (!Array.isArray(raw.depends_on)) {
        throw new McpError(ErrorCode.InvalidParams, `tasks[${index}].depends_on must be an array`);
      }
      task.depends_on = raw.depends_on.map((dep, depIndex) =>
        validateAgentId(dep, `tasks[${index}].depends_on[${depIndex}]`),
      );
    }
    return task;
  });
}

export function buildAgentWorkflowFiles(args: Record<string, unknown>): AgentWorkflowFile[] {
  const folder = validateNonEmptyString(args.folder, 'folder');
  validateFolderName(folder);
  const workflowId = validateAgentId(args.workflow_id, 'workflow_id');
  const title = validateNonEmptyString(args.title, 'title');
  const goal = validateNonEmptyString(args.goal, 'goal');
  const approvalMode = args.approval_mode === undefined
    ? 'plan'
    : validateNonEmptyString(args.approval_mode, 'approval_mode');
  if (!AGENT_APPROVAL_MODES.has(approvalMode as AgentApprovalMode)) {
    throw new McpError(
      ErrorCode.InvalidParams,
      `approval_mode must be one of: ${Array.from(AGENT_APPROVAL_MODES).join(', ')}`,
    );
  }
  const tasks = parseAgentTasks(args.tasks);
  const now = new Date().toISOString();
  const workflowSlug = slugify(title, 'workflow');
  const workflowNote = `${folder}/wf-${workflowId}-${workflowSlug}.md`;
  const taskFiles = new Map<string, string>();

  for (const task of tasks) {
    taskFiles.set(task.id, `${folder}/task-${task.id}-${slugify(task.title, 'task')}.md`);
  }

  const workflowMeta = {
    notedAgent: true,
    schemaVersion: 1,
    type: 'workflow',
    id: workflowId,
    title,
    status: 'draft',
    approvalMode,
    createdAt: now,
    updatedAt: now,
    files: {
      runs: `${folder}/runs-${workflowId}.md`,
      reviews: `${folder}/reviews-${workflowId}.md`,
      output: `${folder}/output-${workflowId}.md`,
    },
    tasks: tasks.map(task => ({
      id: task.id,
      title: task.title,
      parentId: task.parent_id ?? null,
      dependsOn: task.depends_on ?? [],
      file: taskFiles.get(task.id),
      status: 'todo',
    })),
  };

  const workflowMd = [
    `# ${workflowId} ${title}`,
    '',
    '## Goal',
    goal,
    '',
    '## Workflow Tree',
    ...tasks.map(task => {
      const indent = task.parent_id ? '  -' : '-';
      const deps = task.depends_on?.length ? ` depends on ${task.depends_on.join(', ')}` : '';
      return `${indent} [ ] ${task.id} ${task.title}${deps} -> ${taskFiles.get(task.id)}`;
    }),
    '',
    '## State',
    '- status: draft',
    `- approval: ${approvalMode}`,
    '- next: plan approval or task execution',
    '',
    '## Event Log',
    '- No events yet.',
    '',
    agentMetadataBlock(workflowMeta),
  ].join('\n');

  const files: AgentWorkflowFile[] = [
    { name: workflowNote, content: workflowMd },
  ];

  for (const task of tasks) {
    const taskMeta = {
      notedAgent: true,
      schemaVersion: 1,
      type: 'task',
      id: task.id,
      workflowId,
      parentId: task.parent_id ?? null,
      dependsOn: task.depends_on ?? [],
      status: 'todo',
      owner: null,
      createdAt: now,
      updatedAt: now,
    };
    files.push({
      name: taskFiles.get(task.id)!,
      content: [
        `# ${task.id} ${task.title}`,
        '',
        '## Goal',
        '',
        '## Acceptance Criteria',
        '- [ ] Define expected output.',
        '- [ ] Record evidence in runs or reviews.',
        '',
        '## Steps',
        '- [ ] Plan',
        '- [ ] Execute',
        '- [ ] Review',
        '',
        '## Evidence',
        '- runs: none',
        '- reviews: none',
        '',
        '## Event Log',
        '- No events yet.',
        '',
        agentMetadataBlock(taskMeta),
      ].join('\n'),
    });
  }

  files.push(
    {
      name: `${folder}/runs-${workflowId}.md`,
      content: [
        `# Runs ${workflowId}`,
        '',
        'Append command executions here with cwd, sandbox, timeout, exit code, and summarized output.',
        '',
        '## Event Log',
        '- No runs yet.',
        '',
        agentMetadataBlock({
          notedAgent: true,
          schemaVersion: 1,
          type: 'runs',
          workflowId,
          status: 'empty',
          createdAt: now,
          updatedAt: now,
        }),
      ].join('\n'),
    },
    {
      name: `${folder}/reviews-${workflowId}.md`,
      content: [
        `# Reviews ${workflowId}`,
        '',
        'Append model or human reviews here. Include scope, findings, severity, and required fixes.',
        '',
        '## Event Log',
        '- No reviews yet.',
        '',
        agentMetadataBlock({
          notedAgent: true,
          schemaVersion: 1,
          type: 'reviews',
          workflowId,
          status: 'empty',
          createdAt: now,
          updatedAt: now,
        }),
      ].join('\n'),
    },
    {
      name: `${folder}/output-${workflowId}.md`,
      content: [
        `# Output Check ${workflowId}`,
        '',
        '## Acceptance Check',
        '- [ ] Goal satisfied',
        '- [ ] Tests or evidence recorded',
        '- [ ] Review gate passed or explicitly waived',
        '- [ ] Final approval recorded if required',
        '',
        '## Event Log',
        '- No output checks yet.',
        '',
        agentMetadataBlock({
          notedAgent: true,
          schemaVersion: 1,
          type: 'output',
          workflowId,
          status: 'pending',
          createdAt: now,
          updatedAt: now,
        }),
      ].join('\n'),
    },
  );

  return files;
}

// ─── Tool definitions ─────────────────────────────────────────────────────────

const TOOLS: Tool[] = [
  {
    name: TOOL_NAME.LIST_NOTES,
    description:
      'List all notes stored in the Noted app, sorted by last-modified date (newest first). ' +
      'Returns note names including any subfolder prefix (e.g. "Lavoro/meeting.md"). ' +
      'Optionally filter by folder name.',
    inputSchema: {
      type: 'object',
      properties: {
        folder: {
          type: 'string',
          description: 'Restrict results to a folder and everything under it (e.g. "Lavoro" or "Lavoro/Q4"). Omit to list all notes.',
        },
      },
      additionalProperties: false,
    },
  },
  {
    name: TOOL_NAME.READ_NOTE,
    description:
      'Read a note. In a Markdown vault: its parsed frontmatter and its Markdown body. In an HTML vault: ' +
      'the plain text and the raw HTML stored on disk. Either way structuredContent holds ' +
      '{ schemaVersion, name, format, frontmatter, frontmatterRaw, body, modified, sizeBytes }.',
    inputSchema: {
      type: 'object',
      required: ['name'],
      properties: {
        name: {
          type: 'string',
          description: 'Note file name, e.g. "meeting-notes.md" or "Lavoro/sprint.md"',
        },
      },
      additionalProperties: false,
    },
  },
  {
    name: TOOL_NAME.CREATE_NOTE,
    description:
      'Create a new note in Noted. Send Markdown (a leading YAML frontmatter block is kept as written). ' +
      'The server stores it in the vault\'s own format; HTML is still accepted and converted. ' +
      'Fails if a note with the same name already exists (use update_note to edit an existing note).',
    inputSchema: {
      type: 'object',
      required: ['name', 'content'],
      properties: {
        name: {
          type: 'string',
          description: 'Note file name ending in .md, e.g. "my-note.md" or "Lavoro/plan.md"',
        },
        content: {
          type: 'string',
          description: 'Note body in Markdown (HTML is still accepted)',
        },
      },
      additionalProperties: false,
    },
  },
  {
    name: TOOL_NAME.UPDATE_NOTE,
    description:
      'Update an existing note. By default replaces the entire content. ' +
      'Set append=true to add new content at the end of the note without touching the existing text. ' +
      'Pass expected_etag (from read_note) so the update is refused, and the current note returned, if the note was changed ' +
      'since you read it. To change part of a note, prefer edit_note. Fails if the note does not exist.',
    inputSchema: {
      type: 'object',
      required: ['name', 'content'],
      properties: {
        name: {
          type: 'string',
          description: 'Note file name, e.g. "my-note.md"',
        },
        content: {
          type: 'string',
          description: 'New content in Markdown (HTML is still accepted)',
        },
        append: {
          type: 'boolean',
          description: 'If true, append content at the end instead of overwriting (default: false)',
        },
        expected_etag: {
          type: 'string',
          description: 'The etag from read_note. When given, the update only happens if the note still has that etag.',
        },
      },
      additionalProperties: false,
    },
  },
  {
    name: TOOL_NAME.EDIT_NOTE,
    description:
      'Change part of an existing note without rewriting it, so that edits by a person and by you cannot overwrite each other. ' +
      'Read the note first (read_note) and pass its etag as expected_etag (or its modified time as expected_modified): if the ' +
      'note has changed since, nothing is written and the current content is returned so you can redo the edit on it. ' +
      'operation "replace": swap old_text (an exact, case-sensitive match that must be unique, or set replace_all) for new_text. ' +
      'operation "replace_section": replace the text under a heading ("Risks" or "## Risks"); its sub-sections are kept ' +
      'unless whole=true. operation "append_to_section": add content at the end of that section. ' +
      'Section operations need a Markdown vault; the rest of the note is left byte for byte as it was.',
    inputSchema: {
      type: 'object',
      required: ['name', 'operation'],
      properties: {
        name: { type: 'string', description: 'Note file name, e.g. "my-note.md"' },
        operation: { type: 'string', enum: ['replace', 'replace_section', 'append_to_section'] },
        expected_etag: { type: 'string', description: 'The etag returned by read_note (required unless expected_modified is given).' },
        expected_modified: { type: 'string', description: 'The modified time returned by read_note (ISO), as an alternative to the etag.' },
        old_text: { type: 'string', description: 'replace: the exact text to find' },
        new_text: { type: 'string', description: 'replace: what to put instead (may be empty to delete)' },
        replace_all: { type: 'boolean', description: 'replace: change every occurrence instead of requiring exactly one' },
        heading: { type: 'string', description: 'sections: the heading, "Risks" (any level) or "## Risks" (that level)' },
        content: { type: 'string', description: 'sections: the Markdown to put in, or to add' },
        occurrence: { type: 'number', description: 'sections: which heading, 1-based, when several have the same text' },
        whole: { type: 'boolean', description: 'sections: include the sub-sections (default: only the section\'s own text)' },
      },
      additionalProperties: false,
    },
  },
  {
    name: TOOL_NAME.LIST_TASKS,
    description:
      'List the tasks (the "- [ ]" and "- [x]" items) across the vault, soonest due first, each with its note and line. ' +
      'Open tasks by default. A due date is written "📅 2026-10-10" or "due:: 2026-10-10". Filter by folder, tag (on the task or ' +
      'on its note), due range, overdue, no due date, or text. Markdown vaults only. To tick one, use edit_note on its line.',
    inputSchema: {
      type: 'object',
      properties: {
        status: { type: 'string', enum: ['open', 'done', 'all'], description: 'Default: open' },
        folder: { type: 'string', description: 'Only notes under this folder (any depth), e.g. "Projects"' },
        tag: { type: 'string', description: 'Only tasks that have this tag, or whose note has it, e.g. "#urgent"' },
        due_from: { type: 'string', description: 'Due on or after this day, YYYY-MM-DD' },
        due_to: { type: 'string', description: 'Due on or before this day, YYYY-MM-DD' },
        overdue: { type: 'boolean', description: 'Only open tasks due before today' },
        no_due: { type: 'boolean', description: 'Only tasks with no due date' },
        text: { type: 'string', description: 'Only tasks whose text contains this (case-insensitive)' },
        limit: { type: 'number', description: 'Most tasks to return (default 50, max 200)' },
      },
      additionalProperties: false,
    },
  },
  {
    name: TOOL_NAME.SEARCH_NOTES,
    description:
      'Full-text search across all notes. Case-insensitive. ' +
      'Returns matching note names with a short excerpt showing the match in context.',
    inputSchema: {
      type: 'object',
      required: ['query'],
      properties: {
        query: {
          type: 'string',
          description: 'Search query string (case-insensitive)',
        },
        max_results: {
          type: 'number',
          description: 'Maximum number of results (default 10, max 50)',
        },
      },
      additionalProperties: false,
    },
  },
  {
    name: TOOL_NAME.DELETE_NOTE,
    description:
      'Move a note to the Noted trash (.noted/trash inside the vault). It is not erased: ' +
      'restore it with restore_note (see list_trash). Trashed notes are removed for good ' +
      'after the retention period (default 30 days). Ask the user before deleting.',
    inputSchema: {
      type: 'object',
      required: ['name'],
      properties: {
        name: {
          type: 'string',
          description: 'Note file name to delete, e.g. "old-note.md"',
        },
      },
      additionalProperties: false,
    },
  },
  {
    name: TOOL_NAME.LIST_TRASH,
    description: 'List notes in the trash, newest first, with the id of each deletion.',
    inputSchema: { type: 'object', properties: {}, additionalProperties: false },
  },
  {
    name: TOOL_NAME.RESTORE_NOTE,
    description:
      'Restore a trashed note to its original path. Without `id`, the most recently deleted ' +
      'version of that name. Fails instead of overwriting if a note with that name exists again.',
    inputSchema: {
      type: 'object',
      required: ['name'],
      properties: {
        name: { type: 'string', description: 'Original note name, e.g. "folder/old-note.md"' },
        id: { type: 'string', description: 'Deletion id from list_trash, to restore a specific version' },
      },
      additionalProperties: false,
    },
  },
  {
    name: TOOL_NAME.CREATE_AGENT_WORKFLOW,
    description:
      'Create a deterministic file-first agent workflow scaffold inside one Noted folder. ' +
      'This creates flat notes for workflow, tasks, runs, reviews, and output checks, using ' +
      'stable file names and visible JSON metadata blocks that LLM agents can read.',
    inputSchema: {
      type: 'object',
      required: ['folder', 'workflow_id', 'title', 'goal'],
      properties: {
        folder: {
          type: 'string',
          description: 'Project folder name, e.g. "noted" or "my-app". One folder level only.',
        },
        workflow_id: {
          type: 'string',
          description: 'Stable workflow id, e.g. "WF001".',
        },
        title: {
          type: 'string',
          description: 'Human-readable workflow title.',
        },
        goal: {
          type: 'string',
          description: 'Goal the workflow should accomplish.',
        },
        approval_mode: {
          type: 'string',
          enum: ['autonomous', 'plan', 'action', 'review', 'release', 'manual'],
          description: 'Human-in-the-loop level. Default: plan.',
        },
        tasks: {
          type: 'array',
          description: 'Optional initial task list. If omitted, a default planning task is created.',
          items: {
            type: 'object',
            required: ['id', 'title'],
            properties: {
              id: { type: 'string', description: 'Stable task id, e.g. "T001" or "T001.1".' },
              title: { type: 'string', description: 'Task title.' },
              parent_id: { type: 'string', description: 'Parent task id for subtasks.' },
              depends_on: {
                type: 'array',
                items: { type: 'string' },
                description: 'Task ids that must complete first.',
              },
            },
            additionalProperties: false,
          },
        },
      },
      additionalProperties: false,
    },
  },
  {
    name: TOOL_NAME.APPEND_AGENT_EVENT,
    description:
      'Append a structured event to an agent workflow note. Use this instead of ad-hoc prose ' +
      'for state changes, command outcomes, approvals, reviews, and output checks.',
    inputSchema: {
      type: 'object',
      required: ['name', 'event_type', 'actor'],
      properties: {
        name: {
          type: 'string',
          description: 'Target note file name, e.g. "noted/wf-WF001-agent-runtime.md" or a task note.',
        },
        event_type: {
          type: 'string',
          description: 'Event type, e.g. "TaskStatusChanged", "RunTimedOut", "ReviewFailed".',
        },
        actor: {
          type: 'string',
          description: 'Actor writing the event, e.g. "codex", "claude", "gemini", "user".',
        },
        node_id: {
          type: 'string',
          description: 'Workflow/task/run/review node id associated with this event.',
        },
        status: {
          type: 'string',
          description: 'Resulting status, e.g. "running", "blocked", "review", "done", "failed".',
        },
        summary: {
          type: 'string',
          description: 'Short human-readable summary.',
        },
        details: {
          type: 'object',
          description: 'Additional JSON-serializable event details.',
          additionalProperties: true,
        },
      },
      additionalProperties: false,
    },
  },
  {
    name: TOOL_NAME.ADVANCE_AGENT_STATE,
    description:
      'Advance an agent workflow or task note to a new status, enforcing the state machine, the ' +
      'approval-gate policy (a direct transition may not skip a checkpoint the approval mode requires), ' +
      'and task dependencies. Records the change as an event. For gate states use approve/reject instead.',
    inputSchema: {
      type: 'object',
      required: ['name', 'to'],
      properties: {
        name: {
          type: 'string',
          description: 'Target agent note file name, e.g. "noted/wf-WF001-agent-runtime.md" or a task note.',
        },
        to: {
          type: 'string',
          description: 'Target status, e.g. "ready", "running", "review", "blocked", "done".',
        },
        actor: {
          type: 'string',
          description: 'Actor performing the transition, e.g. "codex", "claude", "user". Defaults to "agent".',
        },
        summary: {
          type: 'string',
          description: 'Short human-readable summary of why the transition happened.',
        },
        expected_updated_at: {
          type: 'string',
          description: 'Optimistic concurrency guard: the updatedAt the note had when you read it. The call fails if the note changed since.',
        },
      },
      additionalProperties: false,
    },
  },
  {
    name: TOOL_NAME.APPROVE_AGENT_GATE,
    description:
      'Approve the pending approval gate on an agent note that is awaiting a decision (plan, review, ' +
      'release, or action), moving it to the gate\'s approve target. Records a GateApproved event.',
    inputSchema: {
      type: 'object',
      required: ['name'],
      properties: {
        name: { type: 'string', description: 'Agent note awaiting approval.' },
        actor: { type: 'string', description: 'Approver, e.g. "user". Defaults to "agent".' },
        summary: { type: 'string', description: 'Short human-readable note on the approval.' },
        expected_updated_at: {
          type: 'string',
          description: 'Optimistic concurrency guard: the updatedAt the note had when you read it.',
        },
      },
      additionalProperties: false,
    },
  },
  {
    name: TOOL_NAME.REJECT_AGENT_GATE,
    description:
      'Reject the pending approval gate on an agent note, moving it to blocked (workflows/tasks) or ' +
      'cancelled (runs). Records a GateRejected event with the reason.',
    inputSchema: {
      type: 'object',
      required: ['name'],
      properties: {
        name: { type: 'string', description: 'Agent note awaiting approval.' },
        actor: { type: 'string', description: 'Reviewer, e.g. "user". Defaults to "agent".' },
        reason: { type: 'string', description: 'Why the gate was rejected.' },
        summary: { type: 'string', description: 'Short human-readable summary.' },
        expected_updated_at: {
          type: 'string',
          description: 'Optimistic concurrency guard: the updatedAt the note had when you read it.',
        },
      },
      additionalProperties: false,
    },
  },
];

// ─── Tool handlers ────────────────────────────────────────────────────────────

export async function handleListNotes(args: Record<string, unknown>) {
  const folder = typeof args.folder === 'string' ? args.folder : undefined;
  if (folder !== undefined) {
    validateFolderPath(folder);
  }
  const notes = listAllNotes(folder);
  if (notes.length === 0) {
    return { content: [{ type: 'text', text: folder ? `No notes found in folder "${folder}".` : 'No notes found.' }] };
  }
  const lines = notes.map(n => {
    const kb = (n.size / 1024).toFixed(1);
    const date = formatLocal(n.mtime);
    return `• ${n.name}  [${kb} KB, ${date}]`;
  });
  return {
    content: [{
      type: 'text',
      text: `${notes.length} note${notes.length !== 1 ? 's' : ''}${folder ? ` in "${folder}"` : ''}:\n\n${lines.join('\n')}`,
    }],
  };
}

export async function handleReadNote(args: Record<string, unknown>) {
  const name = args.name;
  validateNoteName(name);
  const filePath = guardedPath(name as string, 'read');
  if (!fs.existsSync(filePath)) {
    throw new McpError(ErrorCode.InvalidParams, `Note not found: ${name as string}`);
  }
  const stored = fs.readFileSync(filePath, 'utf8');
  const format = vaultFormat();
  const stat = fs.statSync(filePath);
  const note = describeStored(stored, format, { name: name as string, modified: stat.mtime, sizeBytes: stat.size });
  const heading = [
    `# ${(name as string).replace('.md', '')}`,
    `Modified: ${formatLocal(stat.mtime, true)} — ${(stat.size / 1024).toFixed(1)} KB — etag ${note.etag}`,
    '',
  ];
  // A Markdown vault: the note is already compact text, so it is returned once, split into the parsed
  // frontmatter and the Markdown body. An HTML vault keeps the layout clients were written against.
  const lines = format === 'markdown'
    ? [
        ...heading,
        ...(note.frontmatter ? ['## Frontmatter', JSON.stringify(note.frontmatter, null, 2), ''] : []),
        ...(note.frontmatterError ? [`## Frontmatter (not parsed: ${note.frontmatterError})`, note.frontmatterRaw ?? '', ''] : []),
        '## Markdown',
        note.body,
      ]
    : [...heading, '## Content (plain text)', noteText(stored, format), '', '## Raw HTML', stored];
  return {
    content: [{ type: 'text', text: lines.join('\n') }],
    structuredContent: { ...note },
  };
}

export async function handleCreateNote(args: Record<string, unknown>) {
  const name = args.name;
  const rawContent = args.content;
  validateNoteName(name);
  if (typeof rawContent !== 'string' || !rawContent.trim()) {
    throw new McpError(ErrorCode.InvalidParams, 'content must be a non-empty string');
  }
  const filePath = guardedPath(name as string, 'create');
  if (fs.existsSync(filePath)) {
    throw new McpError(ErrorCode.InvalidParams, `Note already exists: ${name as string}. Use update_note to edit it.`);
  }
  const stored = await toStoredNote(rawContent);
  atomicWrite(filePath, stored);
  indexUpsert(name as string, stored);
  return {
    content: [{
      type: 'text',
      text: `Note created: ${name as string} (${(Buffer.byteLength(stored, 'utf8') / 1024).toFixed(1)} KB, etag ${etagOf(stored)})`,
    }],
    structuredContent: { name, etag: etagOf(stored) },
  };
}

export async function handleUpdateNote(args: Record<string, unknown>) {
  const name = args.name;
  const rawContent = args.content;
  const append = args.append === true;
  validateNoteName(name);
  if (typeof rawContent !== 'string' || !rawContent.trim()) {
    throw new McpError(ErrorCode.InvalidParams, 'content must be a non-empty string');
  }
  const filePath = guardedPath(name as string, 'write');
  if (!fs.existsSync(filePath)) {
    throw new McpError(ErrorCode.InvalidParams, `Note not found: ${name as string}. Use create_note to create it first.`);
  }
  if (args.expected_etag !== undefined) {
    if (typeof args.expected_etag !== 'string') throw new McpError(ErrorCode.InvalidParams, 'expected_etag must be a string');
    const conflict = conflictIfChanged(name as string, filePath, { etag: args.expected_etag });
    if (conflict) return conflict;
  }
  // Appending inserts a horizontal rule before the new content for visual separation
  const final = append
    ? await appendToStored(fs.readFileSync(filePath, 'utf8'), rawContent)
    : await toStoredNote(rawContent);
  atomicWrite(filePath, final);
  indexUpsert(name as string, final);
  const action = append ? 'appended to' : 'updated';
  return {
    content: [{
      type: 'text',
      text: `Note ${action}: ${name as string} (etag ${etagOf(final)})`,
    }],
    structuredContent: { name, etag: etagOf(final) },
  };
}

/** Largest note an edit may produce. */
const MAX_EDITED_NOTE_BYTES = 5 * 1024 * 1024;
/** Most of the current note returned with a conflict. */
const MAX_CONFLICT_CHARS = 100_000;

/**
 * If the note is no longer the version the caller made its edit against, the result to send back: an error that carries the
 * current note (so the edit can be redone on it) and its new etag. Null when the note is still that version.
 */
function conflictIfChanged(name: string, filePath: string, expected: { etag?: string; modified?: string }) {
  const stored = fs.readFileSync(filePath, 'utf8');
  const stat = fs.statSync(filePath);
  const etag = etagOf(stored);
  const sameEtag = expected.etag !== undefined && expected.etag.trim().toLowerCase() === etag;
  const sameTime = expected.modified !== undefined && Number.isFinite(Date.parse(expected.modified)) && Date.parse(expected.modified) === stat.mtime.getTime();
  if (expected.etag !== undefined ? sameEtag : sameTime) return null;
  const note = describeStored(stored, vaultFormat(), { name, modified: stat.mtime, sizeBytes: stat.size });
  const shown = stored.length > MAX_CONFLICT_CHARS ? `${stored.slice(0, MAX_CONFLICT_CHARS)}\n[…truncated: ${stored.length} characters in all]` : stored;
  return {
    isError: true,
    content: [{
      type: 'text' as const,
      text: `Conflict: ${name} was changed since you read it (your etag ${expected.etag ?? expected.modified}, now ${etag}). Nothing was written. ` +
        `Redo the edit against the current content below, with expected_etag ${etag}.\n\n${shown}`,
    }],
    structuredContent: { conflict: true, ...note },
  };
}

type EditOutcome = { ok: true; stored: string; changes: number } | { ok: false; error: string };

function applyEdit(stored: string, format: NoteFormat, args: Record<string, unknown>): EditOutcome {
  const operation = args.operation;
  if (operation === 'replace') {
    const oldText = args.old_text;
    const newText = args.new_text;
    if (typeof oldText !== 'string' || oldText === '') return { ok: false, error: 'old_text must be a non-empty string' };
    if (typeof newText !== 'string') return { ok: false, error: 'new_text must be a string (empty to delete the text)' };
    const parts = stored.split(oldText);
    const count = parts.length - 1;
    if (count === 0) return { ok: false, error: 'old_text was not found in the note (it must match exactly, including spaces and line breaks)' };
    if (count > 1 && args.replace_all !== true) {
      return { ok: false, error: `old_text matches ${count} places; include more of the surrounding text so it is unique, or set replace_all` };
    }
    return { ok: true, stored: parts.join(newText), changes: count };
  }
  if (operation === 'replace_section' || operation === 'append_to_section') {
    if (format !== 'markdown') return { ok: false, error: 'section edits need a Markdown vault; use operation "replace" in this vault' };
    const heading = args.heading;
    const content = args.content;
    if (typeof heading !== 'string' || !heading.trim()) return { ok: false, error: 'heading must be a non-empty string' };
    if (typeof content !== 'string') return { ok: false, error: 'content must be a string' };
    const occurrence = typeof args.occurrence === 'number' && Number.isInteger(args.occurrence) && args.occurrence > 0 ? args.occurrence : undefined;
    const found = findSection(stored, heading, occurrence);
    if (!found.ok) return found;
    const whole = args.whole === true;
    const next = operation === 'replace_section'
      ? replaceSectionBody(stored, found.section, content, whole)
      : appendToSectionBody(stored, found.section, content, whole);
    return { ok: true, stored: next, changes: 1 };
  }
  return { ok: false, error: 'operation must be "replace", "replace_section" or "append_to_section"' };
}

/** A note whose frontmatter was readable must still be readable after an edit. */
function frontmatterBroken(before: string, after: string, format: NoteFormat): boolean {
  if (format !== 'markdown') return false;
  const was = splitFront(before).frontmatter;
  if (!was || parseFrontmatterBlock(was).data === null) return false;
  const now = splitFront(after).frontmatter;
  return !now || parseFrontmatterBlock(now).data === null;
}

export async function handleEditNote(args: Record<string, unknown>) {
  const name = args.name;
  validateNoteName(name);
  const etag = args.expected_etag;
  const modified = args.expected_modified;
  if (etag !== undefined && typeof etag !== 'string') throw new McpError(ErrorCode.InvalidParams, 'expected_etag must be a string');
  if (modified !== undefined && typeof modified !== 'string') throw new McpError(ErrorCode.InvalidParams, 'expected_modified must be a string');
  if (etag === undefined && modified === undefined) {
    throw new McpError(ErrorCode.InvalidParams, 'expected_etag is required: read the note with read_note and pass its etag, so the edit cannot overwrite a change made since');
  }
  const filePath = guardedPath(name as string, 'write');
  if (!fs.existsSync(filePath)) {
    throw new McpError(ErrorCode.InvalidParams, `Note not found: ${name as string}`);
  }
  assertNotMigrating();
  const conflict = conflictIfChanged(name as string, filePath, { etag, modified });
  if (conflict) return conflict;

  const stored = fs.readFileSync(filePath, 'utf8');
  const format = vaultFormat();
  const edit = applyEdit(stored, format, args);
  if (!edit.ok) throw new McpError(ErrorCode.InvalidParams, edit.error);
  if (edit.stored === stored) {
    return { content: [{ type: 'text' as const, text: `No change: ${name as string} already reads that way (etag ${etagOf(stored)})` }], structuredContent: { name, etag: etagOf(stored), changed: false } };
  }
  if (Buffer.byteLength(edit.stored, 'utf8') > MAX_EDITED_NOTE_BYTES) throw new McpError(ErrorCode.InvalidParams, 'the edited note would be too large');
  if (frontmatterBroken(stored, edit.stored, format)) {
    throw new McpError(ErrorCode.InvalidParams, "the edit would break the note's frontmatter (it must stay valid YAML between its --- lines)");
  }
  atomicWrite(filePath, edit.stored);
  indexUpsert(name as string, edit.stored);
  const newEtag = etagOf(edit.stored);
  return {
    content: [{ type: 'text' as const, text: `Note edited: ${name as string} (${edit.changes} change${edit.changes === 1 ? '' : 's'}, etag ${newEtag})` }],
    structuredContent: { name, etag: newEtag, changed: true, changes: edit.changes },
  };
}

interface TaskCacheEntry { mtimeMs: number; size: number; tasks: NoteTask[] }
const taskCache = new Map<string, TaskCacheEntry>();

/** Every task of the vault, reading again only the notes that changed since the last call. */
function allTasks(): NoteTask[] {
  const seen = new Set<string>();
  const out: NoteTask[] = [];
  for (const note of listAllNotes()) {
    seen.add(note.name);
    const mtimeMs = note.mtime.getTime();
    let entry = taskCache.get(note.name);
    if (!entry || entry.mtimeMs !== mtimeMs || entry.size !== note.size) {
      let tasks: NoteTask[] = [];
      try {
        const stored = fs.readFileSync(safeNotePath(note.name), 'utf8');
        if (stored.length <= 2 * 1024 * 1024) {
          const found = extractTasks(stored);
          if (found.length > 0) {
            const noteTags = extractTags(withoutTaskLines(stored, found), 'markdown');
            tasks = found.map(t => ({ ...t, note: note.name, noteTags }));
          }
        }
      } catch { /* unreadable: no tasks */ }
      entry = { mtimeMs, size: note.size, tasks };
      taskCache.set(note.name, entry);
    }
    out.push(...entry.tasks);
  }
  for (const name of [...taskCache.keys()]) if (!seen.has(name)) taskCache.delete(name);
  return out;
}

const DAY = /^\d{4}-\d{2}-\d{2}$/;

export async function handleListTasks(args: Record<string, unknown>) {
  if (vaultFormat() !== 'markdown') {
    return { content: [{ type: 'text' as const, text: 'Tasks can be listed in a Markdown vault only (Settings → Editor → Note format).' }], isError: true };
  }
  const str = (k: string): string | undefined => {
    const v = args[k];
    if (v === undefined) return undefined;
    if (typeof v !== 'string') throw new McpError(ErrorCode.InvalidParams, `${k} must be a string`);
    return v === '' ? undefined : v;
  };
  const day = (k: string): string | undefined => {
    const v = str(k);
    if (v !== undefined && !DAY.test(v)) throw new McpError(ErrorCode.InvalidParams, `${k} must be a day like 2026-10-10`);
    return v;
  };
  const status = args.status === undefined ? 'open' : args.status;
  if (status !== 'open' && status !== 'done' && status !== 'all') throw new McpError(ErrorCode.InvalidParams, 'status must be open, done or all');
  const filter: TaskFilter = {
    status, folder: str('folder'), tag: str('tag'), text: str('text'), dueFrom: day('due_from'), dueTo: day('due_to'),
    overdue: args.overdue === true || undefined, noDue: args.no_due === true || undefined,
  };
  const limit = typeof args.limit === 'number' ? Math.min(200, Math.max(1, Math.floor(args.limit))) : 50;
  const matched = queryTasks(allTasks(), filter, localDay(new Date()));
  const shown = matched.slice(0, limit);
  const lines = shown.map(t => `- [${t.done ? 'x' : ' '}] ${t.text}${t.due ? ` (due ${t.due})` : ''} — ${t.note}:${t.line}`);
  const head = `${matched.length} task${matched.length === 1 ? '' : 's'}${matched.length > shown.length ? `, showing ${shown.length}` : ''}`;
  return {
    content: [{ type: 'text' as const, text: matched.length === 0 ? 'No tasks match.' : `${head}:\n\n${lines.join('\n')}` }],
    structuredContent: {
      total: matched.length,
      tasks: shown.map(t => ({ note: t.note, line: t.line, done: t.done, text: t.text, due: t.due ?? null, tags: t.tags })),
    },
  };
}

export async function handleSearchNotes(args: Record<string, unknown>) {
  const query = args.query;
  if (typeof query !== 'string' || !query.trim()) {
    throw new McpError(ErrorCode.InvalidParams, 'query must be a non-empty string');
  }
  const maxResults = typeof args.max_results === 'number'
    ? Math.min(50, Math.max(1, Math.floor(args.max_results)))
    : 10;

  const idx = ensureSearchIndex();
  const policy = currentPolicy();
  const hits = idx.search(query, { limit: maxResults * 4 }).filter(h => canRead(accessFor(policy, h.id))).slice(0, maxResults);

  if (hits.length === 0) {
    return { content: [{ type: 'text', text: `No notes found matching "${query}".` }] };
  }

  const lines = hits.map(hit => `• **${hit.id}**\n  ${excerpt(idx.getDoc(hit.id)?.text ?? '', query)}`);
  return {
    content: [{
      type: 'text',
      text: `${hits.length} result${hits.length !== 1 ? 's' : ''} for "${query}":\n\n${lines.join('\n\n')}`,
    }],
  };
}

const retentionText = () =>
  trashRetentionDays() > 0 ? `kept for ${trashRetentionDays()} days` : 'kept until removed by hand';

export async function handleDeleteNote(args: Record<string, unknown>) {
  const name = args.name;
  validateNoteName(name);
  const filePath = guardedPath(name as string, 'write');
  if (!fs.existsSync(filePath)) {
    throw new McpError(ErrorCode.InvalidParams, `Note not found: ${name as string}`);
  }
  assertNotMigrating();
  purgeTrash(NOTES_DIR, new Date(), trashRetentionDays());
  const item = moveToTrash(NOTES_DIR, name as string);
  indexRemove(name as string);
  return {
    content: [{
      type: 'text',
      text: `Note moved to trash: ${name as string} (${retentionText()}). Restore it with restore_note (id ${item.stamp}).`,
    }],
  };
}

export async function handleListTrash() {
  purgeTrash(NOTES_DIR, new Date(), trashRetentionDays());
  const policy = currentPolicy();
  const items = listTrash(NOTES_DIR).filter(i => canRead(accessFor(policy, i.name)));
  if (items.length === 0) return { content: [{ type: 'text', text: 'The trash is empty.' }] };
  const lines = items.map(i => `${i.name} — deleted ${formatLocal(i.trashedAt, true)} — id ${i.stamp}`);
  return { content: [{ type: 'text', text: `${items.length} note(s) in the trash (${retentionText()}):\n${lines.join('\n')}` }] };
}

export async function handleRestoreNote(args: Record<string, unknown>) {
  const name = args.name;
  validateNoteName(name);
  const id = args.id;
  if (id !== undefined && typeof id !== 'string') {
    throw new McpError(ErrorCode.InvalidParams, 'id must be a string');
  }
  guardedPath(name as string, 'create'); // same confinement rules as every other note path, and the policy
  assertNotMigrating();
  purgeTrash(NOTES_DIR, new Date(), trashRetentionDays());
  try {
    const item = restoreFromTrash(NOTES_DIR, name as string, id as string | undefined);
    indexUpsert(name as string, fs.readFileSync(safeNotePath(name as string), 'utf8'));
    return { content: [{ type: 'text', text: `Note restored: ${name as string} (deleted ${formatLocal(item.trashedAt, true)})` }] };
  } catch (err) {
    if (err instanceof TrashError) throw new McpError(ErrorCode.InvalidParams, err.message);
    throw err;
  }
}

export async function handleCreateAgentWorkflow(args: Record<string, unknown>) {
  const files = buildAgentWorkflowFiles(args);
  const paths = files.map(file => {
    validateNoteName(file.name);
    return { ...file, filePath: guardedPath(file.name, 'create') };
  });

  const existing = paths.filter(file => fs.existsSync(file.filePath)).map(file => file.name);
  if (existing.length > 0) {
    throw new McpError(
      ErrorCode.InvalidParams,
      `Agent workflow scaffold already exists for: ${existing.join(', ')}`,
    );
  }

  // Converted first: a note that cannot be converted must not leave half a scaffold behind.
  const stored = await Promise.all(paths.map(file => toStoredNote(file.content)));
  paths.forEach((file, i) => atomicWrite(file.filePath, stored[i]));

  return {
    content: [{
      type: 'text',
      text: [
        `Agent workflow created with ${files.length} notes:`,
        '',
        ...files.map(file => `• ${file.name}`),
      ].join('\n'),
    }],
  };
}

export async function handleAppendAgentEvent(args: Record<string, unknown>) {
  const name = args.name;
  validateNoteName(name);
  const filePath = guardedPath(name as string, 'write');
  if (!fs.existsSync(filePath)) {
    throw new McpError(ErrorCode.InvalidParams, `Note not found: ${name as string}`);
  }

  const eventType = validateAgentId(args.event_type, 'event_type');
  const actor = validateNonEmptyString(args.actor, 'actor');
  const event: Record<string, unknown> = {
    type: eventType,
    actor,
    at: new Date().toISOString(),
  };
  if (args.node_id !== undefined) {
    event.nodeId = validateAgentId(args.node_id, 'node_id');
  }
  if (args.status !== undefined) {
    event.status = validateNonEmptyString(args.status, 'status');
  }
  if (args.summary !== undefined) {
    event.summary = validateNonEmptyString(args.summary, 'summary');
  }
  if (args.details !== undefined) {
    if (!args.details || typeof args.details !== 'object' || Array.isArray(args.details)) {
      throw new McpError(ErrorCode.InvalidParams, 'details must be an object when provided');
    }
    event.details = args.details;
  }

  const eventMd = [
    `## Event ${eventType}`,
    '',
    codeBlockJson(event),
  ].join('\n');
  const existing = fs.readFileSync(filePath, 'utf8');
  atomicWrite(filePath, await appendToStored(existing, eventMd));

  return {
    content: [{
      type: 'text',
      text: `Agent event appended to ${name as string}: ${eventType}`,
    }],
  };
}

// ─── Agent state-machine tools ────────────────────────────────────────────────

const AGENT_ACTOR_DEFAULT = 'agent';

interface LoadedAgentNote {
  name: string;
  filePath: string;
  html: string;
  meta: AgentMetadata;
}

function loadAgentNote(name: unknown): LoadedAgentNote {
  validateNoteName(name);
  const filePath = guardedPath(name as string, 'write');
  if (!fs.existsSync(filePath)) {
    throw new McpError(ErrorCode.InvalidParams, `Note not found: ${name as string}`);
  }
  const html = fs.readFileSync(filePath, 'utf8');
  const meta = readAgentMetadata(html);
  if (!meta) {
    throw new McpError(ErrorCode.InvalidParams, `Not an agent note (no Agent Metadata block): ${name as string}`);
  }
  return { name: name as string, filePath, html, meta };
}

function folderOf(noteName: string): string | undefined {
  const slash = noteName.lastIndexOf('/');
  return slash === -1 ? undefined : noteName.slice(0, slash);
}

// Find a workflow note by its metadata id within a candidate list.
function findWorkflowById(workflowId: string, candidates: NoteEntry[], excludeName: string): LoadedAgentNote | null {
  for (const entry of candidates) {
    if (entry.name === excludeName) continue;
    try {
      const filePath = guardedPath(entry.name, 'write');
      const html = fs.readFileSync(filePath, 'utf8');
      const meta = readAgentMetadata(html);
      if (meta && meta.type === 'workflow' && meta.id === workflowId) {
        return { name: entry.name, filePath, html, meta };
      }
    } catch { /* skip unreadable */ }
  }
  return null;
}

// Locate the workflow note governing a task by metadata id (robust to a renamed
// workflow file). Prefer the task's own folder; fall back to a full scan so a
// task moved to another folder still resolves its workflow.
function locateWorkflow(taskMeta: AgentMetadata, taskNoteName: string): LoadedAgentNote | null {
  const workflowId = taskMeta.workflowId;
  if (!workflowId) return null;
  const folder = folderOf(taskNoteName);
  const inFolder = findWorkflowById(workflowId, listAllNotes(folder), taskNoteName);
  if (inFolder) return inFolder;
  return folder !== undefined ? findWorkflowById(workflowId, listAllNotes(), taskNoteName) : null;
}

function runEngine(fn: () => EngineResult): EngineResult {
  try {
    return fn();
  } catch (err) {
    if (err instanceof AgentEngineError) {
      throw new McpError(ErrorCode.InvalidParams, err.message);
    }
    throw err;
  }
}

async function persistAgentNote(note: LoadedAgentNote, meta: AgentMetadata, event: unknown): Promise<void> {
  const rewritten = writeAgentMetadata(note.html, meta);
  if (!rewritten) {
    throw new McpError(ErrorCode.InternalError, `Failed to update Agent Metadata in ${note.name}`);
  }
  const eventMd = [`## Event ${(event as { type: string }).type}`, '', codeBlockJson(event)].join('\n');
  const final = await appendToStored(rewritten, eventMd);
  atomicWrite(note.filePath, final);
  indexUpsert(note.name, final);
}

// Keep the workflow note's tasks[] mirror consistent after a task transition.
function syncWorkflowMirror(
  workflow: LoadedAgentNote | null,
  note: LoadedAgentNote,
  newStatus: string,
  now: string,
): void {
  if (!workflow || note.meta.type !== 'task' || !note.meta.id) return;
  const mirrored = applyTaskStatusToWorkflow(workflow.meta, note.meta.id, newStatus as never, now);
  if (mirrored === workflow.meta) return;
  const rewritten = writeAgentMetadata(workflow.html, mirrored);
  if (rewritten) {
    atomicWrite(workflow.filePath, rewritten);
    indexUpsert(workflow.name, rewritten);
  }
}

function buildAgentContext(
  note: LoadedAgentNote,
  args: Record<string, unknown>,
): { ctx: EngineContext; workflow: LoadedAgentNote | null } {
  const actor = args.actor === undefined ? AGENT_ACTOR_DEFAULT : validateNonEmptyString(args.actor, 'actor');
  const ctx: EngineContext = { actor, now: new Date().toISOString() };
  if (args.summary !== undefined) ctx.summary = validateNonEmptyString(args.summary, 'summary');
  if (args.expected_updated_at !== undefined) {
    ctx.expectedUpdatedAt = validateNonEmptyString(args.expected_updated_at, 'expected_updated_at');
  }

  let workflow: LoadedAgentNote | null = null;
  if (note.meta.type === 'task') {
    workflow = locateWorkflow(note.meta, note.name);
    if (workflow) {
      ctx.mode = workflow.meta.approvalMode;
      ctx.tasks = workflow.meta.tasks;
    } else {
      // Fail safe: a task whose workflow can't be found is treated as the most
      // restrictive mode, never silently autonomous (which would skip gates).
      ctx.mode = 'manual';
    }
  }
  return { ctx, workflow };
}

export async function handleAdvanceAgentState(args: Record<string, unknown>) {
  const note = loadAgentNote(args.name);
  const to = validateNonEmptyString(args.to, 'to');
  const { ctx, workflow } = buildAgentContext(note, args);
  const result = runEngine(() => advance(note.meta, to, ctx));
  await persistAgentNote(note, result.metadata, result.event);
  syncWorkflowMirror(workflow, note, result.metadata.status as string, ctx.now);
  return {
    content: [{
      type: 'text',
      text: `${note.meta.type} ${note.meta.id ?? note.name}: ${note.meta.status ?? '?'} -> ${result.metadata.status as string}`,
    }],
  };
}

export async function handleApproveAgentGate(args: Record<string, unknown>) {
  const note = loadAgentNote(args.name);
  const { ctx, workflow } = buildAgentContext(note, args);
  const result = runEngine(() => approveGate(note.meta, ctx));
  await persistAgentNote(note, result.metadata, result.event);
  syncWorkflowMirror(workflow, note, result.metadata.status as string, ctx.now);
  return {
    content: [{
      type: 'text',
      text: `Approved: ${note.meta.id ?? note.name} -> ${result.metadata.status as string}`,
    }],
  };
}

export async function handleRejectAgentGate(args: Record<string, unknown>) {
  const note = loadAgentNote(args.name);
  const { ctx, workflow } = buildAgentContext(note, args);
  const reason = args.reason === undefined ? undefined : validateNonEmptyString(args.reason, 'reason');
  const result = runEngine(() => rejectGate(note.meta, { ...ctx, reason }));
  await persistAgentNote(note, result.metadata, result.event);
  syncWorkflowMirror(workflow, note, result.metadata.status as string, ctx.now);
  return {
    content: [{
      type: 'text',
      text: `Rejected: ${note.meta.id ?? note.name} -> ${result.metadata.status as string}`,
    }],
  };
}

// ─── Server bootstrap ─────────────────────────────────────────────────────────

type ToolHandler = (args: Record<string, unknown>) => Promise<{ content: { type: string; text: string }[] }>;

const TOOL_HANDLERS: Record<ToolName, ToolHandler> = {
  [TOOL_NAME.LIST_NOTES]: handleListNotes,
  [TOOL_NAME.READ_NOTE]: handleReadNote,
  [TOOL_NAME.CREATE_NOTE]: handleCreateNote,
  [TOOL_NAME.UPDATE_NOTE]: handleUpdateNote,
  [TOOL_NAME.EDIT_NOTE]: handleEditNote,
  [TOOL_NAME.LIST_TASKS]: handleListTasks,
  [TOOL_NAME.SEARCH_NOTES]: handleSearchNotes,
  [TOOL_NAME.DELETE_NOTE]: handleDeleteNote,
  [TOOL_NAME.LIST_TRASH]: handleListTrash,
  [TOOL_NAME.RESTORE_NOTE]: handleRestoreNote,
  [TOOL_NAME.CREATE_AGENT_WORKFLOW]: handleCreateAgentWorkflow,
  [TOOL_NAME.APPEND_AGENT_EVENT]: handleAppendAgentEvent,
  [TOOL_NAME.ADVANCE_AGENT_STATE]: handleAdvanceAgentState,
  [TOOL_NAME.APPROVE_AGENT_GATE]: handleApproveAgentGate,
  [TOOL_NAME.REJECT_AGENT_GATE]: handleRejectAgentGate,
};

function isToolName(value: string): value is ToolName {
  return Object.prototype.hasOwnProperty.call(TOOL_HANDLERS, value);
}

const server = new Server(
  { name: 'noted', version: pkg.version },
  { capabilities: { tools: {} } },
);

server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools: TOOLS }));

server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args = {} } = request.params;
  const safeArgs = args as Record<string, unknown>;

  try {
    if (!isToolName(name)) throw new McpError(ErrorCode.MethodNotFound, `Unknown tool: ${name}`);
    const handler = TOOL_HANDLERS[name];
    return await handler(safeArgs);
  } catch (err) {
    // Re-throw McpErrors as-is; wrap unexpected errors
    if (err instanceof McpError) throw err;
    throw new McpError(
      ErrorCode.InternalError,
      err instanceof Error ? err.message : String(err),
    );
  }
});

export function getArgValue(flag: string): string | undefined {
  const argv = process.argv.slice(2);
  const eqIdx = argv.findIndex(a => a.startsWith(`${flag}=`));
  if (eqIdx !== -1) return argv[eqIdx].slice(`${flag}=`.length);
  const spaceIdx = argv.indexOf(flag);
  if (spaceIdx !== -1 && argv[spaceIdx + 1]) return argv[spaceIdx + 1];
  return undefined;
}

export async function main() {
  // Log to stderr only (stdout is reserved for MCP messages in stdio mode)
  process.stderr.write(`[noted-mcp] notes directory: ${NOTES_DIR}\n`);
  if (!fs.existsSync(NOTES_DIR)) {
    process.stderr.write(`[noted-mcp] WARNING: notes directory does not exist yet — it will be created on first write.\n`);
  }

  try {
    const purged = purgeTrash(NOTES_DIR, new Date(), trashRetentionDays());
    if (purged > 0) process.stderr.write(`[noted-mcp] purged ${purged} expired item(s) from the trash\n`);
  } catch (err) {
    process.stderr.write(`[noted-mcp] trash purge failed: ${err instanceof Error ? err.message : String(err)}\n`);
  }

  const transportType = getArgValue('--transport') ?? 'stdio';

  if (transportType === 'sse') {
    const portStr = getArgValue('--port');
    const port = portStr ? parseInt(portStr, 10) : 3000;
    const transports = new Map<string, SSEServerTransport>();

    // Prefer the token from the environment (not process argv, which any
    // same-user process can read via the process list); fall back to the flag
    // for manual/backward-compatible starts.
    const authToken = process.env.NOTED_MCP_AUTH_TOKEN || getArgValue('--auth-token');

    // Constant-time token comparison (avoids a length/timing oracle).
    const tokenMatches = (given: string | undefined): boolean => {
      if (!authToken || typeof given !== 'string') return false;
      const a = Buffer.from(given);
      const b = Buffer.from(authToken);
      return a.length === b.length && crypto.timingSafeEqual(a, b);
    };

    const isLocalHostname = (h: string): boolean => {
      const name = h.split(':')[0].toLowerCase().replace(/^\[|\]$/g, '');
      return name === 'localhost' || name === '127.0.0.1' || name === '::1';
    };
    const isLocalOrigin = (origin: string): boolean => {
      try { return isLocalHostname(new URL(origin).hostname); } catch { return false; }
    };

    const serverHttp = http.createServer(async (req, res) => {
      const origin = typeof req.headers.origin === 'string' ? req.headers.origin : undefined;
      const host = typeof req.headers.host === 'string' ? req.headers.host : undefined;

      // DNS-rebinding defense: reject a Host or Origin that is present but not
      // local. Local MCP clients send a local Host and no Origin header; missing
      // headers (CLI clients) are treated as local. Bound to 127.0.0.1 already,
      // this closes the browser/DNS-rebinding path to the notes vault.
      if (host && !isLocalHostname(host)) {
        res.writeHead(403);
        res.end('Forbidden: non-local Host');
        process.stderr.write(`[noted-mcp] Rejected non-local Host: ${host}\n`);
        return;
      }
      if (origin && !isLocalOrigin(origin)) {
        res.writeHead(403);
        res.end('Forbidden: cross-origin request');
        process.stderr.write(`[noted-mcp] Rejected cross-origin request from: ${origin}\n`);
        return;
      }

      // CORS: reflect only a trusted local origin — never a wildcard.
      if (origin) res.setHeader('Access-Control-Allow-Origin', origin);
      res.setHeader('Vary', 'Origin');
      res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
      res.setHeader('Access-Control-Allow-Headers', 'Content-Type, X-MCP-Token');

      if (req.method === 'OPTIONS') {
        res.writeHead(200);
        res.end();
        return;
      }

      const parsedUrl = new URL(req.url || '', `http://${req.headers.host || 'localhost'}`);

      // Token authentication: every request — the /sse handshake AND each
      // /messages POST — must present the token, so a leaked sessionId alone
      // (e.g. captured from a proxy/access log) can't drive the tools. Clients
      // supply it via the X-MCP-Token header (which they apply to all requests);
      // a ?token= query param also works for the handshake.
      if (authToken) {
        const headerToken = req.headers['x-mcp-token'];
        const reqToken = parsedUrl.searchParams.get('token')
          ?? (typeof headerToken === 'string' ? headerToken : undefined);
        if (!tokenMatches(reqToken)) {
          res.writeHead(401);
          res.end('Unauthorized: Invalid or missing token');
          process.stderr.write('[noted-mcp] Rejected unauthorized request\n');
          return;
        }
      }

      if (req.method === 'GET' && parsedUrl.pathname === '/sse') {
        const transport = new SSEServerTransport('/messages', res);
        const sessionId = transport.sessionId;
        transports.set(sessionId, transport);

        transport.onclose = () => {
          transports.delete(sessionId);
          process.stderr.write(`[noted-mcp] SSE session closed: ${sessionId}\n`);
        };

        await server.connect(transport);
        process.stderr.write(`[noted-mcp] SSE session started: ${sessionId}\n`);
        return;
      }

      if (req.method === 'POST' && parsedUrl.pathname === '/messages') {
        const sessionId = parsedUrl.searchParams.get('sessionId');
        if (!sessionId) {
          res.writeHead(400);
          res.end('Missing sessionId parameter');
          return;
        }

        const transport = transports.get(sessionId);
        if (!transport) {
          res.writeHead(404);
          res.end('Session not found');
          return;
        }

        try {
          await transport.handlePostMessage(req, res);
        } catch (err) {
          process.stderr.write(`[noted-mcp] Error handling post message: ${err}\n`);
        }
        return;
      }

      res.writeHead(404);
      res.end('Not Found');
    });

    serverHttp.listen(port, '127.0.0.1', () => {
      process.stderr.write(`[noted-mcp] SSE server listening on http://127.0.0.1:${port}\n`);
      process.stderr.write(`[noted-mcp] SSE endpoint: http://localhost:${port}/sse\n`);
    });
  } else {
    const transport = new StdioServerTransport();
    await server.connect(transport);
    process.stderr.write('[noted-mcp] stdio server ready\n');
  }
}

main().catch(err => {
  process.stderr.write(`[noted-mcp] fatal: ${err instanceof Error ? err.message : String(err)}\n`);
  process.exit(1);
});
