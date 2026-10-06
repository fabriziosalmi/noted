// @vitest-environment node
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

// The MCP server and the app must agree on a vault's format (ADR 0001): these run the handlers against a
// real temporary vault, once as a Markdown vault and once as an HTML one.

let dir: string;
let mcp: typeof import('./index'); // eslint-disable-line @typescript-eslint/consistent-type-imports
const argv = process.argv;

const text = (r: { content: { text: string }[] }): string => r.content[0].text;
const read = (name: string): string => fs.readFileSync(path.join(dir, name), 'utf8');

async function load(format: 'markdown' | 'html'): Promise<void> {
  dir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'noted-mcp-'))); // the real path: macOS's tmp is a symlink
  if (format === 'markdown') fs.writeFileSync(path.join(dir, '.noted-vault.json'), JSON.stringify({ format: 'markdown' }));
  process.argv = [argv[0], argv[1], '--notes-dir', dir];
  vi.resetModules();
  mcp = await import('./index');
  mcp.__resetSearchIndex();
}

afterEach(() => {
  process.argv = argv;
  fs.rmSync(dir, { recursive: true, force: true });
});

describe('a Markdown vault', () => {
  beforeEach(() => load('markdown'));

  it('create_note stores Markdown, normalized, not HTML', async () => {
    await mcp.handleCreateNote({ name: 'a.md', content: '# Plan\n\n* one\n* two\n\n[[B]] and **bold**' });
    expect(read('a.md')).toBe('# Plan\n\n- one\n- two\n\n[[B]] and **bold**\n');
  });

  it('create_note keeps frontmatter exactly', async () => {
    await mcp.handleCreateNote({ name: 'a.md', content: '---\ntags: [x]   # mine\n---\n# T\n' });
    expect(read('a.md')).toBe('---\ntags: [x]   # mine\n---\n\n# T\n');
  });

  it('create_note converts HTML a client still sends (and drops scripts)', async () => {
    await mcp.handleCreateNote({ name: 'a.md', content: '<h1>Title</h1><p>some <strong>bold</strong></p><script>alert(1)</script>' });
    const stored = read('a.md');
    expect(stored).toBe('# Title\n\nsome **bold**\n');
  });

  it('read_note shows the Markdown, labelled as such, and its plain text', async () => {
    await mcp.handleCreateNote({ name: 'a.md', content: '# Plan\n\nsee [the doc](x.md) **now**' });
    const out = text(await mcp.handleReadNote({ name: 'a.md' }));
    expect(out).toContain('## Markdown');
    expect(out).not.toContain('## Raw HTML');
    expect(out).toContain('Plan');
    expect(out).toContain('see the doc now');
  });

  it('update_note replaces; with append it leaves the existing text byte for byte and adds a rule', async () => {
    fs.writeFileSync(path.join(dir, 'h.md'), '* hand   written\n*  list\n');
    await mcp.handleUpdateNote({ name: 'h.md', content: 'more *text*', append: true });
    expect(read('h.md')).toBe('* hand   written\n*  list\n\n---\n\nmore *text*\n');
    await mcp.handleUpdateNote({ name: 'h.md', content: '# New' });
    expect(read('h.md')).toBe('# New\n');
  });

  it('append does not carry frontmatter from the addition into the middle of the note', async () => {
    await mcp.handleCreateNote({ name: 'a.md', content: '# A' });
    await mcp.handleUpdateNote({ name: 'a.md', content: '---\nx: 1\n---\nbody', append: true });
    expect(read('a.md')).toBe('# A\n\n---\n\nbody\n');
  });

  it('search_notes finds Markdown by its words, not its syntax', async () => {
    await mcp.handleCreateNote({ name: 'a.md', content: '# Alpha\n\nthe **quarterly** [roadmap](r.md)' });
    mcp.__resetSearchIndex();
    expect(text(await mcp.handleSearchNotes({ query: 'quarterly roadmap' }))).toContain('a.md');
  });

  it('a note that starts with an HTML tag is still read as Markdown when listed and searched', async () => {
    fs.writeFileSync(path.join(dir, 'k.md'), '<kbd>Ctrl</kbd> + K opens the palette\n');
    mcp.__resetSearchIndex();
    expect(text(await mcp.handleSearchNotes({ query: 'palette' }))).toContain('k.md');
  });

  it('the agent workflow is scaffolded, advanced and logged in Markdown', async () => {
    await mcp.handleCreateAgentWorkflow({ folder: 'wf', workflow_id: 'WF1', title: 'Ship it', goal: 'ship', tasks: [{ id: 'T1', title: 'do it' }] });
    const names = fs.readdirSync(path.join(dir, 'wf')).map(n => `wf/${n}`);
    expect(names.length).toBe(5);
    for (const n of names) expect(read(n).trimStart().startsWith('<')).toBe(false);
    const task = 'wf/task-T1-do-it.md';
    expect(read(task)).toContain('```json');
    await mcp.handleAdvanceAgentState({ name: task, to: 'ready' });
    const after = read(task);
    expect(after.trimStart().startsWith('<')).toBe(false);
    expect(after).toContain('"status": "ready"');
    expect(after).toContain('## Event');
    // and it is still an agent note the engine can read
    await mcp.handleAdvanceAgentState({ name: task, to: 'claimed' });
    expect(read(task)).toContain('"status": "claimed"');
    // the workflow note mirrors the task's status
    expect(read('wf/wf-WF1-ship-it.md')).toContain('"status": "claimed"');
  });

  it('refuses to write while the app is converting the vault', async () => {
    fs.mkdirSync(path.join(dir, '.noted'), { recursive: true });
    fs.writeFileSync(path.join(dir, '.noted', 'migration.lock'), '{}');
    await expect(mcp.handleCreateNote({ name: 'a.md', content: 'x' })).rejects.toThrow(/converted/);
    expect(fs.existsSync(path.join(dir, 'a.md'))).toBe(false);
  });
});

describe('an HTML vault (unchanged)', () => {
  beforeEach(() => load('html'));

  it('stores HTML and reads it back as HTML', async () => {
    await mcp.handleCreateNote({ name: 'a.md', content: '# Plan\n\n**bold**' });
    expect(read('a.md')).toContain('<h1>Plan</h1>');
    expect(text(await mcp.handleReadNote({ name: 'a.md' }))).toContain('## Raw HTML');
  });

  it('append adds a rule and the new HTML', async () => {
    await mcp.handleCreateNote({ name: 'a.md', content: 'one' });
    await mcp.handleUpdateNote({ name: 'a.md', content: 'two', append: true });
    expect(read('a.md')).toMatch(/<p>one<\/p>\n+<hr>\n<p>two<\/p>/);
  });
});
