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
import { stripUnsafeHtml } from '../shared/security/htmlPolicy.js';
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
  // Strip YAML frontmatter matching useStore.ts
  let markdownBody = content;
  const match = content.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n/);
  if (match) {
    markdownBody = content.slice(match[0].length);
  }
  return stripUnsafeHtml(markdownToHtml(markdownBody));
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
} as const;

type ToolName = (typeof TOOL_NAME)[keyof typeof TOOL_NAME];

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

  const notes = listAllNotes();
  const results: { name: string; snip: string }[] = [];

  for (const note of notes) {
    if (results.length >= maxResults) break;
    try {
      const filePath = safeNotePath(note.name);
      const html = fs.readFileSync(filePath, 'utf8');
      const text = htmlToText(html);
      if (text.toLowerCase().includes(query.toLowerCase())) {
        results.push({ name: note.name, snip: excerpt(text, query) });
      }
    } catch { /* skip unreadable */ }
  }

  if (results.length === 0) {
    return { content: [{ type: 'text', text: `No notes found matching "${query}".` }] };
  }

  const lines = results.map(r => `• **${r.name}**\n  ${r.snip}`);
  return {
    content: [{
      type: 'text',
      text: `${results.length} result${results.length !== 1 ? 's' : ''} for "${query}":\n\n${lines.join('\n\n')}`,
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
  return {
    content: [{ type: 'text', text: `Note deleted: ${name as string}` }],
  };
}

// ─── Server bootstrap ─────────────────────────────────────────────────────────

type ToolHandler = (args: Record<string, unknown>) => Promise<{ content: { type: 'text'; text: string }[] }>;

const TOOL_HANDLERS: Record<ToolName, ToolHandler> = {
  [TOOL_NAME.LIST_NOTES]: handleListNotes,
  [TOOL_NAME.READ_NOTE]: handleReadNote,
  [TOOL_NAME.CREATE_NOTE]: handleCreateNote,
  [TOOL_NAME.UPDATE_NOTE]: handleUpdateNote,
  [TOOL_NAME.SEARCH_NOTES]: handleSearchNotes,
  [TOOL_NAME.DELETE_NOTE]: handleDeleteNote,
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

    const serverHttp = http.createServer(async (req, res) => {
      // CORS headers
      res.setHeader('Access-Control-Allow-Origin', '*');
      res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
      res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

      if (req.method === 'OPTIONS') {
        res.writeHead(200);
        res.end();
        return;
      }

      const parsedUrl = new URL(req.url || '', `http://${req.headers.host || 'localhost'}`);

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

    serverHttp.listen(port, '0.0.0.0', () => {
      process.stderr.write(`[noted-mcp] SSE server listening on http://0.0.0.0:${port}\n`);
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
