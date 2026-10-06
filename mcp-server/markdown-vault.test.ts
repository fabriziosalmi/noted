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

  it('read_note shows the Markdown, labelled as such', async () => {
    await mcp.handleCreateNote({ name: 'a.md', content: '# Plan\n\nsee [the doc](x.md) **now**' });
    const out = text(await mcp.handleReadNote({ name: 'a.md' }));
    expect(out).toContain('## Markdown');
    expect(out).not.toContain('## Raw HTML');
    expect(out).toContain('Plan');
    expect(out).toContain('see [the doc](x.md) **now**');
  });

  it('read_note returns the parsed frontmatter and the Markdown body, once, with a versioned structured result', async () => {
    fs.writeFileSync(path.join(dir, 'a.md'), '---\ntitle: Plan\ntags: [x, y]\nnested:\n  k: 1\n# a comment\n---\n\n# Plan\n\nbody **here**\n');
    const res = await mcp.handleReadNote({ name: 'a.md' }) as { content: { text: string }[]; structuredContent: Record<string, unknown> };
    expect(res.structuredContent).toMatchObject({
      schemaVersion: 2,
      name: 'a.md',
      format: 'markdown',
      frontmatter: { title: 'Plan', tags: ['x', 'y'], nested: { k: 1 } },
      body: '# Plan\n\nbody **here**\n',
    });
    expect(res.structuredContent.frontmatterRaw).toBe('---\ntitle: Plan\ntags: [x, y]\nnested:\n  k: 1\n# a comment\n---\n');
    const out = res.content[0].text;
    expect(out).toContain('## Frontmatter');
    expect(out).toContain('"title": "Plan"');
    expect(out.match(/body \*\*here\*\*/g)).toHaveLength(1); // not repeated as "plain text" as well
    expect(out).not.toContain('title: Plan'); // the YAML text is not sent twice either
  });

  it('read_note on a note with no frontmatter, empty frontmatter and broken frontmatter', async () => {
    fs.writeFileSync(path.join(dir, 'none.md'), '# Just text\n');
    fs.writeFileSync(path.join(dir, 'empty.md'), '---\n---\n\n# E\n');
    fs.writeFileSync(path.join(dir, 'bad.md'), '---\nkey: [unclosed\n---\n\n# B\n');
    const read = async (n: string) => (await mcp.handleReadNote({ name: n }) as { structuredContent: Record<string, unknown>; content: { text: string }[] });
    expect((await read('none.md')).structuredContent).toMatchObject({ frontmatter: null, frontmatterRaw: null, body: '# Just text\n' });
    expect((await read('empty.md')).structuredContent).toMatchObject({ frontmatter: {}, body: '# E\n' });
    const bad = await read('bad.md');
    expect(bad.structuredContent.frontmatter).toBeNull();
    expect(bad.structuredContent.frontmatterError).toBeTruthy();
    expect(bad.structuredContent.frontmatterRaw).toBe('---\nkey: [unclosed\n---\n'); // still handed over, so an agent can fix it
    expect(bad.structuredContent.body).toBe('# B\n');
    expect(bad.content[0].text).toContain('not parsed');
  });

  it('what read_note gives back is what update_note accepts: frontmatter and body round trip', async () => {
    fs.writeFileSync(path.join(dir, 'a.md'), '---\ntitle:   Plan\n---\n\n# Plan\n\ntext\n');
    const got = await mcp.handleReadNote({ name: 'a.md' }) as { structuredContent: { frontmatterRaw: string; body: string } };
    await mcp.handleUpdateNote({ name: 'a.md', content: got.structuredContent.frontmatterRaw + '\n' + got.structuredContent.body });
    expect(read('a.md')).toBe('---\ntitle:   Plan\n---\n\n# Plan\n\ntext\n');
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

  it('read_note keeps the layout clients were written against, and adds a versioned structured result', async () => {
    fs.writeFileSync(path.join(dir, 'a.md'), '<!--noted-frontmatter:' + encodeURIComponent('---\ntitle: Old\n---') + '-->\n<h1>Old</h1><p>text</p>');
    const res = await mcp.handleReadNote({ name: 'a.md' }) as { content: { text: string }[]; structuredContent: Record<string, unknown> };
    expect(res.content[0].text).toMatch(/## Content \(plain text\)\n[\s\S]*Old[\s\S]*## Raw HTML\n<!--noted-frontmatter:/);
    expect(res.structuredContent).toMatchObject({ schemaVersion: 2, format: 'html', frontmatter: { title: 'Old' }, body: '<h1>Old</h1><p>text</p>' });
  });

  it('append adds a rule and the new HTML', async () => {
    await mcp.handleCreateNote({ name: 'a.md', content: 'one' });
    await mcp.handleUpdateNote({ name: 'a.md', content: 'two', append: true });
    expect(read('a.md')).toMatch(/<p>one<\/p>\n+<hr>\n<p>two<\/p>/);
  });
});

describe('the search index of a big vault', () => {
  beforeEach(() => load('markdown'));

  it('holds far more than the old 1,500 notes', async () => {
    for (let i = 0; i < 1600; i++) fs.writeFileSync(path.join(dir, `n${i}.md`), `# N${i}\n\nfiller ${i}\n`);
    fs.writeFileSync(path.join(dir, 'oldest.md'), '# Oldest\n\nzanzibar\n');
    const old = new Date(Date.now() - 3_600_000); // the oldest note: the first one the old cap dropped
    fs.utimesSync(path.join(dir, 'oldest.md'), old, old);
    expect(text(await mcp.handleSearchNotes({ query: 'zanzibar' }))).toContain('oldest.md');
  });

  it('on a refresh reads again only what changed, and forgets what is gone', async () => {
    fs.writeFileSync(path.join(dir, 'a.md'), '# A\n\nalpha\n');
    fs.writeFileSync(path.join(dir, 'b.md'), '# B\n\nbravo\n');
    expect(text(await mcp.handleSearchNotes({ query: 'alpha' }))).toContain('a.md');

    // Edited and deleted behind the server's back, then the staleness window passes.
    fs.writeFileSync(path.join(dir, 'a.md'), '# A\n\ncharlie\n');
    const later = new Date(Date.now() + 5000);
    fs.utimesSync(path.join(dir, 'a.md'), later, later);
    fs.rmSync(path.join(dir, 'b.md'));
    // A note whose modification time did not move is not read again: its new content stays unseen until it does.
    fs.writeFileSync(path.join(dir, 'c.md'), '# C\n\ndelta\n');
    const stamp = new Date(Date.now() - 10_000);
    fs.utimesSync(path.join(dir, 'c.md'), stamp, stamp);
    mcp.__resetSearchIndex();
    expect(text(await mcp.handleSearchNotes({ query: 'delta' }))).toContain('c.md');
    fs.writeFileSync(path.join(dir, 'c.md'), '# C\n\necho\n');
    fs.utimesSync(path.join(dir, 'c.md'), stamp, stamp);
    vi.useFakeTimers({ toFake: ['Date'] });
    try {
      vi.setSystemTime(Date.now() + 60_000);
      expect(text(await mcp.handleSearchNotes({ query: 'charlie' }))).toContain('a.md');
      expect(text(await mcp.handleSearchNotes({ query: 'bravo' }))).not.toContain('b.md');
      expect(text(await mcp.handleSearchNotes({ query: 'alpha' }))).not.toContain('a.md');
      expect(text(await mcp.handleSearchNotes({ query: 'echo' }))).not.toContain('c.md');
      expect(text(await mcp.handleSearchNotes({ query: 'delta' }))).toContain('c.md');
    } finally {
      vi.useRealTimers();
    }
  });
});
