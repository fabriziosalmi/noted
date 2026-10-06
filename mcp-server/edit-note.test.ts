// @vitest-environment node
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

// edit_note and optimistic concurrency (#81): run against a real temporary vault, as an agent would meet it.
let dir: string;
let mcp: typeof import('./index'); // eslint-disable-line @typescript-eslint/consistent-type-imports
const argv = process.argv;

interface Result { content: { text: string }[]; isError?: boolean; structuredContent?: Record<string, unknown> }
const text = (r: Result): string => r.content[0].text;
const read = (name: string): string => fs.readFileSync(path.join(dir, name), 'utf8');
const write = (name: string, body: string) => { fs.mkdirSync(path.dirname(path.join(dir, name)), { recursive: true }); fs.writeFileSync(path.join(dir, name), body); };

async function load(format: 'markdown' | 'html'): Promise<void> {
  dir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'noted-mcp-edit-')));
  if (format === 'markdown') fs.writeFileSync(path.join(dir, '.noted-vault.json'), JSON.stringify({ format: 'markdown' }));
  process.argv = [argv[0], argv[1], '--notes-dir', dir];
  vi.resetModules();
  mcp = await import('./index');
  mcp.__resetSearchIndex();
}
afterEach(() => { process.argv = argv; fs.rmSync(dir, { recursive: true, force: true }); });

const NOTE = '---\ntitle: Plan\n---\n# Plan\n\nintro\n\n## Risks\n\nrisk one\n\n### Detail\n\nfine print\n\n## Budget\n\nmoney\n';
const etagOf = async (name: string): Promise<string> => (await mcp.handleReadNote({ name }) as Result).structuredContent!.etag as string;
const edit = async (args: Record<string, unknown>) => (await mcp.handleEditNote(args)) as Result;

describe('etags', () => {
  beforeEach(() => load('markdown'));

  it('read_note, create_note and update_note give the etag of what is stored, and it changes with the content only', async () => {
    const created = await mcp.handleCreateNote({ name: 'a.md', content: '# A\n\ntext' }) as Result;
    const etag = created.structuredContent!.etag as string;
    expect(etag).toMatch(/^[0-9a-f]{16}$/);
    expect(await etagOf('a.md')).toBe(etag);
    expect(text(await mcp.handleReadNote({ name: 'a.md' }) as Result)).toContain(`etag ${etag}`);
    fs.utimesSync(path.join(dir, 'a.md'), new Date(), new Date(Date.now() + 5000)); // touched, not changed
    expect(await etagOf('a.md')).toBe(etag);
    const updated = await mcp.handleUpdateNote({ name: 'a.md', content: '# A\n\nother' }) as Result;
    expect(updated.structuredContent!.etag).toBe(await etagOf('a.md'));
    expect(updated.structuredContent!.etag).not.toBe(etag);
  });

  it('update_note with expected_etag is refused, with the current note, when the note changed', async () => {
    write('a.md', 'first\n');
    const etag = await etagOf('a.md');
    write('a.md', 'edited by a person\n');
    const r = await mcp.handleUpdateNote({ name: 'a.md', content: 'agent text', expected_etag: etag }) as Result;
    expect(r.isError).toBe(true);
    expect(text(r)).toContain('edited by a person');
    expect(read('a.md')).toBe('edited by a person\n');
    const ok = await mcp.handleUpdateNote({ name: 'a.md', content: 'agent text', expected_etag: await etagOf('a.md') }) as Result;
    expect(ok.isError).toBeUndefined();
    expect(read('a.md')).toBe('agent text\n');
  });
});

