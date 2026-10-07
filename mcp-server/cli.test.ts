// @vitest-environment node
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { parseArgs, resolveVault, type CliIo } from './cli';
import { readEntries } from '../shared/vault/journalFile';
import { listPending } from '../shared/vault/pendingFile';

// The `noted` command line (#87), against a real vault: the same handlers and rules as the MCP tools.
let dir: string;
const argv = process.argv;
const p = (n: string) => path.join(dir, n);
const write = (name: string, body: string) => { fs.mkdirSync(path.dirname(p(name)), { recursive: true }); fs.writeFileSync(p(name), body); };
const setPolicy = (yaml: string) => { fs.mkdirSync(p('.noted'), { recursive: true }); fs.writeFileSync(p('.noted/mcp-policy.yaml'), yaml); };

interface Run { code: number; out: string; err: string; json: Record<string, any> }
/** One command line, as a fresh process would run it (the server's modules read the vault when they start). */
async function noted(args: string[], opts: { stdin?: string | null; env?: Record<string, string>; cwd?: string } = {}): Promise<Run> {
  vi.resetModules();
  const { runCli } = await import('./cli');
  let out = '';
  let err = '';
  const io: CliIo = { out: t => { out += t; }, err: t => { err += t; }, stdin: async () => opts.stdin ?? null, env: opts.env ?? {}, cwd: opts.cwd ?? dir };
  const code = await runCli(['--vault', dir, ...args], io);
  let json: Record<string, unknown> = {};
  if (args.includes('--json')) { try { json = JSON.parse(out) as Record<string, unknown>; } catch { /* not JSON */ } }
  return { code, out, err, json };
}

beforeEach(() => {
  dir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'noted-cli-')));
  fs.writeFileSync(p('.noted-vault.json'), JSON.stringify({ format: 'markdown' }));
});
afterEach(() => { process.argv = argv; fs.rmSync(dir, { recursive: true, force: true }); });

