// @vitest-environment node
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

// The graph tools and resources (#82), against a real vault, including what the access policy must keep out of them.
let dir: string;
let mcp: typeof import('./index'); // eslint-disable-line @typescript-eslint/consistent-type-imports
const argv = process.argv;

interface Result { content: { text: string }[]; isError?: boolean; structuredContent?: Record<string, any> }
const p = (n: string) => path.join(dir, n);
const write = (name: string, body: string) => { fs.mkdirSync(path.dirname(p(name)), { recursive: true }); fs.writeFileSync(p(name), body); };
const sc = async (call: Promise<unknown>) => ((await call) as Result).structuredContent!;

async function load(format: 'markdown' | 'html' = 'markdown'): Promise<void> {
  dir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'noted-mcp-graph-')));
  if (format === 'markdown') fs.writeFileSync(p('.noted-vault.json'), JSON.stringify({ format: 'markdown' }));
  process.argv = [argv[0], argv[1], '--notes-dir', dir];
  vi.resetModules();
  mcp = await import('./index');
  mcp.__resetSearchIndex();
}
afterEach(() => { process.argv = argv; fs.rmSync(dir, { recursive: true, force: true }); });

describe('links', () => {
  beforeEach(async () => {
    await load();
    write('Home.md', '---\naliases: [Start]\n---\n# Home\n\nwelcome #hub\n');
    write('Work/Plan.md', '# Plan #work\n\nback to [[Home]] and [[home#Setup|the start]] and [[Nowhere]] and [[Start]]\n');
    write('Work/Notes.md', '# Notes\n\nsee [[Work/Plan]] and [[Plan]]\n');
    write('Other.md', '# Other\n\nno links\n');
  });

  it('backlinks: who links to a note, by name, alias, heading or folder-less name, counted, never itself', async () => {
    expect(await sc(mcp.handleGetBacklinks({ name: 'Home.md' }))).toEqual({ note: 'Home.md', backlinks: [{ note: 'Work/Plan.md', links: 3 }] });
    expect((await sc(mcp.handleGetBacklinks({ name: 'Work/Plan.md' }))).backlinks).toEqual([{ note: 'Work/Notes.md', links: 2 }]);
    expect((await sc(mcp.handleGetBacklinks({ name: 'Other.md' }))).backlinks).toEqual([]);
    await expect(mcp.handleGetBacklinks({ name: 'missing.md' })).rejects.toThrow(/not found/i);
    await expect(mcp.handleGetBacklinks({ name: '../x.md' })).rejects.toThrow();
  });

  it('outgoing links: each with the note it points to, null when there is none, its heading and alias', async () => {
    const { links } = await sc(mcp.handleGetOutgoingLinks({ name: 'Work/Plan.md' }));
    expect(links).toEqual([
      { target: 'Home', resolved: 'Home.md' },
      { target: 'home', resolved: 'Home.md', heading: 'Setup', alias: 'the start' },
      { target: 'Nowhere', resolved: null },
      { target: 'Start', resolved: 'Home.md' },
    ]);
  });

  it('follows edits made behind its back', async () => {
    expect((await sc(mcp.handleGetBacklinks({ name: 'Other.md' }))).backlinks).toEqual([]);
    write('Work/Plan.md', '# Plan\n\n[[Other]]\n');
    fs.utimesSync(p('Work/Plan.md'), new Date(), new Date(Date.now() + 5000));
    expect((await sc(mcp.handleGetBacklinks({ name: 'Other.md' }))).backlinks).toEqual([{ note: 'Work/Plan.md', links: 1 }]);
    fs.rmSync(p('Work/Plan.md'));
    expect((await sc(mcp.handleGetBacklinks({ name: 'Other.md' }))).backlinks).toEqual([]);
  });
});

