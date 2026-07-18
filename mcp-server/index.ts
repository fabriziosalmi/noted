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
 * If --notes-dir is omitted the server auto-detects the production Noted
 * data directory on macOS:
 *   ~/Library/Application Support/Noted/notes
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

// ─── Notes-directory resolution ───────────────────────────────────────────────

export function resolveNotesDir(): string {
  // Accept --notes-dir <path> or --notes-dir=<path>
  const argv = process.argv.slice(2);
  const eqIdx = argv.findIndex(a => a.startsWith('--notes-dir='));
  if (eqIdx !== -1) return path.resolve(argv[eqIdx].slice('--notes-dir='.length));
  const spaceIdx = argv.indexOf('--notes-dir');
  if (spaceIdx !== -1 && argv[spaceIdx + 1]) return path.resolve(argv[spaceIdx + 1]);

  // Auto-detect macOS paths
  const home = os.homedir();
  const candidates = [
    path.join(home, 'Library', 'Application Support', 'Noted', 'notes'),
    path.join(home, 'Documents', 'Noted'),
  ];
  return candidates.find(p => fs.existsSync(p)) ?? candidates[0];
}

const NOTES_DIR = resolveNotesDir();

// ─── Path security ────────────────────────────────────────────────────────────

/** Validates a note name and throws McpError (InvalidParams) on failure. */
export function validateNoteName(name: unknown): asserts name is string {
  if (typeof name !== 'string' || !name.trim()) {
    throw new McpError(ErrorCode.InvalidParams, 'Note name must be a non-empty string');
  }
  if (!name.endsWith('.md')) {
    throw new McpError(ErrorCode.InvalidParams, 'Note name must end with .md');
  }
  if (name.includes('..')) {
    throw new McpError(ErrorCode.InvalidParams, 'Note name must not contain ".."');
  }
  if (path.isAbsolute(name)) {
    throw new McpError(ErrorCode.InvalidParams, 'Note name must not be an absolute path');
  }
  const segments = name.split('/');
  if (segments.length > 2) {
    throw new McpError(ErrorCode.InvalidParams, 'Only one level of subfolder is allowed (e.g. "folder/note.md")');
  }
  for (const seg of segments) {
    const base = seg.endsWith('.md') ? seg.slice(0, -3) : seg;
    if (!base.trim()) {
      throw new McpError(ErrorCode.InvalidParams, `Invalid segment "${seg}": segment cannot be empty or whitespace only`);
    }
    // eslint-disable-next-line no-control-regex
    if (/[\x00-\x1F\x7F\\/:*?"<>|;`$]/.test(base)) {
      throw new McpError(
        ErrorCode.InvalidParams,
        `Invalid segment "${seg}": contains reserved characters (\\ / : * ? " < > | ; \` $)`,
      );
    }
  }
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
  let resolved = path.resolve(NOTES_DIR, name);
  
  // Resolve physical path of the file or its parent directory to prevent symlink traversal
  try {
    if (fs.existsSync(resolved)) {
      resolved = fs.realpathSync(resolved);
    } else {
      const parent = path.dirname(resolved);
      if (fs.existsSync(parent)) {
        const realParent = fs.realpathSync(parent);
        resolved = path.join(realParent, path.basename(resolved));
      }
    }
  } catch { /* fallback to path.resolve */ }

  const root = path.resolve(NOTES_DIR);
  const rootReal = fs.existsSync(root) ? fs.realpathSync(root) : root;
  if (resolved !== rootReal && !resolved.startsWith(rootReal + path.sep)) {
    throw new McpError(ErrorCode.InvalidParams, 'Path traversal detected');
  }
  return resolved;
}


// ─── Markdown → HTML (marked-powered) ───────────────────────────────────────

export function markdownToHtml(md: string): string {
  return marked.parse(md, { breaks: true, gfm: true, async: false }) as string;
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

// ─── Atomic file write ────────────────────────────────────────────────────────

function atomicWrite(filePath: string, content: string): void {
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

  const collect = (dir: string, prefix: string): NoteEntry[] => {
    let entries: NoteEntry[] = [];
    try {
      const items = fs.readdirSync(dir, { withFileTypes: true });
      for (const item of items) {
        try {
          if (item.isFile() && item.name.endsWith('.md')) {
            const name = prefix ? `${prefix}/${item.name}` : item.name;
            try {
              validateNoteName(name);
            } catch {
              continue;
            }
            const stat = fs.statSync(path.join(dir, item.name));
            entries.push({ name, mtime: stat.mtime, size: stat.size });
          } else if (item.isDirectory() && !item.name.startsWith('.') && !prefix) {
            // One level deep only
            entries = entries.concat(collect(path.join(dir, item.name), item.name));
          }
        } catch {
          // Skip unreadable/invalid entries but continue scanning siblings
        }
      }
    } catch { /* skip unreadable */ }
    return entries;
  };

  const all = collect(NOTES_DIR, '');

  if (folder) {
    const normalized = folder.replace(/\/$/, '');
    return all.filter(n => n.name.startsWith(`${normalized}/`));
  }
  return all.sort((a, b) => b.mtime.getTime() - a.mtime.getTime());
}

// ─── Full-text search index (shared BM25) ─────────────────────────────────────

const FT_MAX_FILES = 1500;
const FT_MAX_TOTAL_BYTES = 50 * 1024 * 1024;
const FT_MAX_FILE_BYTES = 2 * 1024 * 1024;
const INDEX_STALE_MS = 30_000;

let searchIndex: InvertedIndex | null = null;
let indexScannedAt = 0;

// Lazily (re)build the index once per staleness window instead of re-reading
// every note on every query. Incremental hooks on create/update/delete keep a
// warm (SSE-session) index fresh; the staleness window catches external edits.
function ensureSearchIndex(): InvertedIndex {
  const now = Date.now();
  if (searchIndex && now - indexScannedAt < INDEX_STALE_MS) return searchIndex;
  const idx = new InvertedIndex();
  let totalBytes = 0;
  for (const note of listAllNotes()) {
    if (idx.size >= FT_MAX_FILES) break;
    try {
      const html = fs.readFileSync(safeNotePath(note.name), 'utf8');
      if (html.length > FT_MAX_FILE_BYTES) continue;
      if ((totalBytes += html.length) > FT_MAX_TOTAL_BYTES) break;
      idx.add({ id: note.name, title: note.name, text: htmlToText(html), mtimeMs: note.mtime.getTime() });
    } catch { /* skip unreadable */ }
  }
  searchIndex = idx;
  indexScannedAt = now;
  return idx;
}

// Keep a live index in sync after a mutation (no-op until the index is built).
function indexUpsert(name: string, html: string): void {
  searchIndex?.add({ id: name, title: name, text: htmlToText(html), mtimeMs: Date.now() });
}
function indexRemove(name: string): void {
  searchIndex?.remove(name);
}

/** Test seam: force a rebuild on the next search (tests mutate mockFiles directly). */
export function __resetSearchIndex(): void {
  searchIndex = null;
  indexScannedAt = 0;
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
  SEARCH_NOTES: 'search_notes',
  DELETE_NOTE: 'delete_note',
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
          description: 'Restrict results to a specific folder (e.g. "Lavoro"). Omit to list all notes.',
        },
      },
      additionalProperties: false,
    },
  },
  {
    name: TOOL_NAME.READ_NOTE,
    description:
      'Read the full content of a note. Returns both the plain-text version (for easy reading) ' +
      'and the raw HTML stored on disk.',
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
      'Create a new note in Noted. Content can be Markdown or HTML — Markdown is automatically ' +
      'converted to HTML for correct rendering in the editor. ' +
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
          description: 'Note body in Markdown or HTML',
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
      'Fails if the note does not exist.',
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
          description: 'New content in Markdown or HTML',
        },
        append: {
          type: 'boolean',
          description: 'If true, append content at the end instead of overwriting (default: false)',
        },
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
      'Permanently delete a note. This action cannot be undone — ' +
      'ask the user for confirmation before calling this tool.',
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
    validateFolderName(folder);
  }
  const notes = listAllNotes(folder);
  if (notes.length === 0) {
    return { content: [{ type: 'text', text: folder ? `No notes found in folder "${folder}".` : 'No notes found.' }] };
  }
  const lines = notes.map(n => {
    const kb = (n.size / 1024).toFixed(1);
    const date = n.mtime.toISOString().slice(0, 10);
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
  const filePath = safeNotePath(name as string);
  if (!fs.existsSync(filePath)) {
    throw new McpError(ErrorCode.InvalidParams, `Note not found: ${name as string}`);
  }
  const html = fs.readFileSync(filePath, 'utf8');
  const plain = htmlToText(html);
  const stat = fs.statSync(filePath);
  return {
    content: [{
      type: 'text',
      text: [
        `# ${(name as string).replace('.md', '')}`,
        `Modified: ${stat.mtime.toISOString().slice(0, 19).replace('T', ' ')} — ${(stat.size / 1024).toFixed(1)} KB`,
        '',
        '## Content (plain text)',
        plain,
        '',
        '## Raw HTML',
        html,
      ].join('\n'),
    }],
  };
}

export async function handleCreateNote(args: Record<string, unknown>) {
  const name = args.name;
  const rawContent = args.content;
  validateNoteName(name);
  if (typeof rawContent !== 'string' || !rawContent.trim()) {
    throw new McpError(ErrorCode.InvalidParams, 'content must be a non-empty string');
  }
  const filePath = safeNotePath(name as string);
  if (fs.existsSync(filePath)) {
    throw new McpError(ErrorCode.InvalidParams, `Note already exists: ${name as string}. Use update_note to edit it.`);
  }
  const html = toHtml(rawContent);
  atomicWrite(filePath, html);
  indexUpsert(name as string, html);
  return {
    content: [{
      type: 'text',
      text: `Note created: ${name as string} (${(Buffer.byteLength(html, 'utf8') / 1024).toFixed(1)} KB)`,
    }],
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
  const filePath = safeNotePath(name as string);
  if (!fs.existsSync(filePath)) {
    throw new McpError(ErrorCode.InvalidParams, `Note not found: ${name as string}. Use create_note to create it first.`);
  }
  const newHtml = await toHtml(rawContent);
  let finalHtml: string;
  if (append) {
    const existing = fs.readFileSync(filePath, 'utf8');
    // Insert a horizontal rule before the new content for visual separation
    finalHtml = existing + '\n<hr>\n' + newHtml;
  } else {
    finalHtml = newHtml;
  }
  atomicWrite(filePath, finalHtml);
  indexUpsert(name as string, finalHtml);
  const action = append ? 'appended to' : 'updated';
  return {
    content: [{
      type: 'text',
      text: `Note ${action}: ${name as string}`,
    }],
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
  const hits = idx.search(query, { limit: maxResults });

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

export async function handleDeleteNote(args: Record<string, unknown>) {
  const name = args.name;
  validateNoteName(name);
  const filePath = safeNotePath(name as string);
  if (!fs.existsSync(filePath)) {
    throw new McpError(ErrorCode.InvalidParams, `Note not found: ${name as string}`);
  }
  fs.unlinkSync(filePath);
  indexRemove(name as string);
  return {
    content: [{ type: 'text', text: `Note deleted: ${name as string}` }],
  };
}

export async function handleCreateAgentWorkflow(args: Record<string, unknown>) {
  const files = buildAgentWorkflowFiles(args);
  const paths = files.map(file => {
    validateNoteName(file.name);
    return { ...file, filePath: safeNotePath(file.name) };
  });

  const existing = paths.filter(file => fs.existsSync(file.filePath)).map(file => file.name);
  if (existing.length > 0) {
    throw new McpError(
      ErrorCode.InvalidParams,
      `Agent workflow scaffold already exists for: ${existing.join(', ')}`,
    );
  }

  for (const file of paths) {
    atomicWrite(file.filePath, toHtml(file.content));
  }

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
  const filePath = safeNotePath(name as string);
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
  atomicWrite(filePath, `${existing}\n<hr>\n${toHtml(eventMd)}`);

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
  const filePath = safeNotePath(name as string);
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

// Locate the workflow note governing a task: same folder, type=workflow, id match.
function locateWorkflow(taskMeta: AgentMetadata, taskNoteName: string): LoadedAgentNote | null {
  const workflowId = taskMeta.workflowId;
  if (!workflowId) return null;
  for (const entry of listAllNotes(folderOf(taskNoteName))) {
    if (entry.name === taskNoteName) continue;
    try {
      const filePath = safeNotePath(entry.name);
      const html = fs.readFileSync(filePath, 'utf8');
      const meta = readAgentMetadata(html);
      if (meta && meta.type === 'workflow' && meta.id === workflowId) {
        return { name: entry.name, filePath, html, meta };
      }
    } catch { /* skip unreadable */ }
  }
  return null;
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

function persistAgentNote(note: LoadedAgentNote, meta: AgentMetadata, event: unknown): void {
  const rewritten = writeAgentMetadata(note.html, meta);
  if (!rewritten) {
    throw new McpError(ErrorCode.InternalError, `Failed to update Agent Metadata in ${note.name}`);
  }
  const eventMd = [`## Event ${(event as { type: string }).type}`, '', codeBlockJson(event)].join('\n');
  const finalHtml = `${rewritten}\n<hr>\n${toHtml(eventMd)}`;
  atomicWrite(note.filePath, finalHtml);
  indexUpsert(note.name, finalHtml);
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
    }
  }
  return { ctx, workflow };
}

export async function handleAdvanceAgentState(args: Record<string, unknown>) {
  const note = loadAgentNote(args.name);
  const to = validateNonEmptyString(args.to, 'to');
  const { ctx, workflow } = buildAgentContext(note, args);
  const result = runEngine(() => advance(note.meta, to, ctx));
  persistAgentNote(note, result.metadata, result.event);
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
  persistAgentNote(note, result.metadata, result.event);
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
  persistAgentNote(note, result.metadata, result.event);
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
  [TOOL_NAME.SEARCH_NOTES]: handleSearchNotes,
  [TOOL_NAME.DELETE_NOTE]: handleDeleteNote,
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

  const transportType = getArgValue('--transport') ?? 'stdio';

  if (transportType === 'sse') {
    const portStr = getArgValue('--port');
    const port = portStr ? parseInt(portStr, 10) : 3000;
    const transports = new Map<string, SSEServerTransport>();

    const authToken = getArgValue('--auth-token');

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

      // Token authentication check (only if --auth-token was provided)
      if (authToken) {
        const reqToken = parsedUrl.searchParams.get('token') || req.headers['x-mcp-token'];
        if (reqToken !== authToken) {
          res.writeHead(401);
          res.end('Unauthorized: Invalid or missing token');
          process.stderr.write(`[noted-mcp] Rejected unauthorized request: ${req.method} ${parsedUrl.pathname}\n`);
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