describe('edit_note: concurrency', () => {
  beforeEach(async () => { await load('markdown'); write('plan.md', NOTE); });

  it('needs the version it was made against', async () => {
    await expect(edit({ name: 'plan.md', operation: 'replace', old_text: 'intro', new_text: 'x' })).rejects.toThrow(/expected_etag is required/);
  });

  it('a note changed since is not written, and the current content comes back with the new etag', async () => {
    const etag = await etagOf('plan.md');
    write('plan.md', NOTE.replace('money', 'more money')); // a person edits meanwhile
    const r = await edit({ name: 'plan.md', operation: 'replace', old_text: 'intro', new_text: 'changed', expected_etag: etag });
    expect(r.isError).toBe(true);
    expect(text(r)).toContain('Conflict');
    expect(text(r)).toContain('more money');
    expect(r.structuredContent).toMatchObject({ conflict: true, name: 'plan.md', etag: await etagOf('plan.md') });
    expect(read('plan.md')).toBe(NOTE.replace('money', 'more money'));
    // redone on what came back
    const again = await edit({ name: 'plan.md', operation: 'replace', old_text: 'intro', new_text: 'changed', expected_etag: r.structuredContent!.etag as string });
    expect(again.isError).toBeUndefined();
    expect(read('plan.md')).toBe(NOTE.replace('money', 'more money').replace('intro', 'changed'));
  });

  it('the modified time works instead of the etag', async () => {
    const modified = (await mcp.handleReadNote({ name: 'plan.md' }) as Result).structuredContent!.modified as string;
    const ok = await edit({ name: 'plan.md', operation: 'replace', old_text: 'intro', new_text: 'by time', expected_modified: modified });
    expect(ok.isError).toBeUndefined();
    const later = new Date(Date.now() + 10_000);
    fs.utimesSync(path.join(dir, 'plan.md'), later, later); // the clock's grain can be coarser than two quick edits
    const stale = await edit({ name: 'plan.md', operation: 'replace', old_text: 'by time', new_text: 'again', expected_modified: modified });
    expect(stale.isError).toBe(true);
  });

  it('reports the new etag after an edit, which is the one to use next', async () => {
    const r = await edit({ name: 'plan.md', operation: 'replace', old_text: 'intro', new_text: 'FIRST', expected_etag: await etagOf('plan.md') });
    expect(r.structuredContent).toMatchObject({ changed: true, changes: 1, etag: await etagOf('plan.md') });
    const r2 = await edit({ name: 'plan.md', operation: 'replace', old_text: 'FIRST', new_text: 'SECOND', expected_etag: r.structuredContent!.etag as string });
    expect(r2.isError).toBeUndefined();
  });

  it('a note that is not there, and a bad name', async () => {
    await expect(edit({ name: 'nope.md', operation: 'replace', old_text: 'a', new_text: 'b', expected_etag: 'x' })).rejects.toThrow(/not found/i);
    await expect(edit({ name: '../x.md', operation: 'replace', old_text: 'a', new_text: 'b', expected_etag: 'x' })).rejects.toThrow();
  });
});

describe('edit_note: replace', () => {
  beforeEach(async () => { await load('markdown'); write('plan.md', NOTE); });
  const go = async (args: Record<string, unknown>) => edit({ name: 'plan.md', operation: 'replace', expected_etag: await etagOf('plan.md'), ...args });

  it('changes exactly the text asked, and every other byte stays', async () => {
    await go({ old_text: 'fine print', new_text: 'the details' });
    expect(read('plan.md')).toBe(NOTE.replace('fine print', 'the details'));
  });

  it('an empty new_text deletes; the frontmatter can be edited when it stays valid', async () => {
    await go({ old_text: '\n### Detail\n\nfine print\n', new_text: '' });
    expect(read('plan.md')).toBe(NOTE.replace('\n### Detail\n\nfine print\n', ''));
    await go({ old_text: 'title: Plan', new_text: 'title: Plan\nstatus: open' });
    expect(read('plan.md')).toContain('title: Plan\nstatus: open\n---');
  });

  it('refuses text that is not there, text that is not unique, and says how to go on', async () => {
    await expect(go({ old_text: 'absent', new_text: 'x' })).rejects.toThrow(/not found/);
    await expect(go({ old_text: 'r', new_text: 'x' })).rejects.toThrow(/matches \d+ places.*replace_all/);
    await expect(go({ old_text: '', new_text: 'x' })).rejects.toThrow(/non-empty/);
    await expect(go({ old_text: 'intro' })).rejects.toThrow(/new_text/);
    expect(read('plan.md')).toBe(NOTE);
  });

  it('replace_all changes every occurrence and counts them', async () => {
    const r = await go({ old_text: 'Plan', new_text: 'Project', replace_all: true });
    expect(r.structuredContent).toMatchObject({ changes: 2 });
    expect(read('plan.md')).toBe(NOTE.replace(/Plan/g, 'Project'));
  });

  it('is case-sensitive, and a change that would leave nothing different is not a write', async () => {
    await expect(go({ old_text: 'INTRO', new_text: 'x' })).rejects.toThrow(/not found/);
    const before = fs.statSync(path.join(dir, 'plan.md')).mtimeMs;
    const r = await go({ old_text: 'intro', new_text: 'intro' });
    expect(r.structuredContent).toMatchObject({ changed: false });
    expect(fs.statSync(path.join(dir, 'plan.md')).mtimeMs).toBe(before);
  });

  it('will not break the frontmatter', async () => {
    await expect(go({ old_text: 'title: Plan', new_text: 'title: [unclosed' })).rejects.toThrow(/frontmatter/);
    await expect(go({ old_text: '---\ntitle', new_text: 'title' })).rejects.toThrow(/frontmatter/);
    expect(read('plan.md')).toBe(NOTE);
  });
});