describe('tags and properties', () => {
  beforeEach(async () => {
    await load();
    write('a.md', '---\nstatus: open\nvotes: 3\ntags: [x]\nmeta:\n  nested: 1\n---\n# A #work #Idea\n');
    write('b.md', '# B #work\n');
    write('c.md', '# C #work/sub\n');
  });

  it('list_tags counts the notes per tag, most used first; list_by_tag finds them, newest first, with or without the #', async () => {
    const { tags, total } = await sc(mcp.handleListTags({}));
    expect(total).toBe(3);
    expect(tags[0]).toEqual({ tag: '#work', count: 2 });
    expect(tags.map((t: { tag: string }) => t.tag).sort()).toEqual(['#idea', '#work', '#work/sub']);
    expect((await sc(mcp.handleListByTag({ tag: 'WORK' }))).notes.sort()).toEqual(['a.md', 'b.md']);
    expect((await sc(mcp.handleListByTag({ tag: '#idea' }))).notes).toEqual(['a.md']);
    expect((await sc(mcp.handleListByTag({ tag: 'none' }))).notes).toEqual([]);
    await expect(mcp.handleListByTag({ tag: ' ' })).rejects.toThrow(/tag/);
    expect((await sc(mcp.handleListTags({ limit: 1 }))).tags).toHaveLength(1);
  });

  it('get_properties returns typed values, leaving out nested mappings', async () => {
    expect((await sc(mcp.handleGetProperties({ name: 'a.md' }))).properties).toEqual({ status: 'open', votes: 3, tags: ['x'] });
    expect((await sc(mcp.handleGetProperties({ name: 'b.md' }))).properties).toEqual({});
    await expect(mcp.handleGetProperties({ name: 'zzz.md' })).rejects.toThrow(/not found/i);
  });
});

describe('query_notes', () => {
  beforeEach(async () => {
    await load();
    write('Work/one.md', '---\nstatus: open\nvotes: 3\ndue: 2026-10-09\n---\n# One #q4\n');
    write('Work/two.md', '---\nstatus: done\nvotes: 12\n---\n# Two\n');
    write('Work/deep/three.md', '---\nstatus: open\nvotes: 7\n---\n# Three #q4\n');
    write('Home/four.md', '---\nstatus: open\n---\n# Four\n');
    write('plain.md', '# Plain\n');
  });
  const names = async (args: Record<string, unknown>) => (await sc(mcp.handleQueryNotes(args))).notes.map((n: { note: string }) => n.note);

  it('filters, sorts and picks columns, like a table view', async () => {
    expect(await names({ filters: [{ field: 'status', op: 'equals', value: 'open' }], sort: [{ field: 'votes', dir: 'desc' }] })).toEqual(['Work/deep/three.md', 'Work/one.md', 'Home/four.md']);
    expect(await names({ filters: [{ field: 'votes', op: 'gt', value: 5 }], sort: [{ field: '$name', dir: 'asc' }] })).toEqual(['Work/two.md', 'Work/deep/three.md'].sort());
    expect(await names({ filters: [{ field: 'due', op: 'before', value: '2026-10-10' }] })).toEqual(['Work/one.md']);
    expect(await names({ filters: [{ field: 'votes', op: 'is-empty' }] })).toEqual(expect.arrayContaining(['Home/four.md', 'plain.md']));
    const r = await sc(mcp.handleQueryNotes({ folder: 'Work', columns: ['status'], sort: [{ field: 'votes', dir: 'asc' }] }));
    expect(r.notes).toEqual([
      expect.objectContaining({ note: 'Work/one.md', properties: { status: 'open' } }),
      expect.objectContaining({ note: 'Work/deep/three.md', properties: { status: 'open' } }),
      expect.objectContaining({ note: 'Work/two.md', properties: { status: 'done' } }),
    ]);
    expect(r.total).toBe(3);
  });

  it('from a folder (any depth, not one that starts alike) or a tag; all properties when no columns are named', async () => {
    expect((await names({ folder: 'Work' })).sort()).toEqual(['Work/deep/three.md', 'Work/one.md', 'Work/two.md']);
    expect((await names({ tag: 'q4' })).sort()).toEqual(['Work/deep/three.md', 'Work/one.md']);
    const all = await sc(mcp.handleQueryNotes({ folder: 'Work/deep' }));
    expect(all.notes[0].properties).toEqual({ status: 'open', votes: 7 });
  });

  it('limit says how many there are in all; no match says so', async () => {
    const r = await sc(mcp.handleQueryNotes({ limit: 2 }));
    expect(r.notes).toHaveLength(2);
    expect(r.total).toBe(5);
    expect(((await mcp.handleQueryNotes({ filters: [{ field: 'status', op: 'equals', value: 'nope' }] })) as Result).content[0].text).toBe('No note matches.');
  });

  it('refuses a query it would have to guess at, rather than answering a wider one', async () => {
    await expect(mcp.handleQueryNotes({ filters: [{ field: 'status', op: 'resembles', value: 'x' }] })).rejects.toThrow(/field and an op/);
    await expect(mcp.handleQueryNotes({ filters: 'status' })).rejects.toThrow(/filters/);
    await expect(mcp.handleQueryNotes({ sort: [{ dir: 'asc' }] })).rejects.toThrow(/sort/);
    await expect(mcp.handleQueryNotes({ columns: [1] })).rejects.toThrow(/columns/);
    await expect(mcp.handleQueryNotes({ folder: 3 })).rejects.toThrow(/string/);
  });
});

