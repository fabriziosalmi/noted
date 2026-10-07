/**
 * The `noted` command line: the vault from a terminal or a script, for people and agents that do not use MCP.
 *
 * It is the MCP server's own tool handlers behind a command line, so it is held to exactly the same rules: the agent access
 * policy (`.noted/mcp-policy.yaml`: hidden folders do not exist, read-only ones refuse writes, staged ones hold a change for
 * approval), the agent journal (every change is recorded as made by "noted-cli"), etags, the vault's own note format. Nothing here
 * reads or writes a note in a way the tools do not.
 */
import * as path from 'node:path';

export interface CliIo {
  out: (text: string) => void;
  err: (text: string) => void;
  /** All of standard input, or null when there is none (a terminal). */
  stdin: () => Promise<string | null>;
  env: Record<string, string | undefined>;
  cwd: string;
}

const HELP = `noted: your Noted vault from the command line

Usage: noted [--vault <dir>] [--json] <command> [arguments]

Commands:
  list [folder]                  List notes, newest first
  read <note>                    Print a note (the stored text; --json for its parts and etag)
  search <query> [--limit n]     Full-text search
  create <note> [text]           Make a note (the text, or standard input)
  append <note> [text]           Add to the end of a note (made if it does not exist)
  daily [text]                   Today's note (YYYY-MM-DD.md); with text, add it to the end
  tasks [filters]                Tasks across the vault: --status open|done|all, --folder, --tag,
                                 --due-from, --due-to, --overdue, --no-due, --text, --limit
  tags                           Every #tag with its count
  backlinks <note>               The notes that link to a note
  properties <note>              A note's frontmatter properties

Options:
  --vault <dir>   The vault (default: $NOTED_VAULT, the current folder if it is a vault, else Noted's own)
  --json          Print one JSON document: { "ok": true, ... } or { "ok": false, "error": "..." }
  --help, --version

Exit status: 0 done, 1 refused or failed (a hidden or read-only note, a conflict, no such note), 2 wrong usage.
A change in a folder whose changes need approval is held, not made: the output says so (and the status is 0).
`;

interface Parsed {
  command?: string;
  args: string[];
  flags: Map<string, string | true>;
}

const WITH_VALUE = new Set(['vault', 'limit', 'status', 'folder', 'tag', 'due-from', 'due-to', 'text', 'content']);

/** `--flag value`, `--flag=value`, `--switch`; the rest are words. A bare `--` ends the flags. */
export function parseArgs(argv: readonly string[]): Parsed {
  const flags = new Map<string, string | true>();
  const words: string[] = [];
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--') { words.push(...argv.slice(i + 1)); break; }
    if (a === '-h') { flags.set('help', true); continue; }
    if (!a.startsWith('--')) { words.push(a); continue; }
    const eq = a.indexOf('=');
    const name = (eq === -1 ? a.slice(2) : a.slice(2, eq));
    if (eq !== -1) flags.set(name, a.slice(eq + 1));
    else if (WITH_VALUE.has(name) && i + 1 < argv.length) flags.set(name, argv[++i]);
    else flags.set(name, true);
  }
  return { command: words[0], args: words.slice(1), flags };
}

class UsageError extends Error {}

interface ToolResult { content?: { text?: string }[]; isError?: boolean; structuredContent?: Record<string, unknown> }

/** The vault the command is about. */
export function resolveVault(flag: string | undefined, io: Pick<CliIo, 'env' | 'cwd'>, isVault: (dir: string) => boolean): string | undefined {
  if (flag) return path.resolve(io.cwd, flag);
  const fromEnv = io.env.NOTED_VAULT;
  if (fromEnv) return path.resolve(io.cwd, fromEnv);
  return isVault(io.cwd) ? io.cwd : undefined; // otherwise the server's own default
}