describe('edit_note: sections', () => {
  beforeEach(async () => { await load('markdown'); write('plan.md', NOTE); });
  const go = async (args: Record<string, unknown>) => edit({ name: 'plan.md', expected_etag: await etagOf('plan.md'), ...args });

  it('replace_section changes the text under the heading and keeps its sub-sections, unless whole', async () => {
    await go({ operation: 'replace_section', heading: 'Risks', content: 'a new risk' });
    expect(read('plan.md')).toContain('## Risks\n\na new risk\n\n### Detail\n\nfine print\n\n## Budget');
    await go({ operation: 'replace_section', heading: '## Risks', content: 'only this', whole: true });
    expect(read('plan.md')).toContain('## Risks\n\nonly this\n\n## Budget');
    expect(read('plan.md')).not.toContain('fine print');
  });

  it('append_to_section adds at the end of the section, and leaves the frontmatter and the rest alone', async () => {
    await go({ operation: 'append_to_section', heading: 'Budget', content: '- one more line' });
    expect(read('plan.md')).toBe(NOTE.replace('money\n', 'money\n\n- one more line\n'));
  });

  it('an unknown or ambiguous heading is refused, saying what to do', async () => {
    await expect(go({ operation: 'replace_section', heading: 'Nowhere', content: 'x' })).rejects.toThrow(/no heading/);
    write('dup.md', '## A\n\none\n\n## A\n\ntwo\n');
    await expect(edit({ name: 'dup.md', operation: 'replace_section', heading: 'A', content: 'x', expected_etag: await etagOf('dup.md') })).rejects.toThrow(/matches 2 headings/);
    await edit({ name: 'dup.md', operation: 'replace_section', heading: 'A', occurrence: 2, content: 'x', expected_etag: await etagOf('dup.md') });
    expect(read('dup.md')).toBe('## A\n\none\n\n## A\n\nx\n');
  });

  it('refuses an unknown operation', async () => {
    await expect(go({ operation: 'rewrite' })).rejects.toThrow(/operation must be/);
  });
});

describe('edit_note in an HTML vault', () => {
  beforeEach(async () => { await load('html'); write('h.md', '<h1>H</h1><p>some text</p>'); });

  it('replaces exact text in what is stored, and says section edits need Markdown', async () => {
    await edit({ name: 'h.md', operation: 'replace', old_text: 'some text', new_text: 'other', expected_etag: await etagOf('h.md') });
    expect(read('h.md')).toBe('<h1>H</h1><p>other</p>');
    await expect(edit({ name: 'h.md', operation: 'replace_section', heading: 'H', content: 'x', expected_etag: await etagOf('h.md') })).rejects.toThrow(/Markdown vault/);
  });
});