describe('what the access policy keeps out', () => {
  beforeEach(async () => {
    await load();
    write('Pub.md', '---\nstatus: open\n---\n# Pub #shared\n\nsee [[Secret]] and [[Other]]\n');
    write('Other.md', '# Other\n\n[[Secret]]\n');
    write('private/Secret.md', '---\nstatus: open\nclassified: yes\n---\n# Secret #shared #hidden-tag\n\nlinks to [[Pub]] and [[Other]]\n');
    fs.mkdirSync(p('.noted'), { recursive: true });
    fs.writeFileSync(p('.noted/mcp-policy.yaml'), 'default: read-only\nfolders:\n  private: hidden\n');
  });

  it('a hidden note links to nothing and is linked to by nothing, as far as an agent can tell', async () => {
    expect((await sc(mcp.handleGetBacklinks({ name: 'Pub.md' }))).backlinks).toEqual([]); // the only note linking to it is hidden
    expect((await sc(mcp.handleGetBacklinks({ name: 'Other.md' }))).backlinks).toEqual([{ note: 'Pub.md', links: 1 }]);
    const { links } = await sc(mcp.handleGetOutgoingLinks({ name: 'Pub.md' }));
    expect(links).toEqual([{ target: 'Secret', resolved: null }, { target: 'Other', resolved: 'Other.md' }]); // it does not even resolve
    await expect(mcp.handleGetBacklinks({ name: 'private/Secret.md' })).rejects.toThrow(/not found/i);
    await expect(mcp.handleGetOutgoingLinks({ name: 'private/Secret.md' })).rejects.toThrow(/not found/i);
    await expect(mcp.handleGetProperties({ name: 'private/Secret.md' })).rejects.toThrow(/not found/i);
  });

  it('its tags, properties and presence do not appear in tags, queries or lists', async () => {
    const tags = (await sc(mcp.handleListTags({}))).tags.map((t: { tag: string }) => t.tag);
    expect(tags).toContain('#shared');
    expect(tags).not.toContain('#hidden-tag');
    expect((await sc(mcp.handleListByTag({ tag: 'shared' }))).notes).toEqual(['Pub.md']);
    expect((await sc(mcp.handleQueryNotes({ filters: [{ field: 'status', op: 'equals', value: 'open' }] }))).notes.map((n: { note: string }) => n.note)).toEqual(['Pub.md']);
    expect((await sc(mcp.handleQueryNotes({ filters: [{ field: 'classified', op: 'not-empty' }] }))).total).toBe(0);
  });
});