describe('reading', () => {
  beforeEach(() => {
    write('Work/plan.md', '---\nstatus: open\n---\n# Plan #work\n\nquarterly roadmap [[Home]]\n\n- [ ] ship it 📅 2026-10-10\n');
    write('Home.md', '# Home\n\nwelcome\n');
  });

  it('list, read (the stored text), search, tasks, tags, backlinks, properties', async () => {
    expect((await noted(['list'])).out).toMatch(/Work\/plan\.md[\s\S]*Home\.md|Home\.md[\s\S]*Work\/plan\.md/);
    expect((await noted(['list', 'Work'])).out).toContain('Work/plan.md');
    expect((await noted(['read', 'Work/plan'])).out).toBe('---\nstatus: open\n---\n\n# Plan #work\n\nquarterly roadmap [[Home]]\n\n- [ ] ship it 📅 2026-10-10\n');
    expect((await noted(['search', 'quarterly', 'roadmap'])).out).toContain('Work/plan.md');
    expect((await noted(['tasks'])).out).toContain('- [ ] ship it (due 2026-10-10) — Work/plan.md:8');
    expect((await noted(['tasks', '--status', 'done'])).out).toBe('No tasks match.\n');
    expect((await noted(['tasks', '--folder=Work', '--no-due'])).out).toBe('No tasks match.\n');
    expect((await noted(['tags'])).out).toContain('#work (1)');
    expect((await noted(['backlinks', 'Home'])).out).toContain('Work/plan.md');
    expect(JSON.parse((await noted(['properties', 'Work/plan.md'])).out.replace(/^[^{]*/, '')) ).toEqual({ status: 'open' });
  });

  it('--json prints one document with ok and the tool\'s own structure', async () => {
    const r = await noted(['--json', 'tasks']);
    expect(r.code).toBe(0);
    expect(r.json).toMatchObject({ ok: true, total: 1, tasks: [{ note: 'Work/plan.md', line: 8, done: false, text: 'ship it', due: '2026-10-10' }] });
    const read = await noted(['--json', 'read', 'Work/plan.md']);
    expect(read.json).toMatchObject({ ok: true, name: 'Work/plan.md', format: 'markdown', frontmatter: { status: 'open' } });
    expect(read.json.etag).toMatch(/^[0-9a-f]{16}$/);
    expect(read.out.trim().split('\n')).toHaveLength(1);
  });

  it('a note that is not there is an error with status 1, in text and in JSON', async () => {
    const t = await noted(['read', 'nothing']);
    expect([t.code, t.out, t.err]).toEqual([1, '', 'Note not found: nothing.md\n']);
    const j = await noted(['--json', 'read', 'nothing']);
    expect(j.code).toBe(1);
    expect(j.json).toEqual({ ok: false, error: 'Note not found: nothing.md' });
  });
});

describe('writing', () => {
  it('create takes the text as arguments, with --content, or from standard input', async () => {
    expect((await noted(['create', 'a', 'first', 'note'])).code).toBe(0);
    expect(fs.readFileSync(p('a.md'), 'utf8')).toBe('first note\n');
    await noted(['create', 'b', '--content=from the flag']);
    expect(fs.readFileSync(p('b.md'), 'utf8')).toBe('from the flag\n');
    await noted(['create', 'c'], { stdin: '# Piped\n\nbody\n' });
    expect(fs.readFileSync(p('c.md'), 'utf8')).toBe('# Piped\n\nbody\n');
    const again = await noted(['create', 'a', 'x']);
    expect([again.code, again.err]).toEqual([1, expect.stringContaining('already exists')]);
  });

  it('append adds to the end of a note, and makes the note when there is none', async () => {
    write('log.md', '# Log\n\nfirst\n');
    await noted(['append', 'log', 'second']);
    const text = fs.readFileSync(p('log.md'), 'utf8');
    expect(text.startsWith('# Log\n\nfirst')).toBe(true);
    expect(text).toContain('second');
    await noted(['append', 'fresh', 'hello']);
    expect(fs.readFileSync(p('fresh.md'), 'utf8')).toBe('hello\n');
  });

  it('daily is today\'s note: made when asked for with text, read when not, added to when it exists', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date(2026, 9, 7, 12));
    try {
      expect((await noted(['daily'])).code).toBe(0);
      expect(fs.readFileSync(p('2026-10-07.md'), 'utf8')).toBe('# 2026-10-07\n');
      await noted(['daily', 'call', 'the', 'plumber']);
      await noted(['daily', '- [ ] buy milk']);
      const text = fs.readFileSync(p('2026-10-07.md'), 'utf8');
      expect(text).toContain('call the plumber');
      expect(text).toContain('- [ ] buy milk');
      expect((await noted(['daily'])).out).toContain('buy milk');
      fs.rmSync(p('2026-10-07.md'));
      await noted(['daily', 'straight in']);
      expect(fs.readFileSync(p('2026-10-07.md'), 'utf8')).toBe('# 2026-10-07\n\nstraight in\n');
    } finally {
      vi.useRealTimers();
    }
  });

  it('what it changes is in the agent journal, as made by noted-cli, and can be undone from the app', async () => {
    await noted(['create', 'a', 'x']);
    const [entry] = readEntries(dir).entries;
    expect(entry).toMatchObject({ client: 'noted-cli', tool: 'create_note', kind: 'create', note: 'a.md', via: 'direct' });
  });
});

