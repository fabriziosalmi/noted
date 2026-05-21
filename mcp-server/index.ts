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

// ─── Notes-directory resolution ───────────────────────────────────────────────

function resolveNotesDir(): string {
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
    // Allow the same character set as Noted's ipc-utils.ts
    const base = seg.endsWith('.md') ? seg.slice(0, -3) : seg;
    if (!/^[\w\- .()]+$/.test(base)) {
      throw new McpError(
        ErrorCode.InvalidParams,
        `Invalid segment "${seg}": only alphanumeric, spaces, hyphens, underscores, dots, parentheses allowed`,
      );
    }
  }
}

/** Returns the absolute path to a note, validated to stay inside NOTES_DIR. */
function safeNotePath(name: string): string {
  validateNoteName(name);
  const resolved = path.resolve(NOTES_DIR, name);
  const root = path.resolve(NOTES_DIR);
  if (resolved !== root && !resolved.startsWith(root + path.sep)) {
    throw new McpError(ErrorCode.InvalidParams, 'Path traversal detected');
  }
  return resolved;
}

// ─── Markdown → HTML (dependency-free) ───────────────────────────────────────
// Covers the subset of GFM an LLM is likely to produce: headings, paragraphs,
// bold, italic, inline code, fenced code blocks, unordered/ordered lists, hr,
// and links. Keeps it self-contained with no runtime dependencies.

const escHtml = (s: string) =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

const inlineHtml = (s: string): string => {
  const parts = s.split('`');
  for (let idx = 0; idx < parts.length; idx++) {
    if (idx % 2 === 1) {
      // Inside inline code
      parts[idx] = `<code>${escHtml(parts[idx])}</code>`;
    } else {
      // Outside inline code: escape HTML first, then parse bold, italic, links
      let text = escHtml(parts[idx]);
      text = text
        .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
        .replace(/__(.+?)__/g, '<strong>$1</strong>')
        .replace(/\*(.+?)\*/g, '<em>$1</em>')
        .replace(/_(.+?)_/g, '<em>$1</em>')
        .replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2">$1</a>');
      parts[idx] = text;
    }
  }
  return parts.join('');
};

const matchListItem = (line: string) => {
  const unordered = line.match(/^(\s*)([-*+])\s+(.*)$/);
  if (unordered) {
    return {
      indent: unordered[1].length,
      type: 'ul' as const,
      content: unordered[3]
    };
  }
  const ordered = line.match(/^(\s*)(\d+)\.\s+(.*)$/);
  if (ordered) {
    return {
      indent: ordered[1].length,
      type: 'ol' as const,
      content: ordered[3]
    };
  }
  return null;
};