describe('notes as resources', () => {
  beforeEach(async () => {
    await load();
    write('Plan.md', '# Plan\n\ntext\n');
    write('Work/My notes & ideas.md', '# Mine\n');
    write('private/Secret.md', '# Secret\n');
    fs.mkdirSync(p('.noted'), { recursive: true });
    fs.writeFileSync(p('.noted/mcp-policy.yaml'), 'default: read-only\nfolders:\n  private: hidden\n');
  });

  it('every readable note is a resource at noted://note/<path>, a path with odd characters encoded; a hidden one is not listed', () => {
    const { resources } = mcp.handleListResources();
    expect(resources.map(r => r.uri).sort()).toEqual(['noted://note/Plan.md', 'noted://note/Work/My%20notes%20%26%20ideas.md']);
    expect(resources[0]).toMatchObject({ mimeType: 'text/markdown' });
    expect(mcp.noteFromResourceUri('noted://note/Work/My%20notes%20%26%20ideas.md')).toBe('Work/My notes & ideas.md');
    expect(mcp.resourceUri('Work/My notes & ideas.md')).toBe('noted://note/Work/My%20notes%20%26%20ideas.md');
  });

  it('reading gives the stored text; a hidden note, a missing one and a bad address say what they are', () => {
    expect(mcp.handleReadResource('noted://note/Plan.md').contents[0]).toEqual({ uri: 'noted://note/Plan.md', mimeType: 'text/markdown', text: '# Plan\n\ntext\n' });
    expect(() => mcp.handleReadResource('noted://note/private/Secret.md')).toThrow(/not found/i);
    expect(() => mcp.handleReadResource('noted://note/missing.md')).toThrow(/not found/i);
    expect(() => mcp.handleReadResource('file:///etc/passwd')).toThrow(/Unknown resource/);
    expect(() => mcp.handleReadResource('noted://note/..%2F..%2Fetc%2Fpasswd')).toThrow();
    expect(() => mcp.handleReadResource('noted://note/%E0%A4%A')).toThrow(/Invalid/);
  });
});

describe('on the wire', () => {
  it('the server answers resources/list, resources/templates/list and resources/read, and advertises the capability', async () => {
    const { Server } = await import('@modelcontextprotocol/sdk/server/index.js');
    const { ListResourcesRequestSchema, ListResourceTemplatesRequestSchema, ReadResourceRequestSchema } = await import('@modelcontextprotocol/sdk/types.js');
    const spy = vi.spyOn(Server.prototype, 'setRequestHandler');
    await load();
    write('Plan.md', '# Plan\n');
    const handler = (schema: unknown) => spy.mock.calls.find(c => c[0] === schema)![1] as (r: unknown) => Promise<any>;
    expect((await handler(ListResourcesRequestSchema)({})).resources.map((r: { uri: string }) => r.uri)).toEqual(['noted://note/Plan.md']);
    expect((await handler(ListResourceTemplatesRequestSchema)({})).resourceTemplates[0].uriTemplate).toBe('noted://note/{path}');
    expect((await handler(ReadResourceRequestSchema)({ params: { uri: 'noted://note/Plan.md' } })).contents[0].text).toBe('# Plan\n');
    spy.mockRestore();
  });
});

describe('in an HTML vault', () => {
  it('links and tags are read from the stored HTML, and notes are text/html resources', async () => {
    await load('html');
    write('a.md', '<h1>A</h1><p>see [[B]] #topic</p>');
    write('b.md', '<h1>B</h1>');
    expect((await sc(mcp.handleGetBacklinks({ name: 'b.md' }))).backlinks).toEqual([{ note: 'a.md', links: 1 }]);
    expect((await sc(mcp.handleListByTag({ tag: 'topic' }))).notes).toEqual(['a.md']);
    expect(mcp.handleListResources().resources[0].mimeType).toBe('text/html');
  });
});