describe('the agent access policy applies', () => {
  beforeEach(() => {
    write('private/secret.md', '# Secret\n\nzanzibar\n- [ ] hidden task\n');
    write('Work/plan.md', '# Plan\n');
    write('drafts/idea.md', '# Idea\n');
    setPolicy('default: read-only\nfolders:\n  private: hidden\n  drafts: staged\n  inbox: read-write\n');
  });

  it('a hidden note is not there: not listed, not read, not searched, not in tasks', async () => {
    expect((await noted(['list'])).out).not.toContain('private');
    const read = await noted(['read', 'private/secret']);
    expect([read.code, read.err]).toEqual([1, 'Note not found: private/secret.md\n']);
    expect((await noted(['search', 'zanzibar'])).out).toContain('No notes found');
    expect((await noted(['tasks'])).out).not.toContain('hidden task');
    expect((await noted(['create', 'private/new', 'x'])).code).toBe(1);
  });

  it('a read-only folder refuses writes, with the reason', async () => {
    const r = await noted(['create', 'Work/new', 'x']);
    expect([r.code, r.err]).toEqual([1, expect.stringContaining('read-only for agents')]);
    expect(fs.existsSync(p('Work/new.md'))).toBe(false);
    expect((await noted(['append', 'Work/plan', 'x'])).code).toBe(1);
  });

  it('a staged folder holds the change for approval and says so, with status 0', async () => {
    const r = await noted(['--json', 'append', 'drafts/idea', 'more']);
    expect(r.code).toBe(0);
    expect(r.json).toMatchObject({ ok: true, staged: true, kind: 'update', note: 'drafts/idea.md' });
    expect(fs.readFileSync(p('drafts/idea.md'), 'utf8')).toBe('# Idea\n');
    expect(listPending(dir)[0]).toMatchObject({ client: 'noted-cli', note: 'drafts/idea.md' });
    expect((await noted(['append', 'inbox/new', 'free'])).code).toBe(0);
    expect(fs.existsSync(p('inbox/new.md'))).toBe(true);
  });

  it('an unreadable policy closes the vault, and the command says why', async () => {
    setPolicy('default: hiden\n');
    const r = await noted(['list']);
    expect([r.code, r.err]).toEqual([1, expect.stringContaining('mcp-policy.yaml is invalid')]);
  });
});

describe('usage', () => {
  it('help, version, no command, an unknown command, a missing argument: status and where the message goes', async () => {
    expect((await noted(['help'])).out).toContain('Usage: noted');
    expect((await noted(['--help'])).code).toBe(0);
    const none = await noted([]);
    expect([none.code, none.out]).toEqual([2, expect.stringContaining('Usage: noted')]);
    const unknown = await noted(['frobnicate']);
    expect([unknown.code, unknown.err]).toEqual([2, 'unknown command "frobnicate" (try: noted help)\n']);
    const missing = await noted(['read']);
    expect([missing.code, missing.err]).toEqual([2, 'usage: noted read <note>\n']);
    expect((await noted(['--json', 'read'])).json).toEqual({ ok: false, error: 'usage: noted read <note>', usage: true });
    const empty = await noted(['create', 'x'], { stdin: null });
    expect([empty.code, empty.err]).toContain(2);
    expect((await noted(['--version'])).out).toMatch(/^\d+\.\d+\.\d+\n$/);
  });
});

describe('arguments and the vault', () => {
  it('parseArgs: values after a flag or with =, switches, words, and -- ends the flags', () => {
    expect(parseArgs(['--vault', '/v', '--json', 'read', 'a b', '--limit=5', '--overdue']).flags).toEqual(new Map<string, string | true>([['vault', '/v'], ['json', true], ['limit', '5'], ['overdue', true]]));
    expect(parseArgs(['create', 'x', '--', '--not-a-flag']).args).toEqual(['x', '--not-a-flag']);
    expect(parseArgs(['-h']).flags.has('help')).toBe(true);
  });

  it('the vault is the flag, else NOTED_VAULT, else the current folder when it is one', () => {
    const is = (d: string) => d === '/here';
    expect(resolveVault('/flag', { env: { NOTED_VAULT: '/env' }, cwd: '/here' }, is)).toBe('/flag');
    expect(resolveVault(undefined, { env: { NOTED_VAULT: '/env' }, cwd: '/here' }, is)).toBe('/env');
    expect(resolveVault(undefined, { env: {}, cwd: '/here' }, is)).toBe('/here');
    expect(resolveVault(undefined, { env: {}, cwd: '/elsewhere' }, is)).toBeUndefined();
    expect(resolveVault('rel', { env: {}, cwd: '/base' }, is)).toBe(path.resolve('/base', 'rel'));
  });
});