export function markdownToHtml(md: string): string {
  const lines = md.replace(/\r\n/g, '\n').split('\n');
  const out: string[] = [];
  let i = 0;

  while (i < lines.length) {
    const line = lines[i];

    // Fenced code block
    if (/^```/.test(line)) {
      const lang = line.slice(3).trim();
      const codeLines: string[] = [];
      i++;
      while (i < lines.length && !/^```/.test(lines[i])) {
        codeLines.push(escHtml(lines[i]));
        i++;
      }
      out.push(`<pre><code${lang ? ` class="language-${escHtml(lang)}"` : ''}>${codeLines.join('\n')}</code></pre>`);
      i++;
      continue;
    }

    // Headings
    const hm = line.match(/^(#{1,6})\s+(.+)$/);
    if (hm) {
      const lvl = hm[1].length;
      out.push(`<h${lvl}>${inlineHtml(hm[2].trim())}</h${lvl}>`);
      i++;
      continue;
    }

    // Horizontal rule
    if (/^(?:---|\*\*\*|___)$/.test(line.trim())) {
      out.push('<hr>');
      i++;
      continue;
    }

    // Lists (unordered & ordered)
    const listMatch = matchListItem(line);
    if (listMatch) {
      const listStack: { type: 'ul' | 'ol'; indent: number }[] = [];
      
      while (i < lines.length) {
        const currentLine = lines[i];
        const currentMatch = matchListItem(currentLine);
        if (!currentMatch) {
          break;
        }

        const { indent, type, content } = currentMatch;

        if (listStack.length === 0) {
          listStack.push({ type, indent });
          out.push(`<${type}>`);
        } else {
          const top = listStack[listStack.length - 1];
          if (indent > top.indent) {
            // Nested list
            listStack.push({ type, indent });
            out.push(`<${type}>`);
          } else if (indent < top.indent) {
            // Close nested lists
            while (listStack.length > 0 && listStack[listStack.length - 1].indent > indent) {
              const popped = listStack.pop();
              if (popped) out.push(`</${popped.type}>`);
            }
            if (listStack.length === 0 || listStack[listStack.length - 1].indent < indent) {
              listStack.push({ type, indent });
              out.push(`<${type}>`);
            } else if (listStack[listStack.length - 1].type !== type) {
              const popped = listStack.pop();
              if (popped) out.push(`</${popped.type}>`);
              listStack.push({ type, indent });
              out.push(`<${type}>`);
            }
          } else {
            // Equal indent
            if (top.type !== type) {
              listStack.pop();
              out.push(`</${top.type}>`);
              listStack.push({ type, indent });
              out.push(`<${type}>`);
            }
          }
        }

        out.push(`<li>${inlineHtml(content)}</li>`);
        i++;
      }

      // Close all remaining open lists
      while (listStack.length > 0) {
        const popped = listStack.pop();
        if (popped) out.push(`</${popped.type}>`);
      }
      continue;
    }

    // Blank line → paragraph separator
    if (line.trim() === '') {
      i++;
      continue;
    }

    // Paragraph: collect consecutive non-empty, non-special lines
    const paraLines: string[] = [];
    while (
      i < lines.length &&
      lines[i].trim() !== '' &&
      !/^#{1,6}\s/.test(lines[i]) &&
      !matchListItem(lines[i]) &&
      !/^```/.test(lines[i]) &&
      !/^(?:---|\*\*\*|___)$/.test(lines[i].trim())
    ) {
      paraLines.push(inlineHtml(lines[i]));
      i++;
    }
    if (paraLines.length) out.push(`<p>${paraLines.join('<br>')}</p>`);
  }

  return out.join('\n');
}

// ─── HTML sanitisation (mirrors electron/ipc-utils.ts) ───────────────────────

export function stripUnsafeHtml(html: string): string {
  // Decode numeric entities before scanning so encoded payloads are caught
  const decoded = html
    .replace(/&#x([0-9a-f]+);/gi, (_, h: string) => String.fromCharCode(parseInt(h, 16)))
    .replace(/&#([0-9]+);/gi, (_, d: string) => String.fromCharCode(parseInt(d, 10)));

  return decoded
    .replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, '')
    .replace(/<iframe\b[^<]*(?:(?!<\/iframe>)<[^<]*)*<\/iframe>/gi, '')
    .replace(/<object\b[^<]*(?:(?!<\/object>)<[^<]*)*<\/object>/gi, '')
    .replace(/<embed\b[^>]*>/gi, '')
    .replace(/\son\w+\s*=\s*(?:"[^"]*"|'[^']*'|[^\s>]*)/gi, '')
    .replace(/javascript\s*:/gi, '');
}

// ─── Markdown → HTML conversion ───────────────────────────────────────────────

export function toHtml(content: string): string {
  const trimmed = content.trimStart();
  // If the content already looks like HTML, sanitise and return as-is
  if (trimmed.startsWith('<')) {
    return stripUnsafeHtml(content);
  }
  return stripUnsafeHtml(markdownToHtml(content));
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
        if (item.isFile() && item.name.endsWith('.md')) {
          const stat = fs.statSync(path.join(dir, item.name));
          entries.push({ name: prefix ? `${prefix}/${item.name}` : item.name, mtime: stat.mtime, size: stat.size });
        } else if (item.isDirectory() && !item.name.startsWith('.') && !prefix) {
          // One level deep only
          entries = entries.concat(collect(path.join(dir, item.name), item.name));
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

function excerpt(text: string, query: string, windowChars = 120): string {
  const lower = text.toLowerCase();
  const idx = lower.indexOf(query.toLowerCase());
  if (idx === -1) return text.slice(0, windowChars).replace(/\s+$/, '') + '…';
  const start = Math.max(0, idx - 40);
  const end = Math.min(text.length, idx + query.length + 80);
  const snip = text.slice(start, end).replace(/\s+/g, ' ').trim();
  return (start > 0 ? '…' : '') + snip + (end < text.length ? '…' : '');
}

// ─── Tool definitions ─────────────────────────────────────────────────────────

const TOOLS: Tool[] = [
  {
    name: 'list_notes',
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
    name: 'read_note',
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
    name: 'create_note',
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
    name: 'update_note',
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
    name: 'search_notes',
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
    name: 'delete_note',
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

async function handleListNotes(args: Record<string, unknown>) {
  const folder = typeof args.folder === 'string' ? args.folder : undefined;
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

async function handleReadNote(args: Record<string, unknown>) {
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

async function handleCreateNote(args: Record<string, unknown>) {
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

async function handleUpdateNote(args: Record<string, unknown>) {
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

async function handleSearchNotes(args: Record<string, unknown>) {
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
    const filePath = safeNotePath(note.name);
    try {
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

async function handleDeleteNote(args: Record<string, unknown>) {
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

const server = new Server(
  { name: 'noted', version: '1.0.0' },
  { capabilities: { tools: {} } },
);

server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools: TOOLS }));

server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args = {} } = request.params;
  const safeArgs = args as Record<string, unknown>;

  try {
    switch (name) {
      case 'list_notes':   return await handleListNotes(safeArgs);
      case 'read_note':    return await handleReadNote(safeArgs);
      case 'create_note':  return await handleCreateNote(safeArgs);
      case 'update_note':  return await handleUpdateNote(safeArgs);
      case 'search_notes': return await handleSearchNotes(safeArgs);
      case 'delete_note':  return await handleDeleteNote(safeArgs);
      default:
        throw new McpError(ErrorCode.MethodNotFound, `Unknown tool: ${name}`);
    }
  } catch (err) {
    // Re-throw McpErrors as-is; wrap unexpected errors
    if (err instanceof McpError) throw err;
    throw new McpError(
      ErrorCode.InternalError,
      err instanceof Error ? err.message : String(err),
    );
  }
});

async function main() {
  // Log to stderr only (stdout is reserved for MCP messages)
  process.stderr.write(`[noted-mcp] notes directory: ${NOTES_DIR}\n`);
  if (!fs.existsSync(NOTES_DIR)) {
    process.stderr.write(`[noted-mcp] WARNING: notes directory does not exist yet — it will be created on first write.\n`);
  }

  const transport = new StdioServerTransport();
  await server.connect(transport);
  process.stderr.write('[noted-mcp] server ready\n');
}

main().catch(err => {
  process.stderr.write(`[noted-mcp] fatal: ${err instanceof Error ? err.message : String(err)}\n`);
  process.exit(1);
});