/** Run a command line; returns the exit status. */
export async function runCli(argv: readonly string[], io: CliIo): Promise<number> {
  const parsed = parseArgs(argv);
  const json = parsed.flags.has('json');
  const finish = (ok: boolean, data: Record<string, unknown>, text: string): number => {
    if (json) io.out(`${JSON.stringify({ ok, ...data })}\n`);
    else if (ok) { if (text) io.out(text.endsWith('\n') ? text : `${text}\n`); } else io.err(`${text}\n`);
    return ok ? 0 : 1;
  };

  if (parsed.flags.has('version')) {
    const pkg = await import('../package.json');
    io.out(`${pkg.default.version}\n`);
    return 0;
  }

  if (parsed.flags.has('help') || parsed.command === 'help' || parsed.command === undefined) {
    io.out(HELP);
    return parsed.command === undefined && !parsed.flags.has('help') ? 2 : 0;
  }
  const flag = (name: string): string | undefined => {
    const v = parsed.flags.get(name);
    return typeof v === 'string' ? v : undefined;
  };
  const need = (n: number, usage: string): string[] => {
    if (parsed.args.length < n) throw new UsageError(`usage: noted ${usage}`);
    return parsed.args;
  };
  const noteName = (raw: string): string => (/\.md$/i.test(raw) ? raw : `${raw}.md`);
  const text = async (fromArg: string | undefined): Promise<string> => {
    const given = flag('content') ?? fromArg;
    if (given !== undefined) return given;
    const piped = await io.stdin();
    if (piped === null || piped === '') throw new UsageError('no text given: pass it as an argument, with --content, or on standard input');
    return piped;
  };

  // Point the server's modules at the vault before they are loaded: they read it once, when they start.
  const fs = await import('node:fs');
  const vault = resolveVault(flag('vault'), io, dir => fs.existsSync(path.join(dir, '.noted-vault.json')) || fs.existsSync(path.join(dir, '.obsidian')));
  process.argv = [process.argv[0] ?? 'node', 'noted', ...(vault ? ['--notes-dir', vault] : [])];
  const mcp = await import('./index');

  const call = async (work: () => Promise<unknown>): Promise<ToolResult> => (await mcp.runAsClient('noted-cli', work)) as ToolResult;
  const show = (r: ToolResult, extra: Record<string, unknown> = {}): number => {
    const body = r.content?.[0]?.text ?? '';
    return finish(!r.isError, { ...(r.structuredContent ?? { text: body }), ...extra }, body);
  };

  try {
    switch (parsed.command) {
      case 'list':
        return show(await call(() => mcp.handleListNotes(parsed.args[0] ? { folder: parsed.args[0] } : {})));
      case 'read': {
        const [name] = need(1, 'read <note>');
        const r = await call(() => mcp.handleReadNote({ name: noteName(name) }));
        const sc = r.structuredContent as { frontmatterRaw?: string | null; body?: string } | undefined;
        if (sc && !json) return finish(true, {}, `${sc.frontmatterRaw ? `${sc.frontmatterRaw.replace(/\n?$/, '\n')}\n` : ''}${sc.body ?? ''}`);
        return show(r);
      }
      case 'search': {
        need(1, 'search <query> [--limit n]');
        return show(await call(() => mcp.handleSearchNotes({ query: parsed.args.join(' '), ...(flag('limit') ? { max_results: Number(flag('limit')) } : {}) })));
      }
      case 'create': {
        const [name, ...rest] = need(1, 'create <note> [text]');
        const content = await text(rest.length > 0 ? rest.join(' ') : undefined);
        return show(await call(() => mcp.handleCreateNote({ name: noteName(name), content })));
      }
      case 'append': {
        const [name, ...rest] = need(1, 'append <note> [text]');
        const content = await text(rest.length > 0 ? rest.join(' ') : undefined);
        const note = noteName(name);
        const exists = await call(() => mcp.handleReadNote({ name: note })).then(r => !r.isError).catch(() => false);
        return show(await call(() => (exists ? mcp.handleUpdateNote({ name: note, content, append: true }) : mcp.handleCreateNote({ name: note, content }))));
      }
      case 'daily': {
        const now = new Date();
        const pad = (n: number) => String(n).padStart(2, '0');
        const name = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}.md`;
        const addition = flag('content') ?? (parsed.args.length > 0 ? parsed.args.join(' ') : undefined);
        const existing = await call(() => mcp.handleReadNote({ name })).catch((err: Error) => ({ isError: true, content: [{ text: err.message }] } as ToolResult));
        const missing = existing.isError;
        if (addition === undefined && !missing) return show(existing);
        if (addition === undefined) {
          return show(await call(() => mcp.handleCreateNote({ name, content: `# ${name.slice(0, -3)}\n` })));
        }
        if (missing) return show(await call(() => mcp.handleCreateNote({ name, content: `# ${name.slice(0, -3)}\n\n${addition}\n` })));
        return show(await call(() => mcp.handleUpdateNote({ name, content: addition, append: true })));
      }
      case 'tasks': {
        const args: Record<string, unknown> = {};
        for (const [from, to] of [['status', 'status'], ['folder', 'folder'], ['tag', 'tag'], ['due-from', 'due_from'], ['due-to', 'due_to'], ['text', 'text']] as const) {
          const v = flag(from);
          if (v !== undefined) args[to] = v;
        }
        if (parsed.flags.has('overdue')) args.overdue = true;
        if (parsed.flags.has('no-due')) args.no_due = true;
        if (flag('limit')) args.limit = Number(flag('limit'));
        return show(await call(() => mcp.handleListTasks(args)));
      }
      case 'tags':
        return show(await call(() => mcp.handleListTags({})));
      case 'backlinks': {
        const [name] = need(1, 'backlinks <note>');
        return show(await call(() => mcp.handleGetBacklinks({ name: noteName(name) })));
      }
      case 'properties': {
        const [name] = need(1, 'properties <note>');
        return show(await call(() => mcp.handleGetProperties({ name: noteName(name) })));
      }
      default:
        throw new UsageError(`unknown command "${parsed.command}" (try: noted help)`);
    }
  } catch (err) {
    if (err instanceof UsageError) {
      if (json) io.out(`${JSON.stringify({ ok: false, error: err.message, usage: true })}\n`); else io.err(`${err.message}\n`);
      return 2;
    }
    const message = (err instanceof Error ? err.message : String(err)).replace(/^MCP error -?\d+: /, '');
    return finish(false, { error: message }, message);
  }
}
