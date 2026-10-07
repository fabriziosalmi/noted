// @vitest-environment node
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { readEntries, readBlob, verifyJournal, journalDir } from '../shared/vault/journalFile';
import { sha256Hex } from '../shared/vault/etag';

// The agent journal (#84): every change made through MCP is recorded, before it is made.
let dir: string;
let mcp: typeof import('./index'); // eslint-disable-line @typescript-eslint/consistent-type-imports
const argv = process.argv;
interface Result { content: { text: string }[]; structuredContent?: Record<string, unknown> }
const p = (n: string) => path.join(dir, n);
const write = (name: string, body: string) => { fs.mkdirSync(path.dirname(p(name)), { recursive: true }); fs.writeFileSync(p(name), body); };
const entries = () => readEntries(dir).entries;

beforeEach(async () => {
  dir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'noted-mcp-journal-')));
  fs.writeFileSync(p('.noted-vault.json'), JSON.stringify({ format: 'markdown' }));
  process.argv = [argv[0], argv[1], '--notes-dir', dir];
  vi.resetModules();
  mcp = await import('./index');
});
afterEach(() => { process.argv = argv; fs.rmSync(dir, { recursive: true, force: true }); });

describe('what is recorded', () => {
  it('create, update, edit and delete: who, what tool, which note, the hashes before and after, and the content to undo with', async () => {
    await mcp.handleCreateNote({ name: 'a.md', content: '# A\n\none' });
    const afterCreate = fs.readFileSync(p('a.md'), 'utf8');
    await mcp.handleUpdateNote({ name: 'a.md', content: 'two' });
    const afterUpdate = fs.readFileSync(p('a.md'), 'utf8');
    const etag = ((await mcp.handleReadNote({ name: 'a.md' })) as Result).structuredContent!.etag as string;
    await mcp.handleEditNote({ name: 'a.md', operation: 'replace', old_text: 'two', new_text: 'three', expected_etag: etag });
    const afterEdit = fs.readFileSync(p('a.md'), 'utf8');
    await mcp.handleDeleteNote({ name: 'a.md' });

    const [c, u, e, d] = entries();
    expect([c, u, e, d].map(x => [x.seq, x.tool, x.kind, x.via, x.note, x.client])).toEqual([
      [1, 'create_note', 'create', 'direct', 'a.md', 'unknown client'],
      [2, 'update_note', 'update', 'direct', 'a.md', 'unknown client'],
      [3, 'edit_note', 'update', 'direct', 'a.md', 'unknown client'],
      [4, 'delete_note', 'delete', 'direct', 'a.md', 'unknown client'],
    ]);
    expect([c.beforeHash, c.afterHash]).toEqual([null, sha256Hex(afterCreate)]);
    expect([u.beforeHash, u.afterHash]).toEqual([sha256Hex(afterCreate), sha256Hex(afterUpdate)]);
    expect([e.beforeHash, e.afterHash]).toEqual([sha256Hex(afterUpdate), sha256Hex(afterEdit)]);
    expect([d.beforeHash, d.afterHash]).toEqual([sha256Hex(afterEdit), null]);
    expect(readBlob(dir, e.beforeHash!)).toBe(afterUpdate);
    expect(readBlob(dir, e.afterHash!)).toBe(afterEdit);
    expect(new Set(entries().map(x => x.session)).size).toBe(1); // one run of the server is one session
    expect(verifyJournal(dir)).toEqual({ ok: true, entries: 4 });
  });

  it('restoring a note from the trash is recorded as a creation', async () => {
    write('b.md', '# B\n');
    await mcp.handleDeleteNote({ name: 'b.md' });
    await mcp.handleRestoreNote({ name: 'b.md' });
    expect(entries().map(x => [x.tool, x.kind])).toEqual([['delete_note', 'delete'], ['restore_note', 'create']]);
    expect(entries()[1].afterHash).toBe(sha256Hex('# B\n'));
  });

  it('the agent workflow tools are recorded too, each note they write', async () => {
    await mcp.handleCreateAgentWorkflow({ folder: 'wf', workflow_id: 'rel', title: 'Release', goal: 'ship', tasks: [{ id: 'one', title: 'One' }] });
    const made = entries().filter(x => x.tool === 'create_agent_workflow');
    expect(made.map(x => x.note).sort()).toEqual(fs.readdirSync(p('wf')).map(f => `wf/${f}`).sort());
    await mcp.handleAppendAgentEvent({ name: made[0].note, event_type: 'note', actor: 'me', summary: 'hi' });
    expect(entries().at(-1)).toMatchObject({ tool: 'append_agent_event', kind: 'update', note: made[0].note });
    expect(verifyJournal(dir).ok).toBe(true);
  });

  it('reading, searching and listing write nothing; a write that changes nothing is not an entry', async () => {
    write('a.md', 'same\n');
    await mcp.handleReadNote({ name: 'a.md' });
    await mcp.handleListNotes({});
    await mcp.handleSearchNotes({ query: 'same' });
    await mcp.handleListTasks({});
    await mcp.handleUpdateNote({ name: 'a.md', content: 'same' });
    expect(entries()).toEqual([]);
    expect(fs.existsSync(journalDir(dir))).toBe(false);
  });

  it('a change staged for approval is not recorded until it is approved (the app records the approval)', async () => {
    fs.mkdirSync(p('.noted'), { recursive: true });
    fs.writeFileSync(p('.noted/mcp-policy.yaml'), 'default: read-only\nfolders:\n  drafts: staged\n');
    write('drafts/a.md', 'x\n');
    await mcp.handleUpdateNote({ name: 'drafts/a.md', content: 'y' });
    expect(entries()).toEqual([]);
  });
});

describe('a write that cannot be recorded is not made', () => {
  it('create, update, edit, delete', async () => {
    write('a.md', 'keep\n');
    fs.mkdirSync(p('.noted'), { recursive: true });
    fs.writeFileSync(journalDir(dir), 'a file where the journal folder should be');
    await expect(mcp.handleCreateNote({ name: 'new.md', content: 'x' })).rejects.toThrow(/could not be recorded in the agent journal/);
    await expect(mcp.handleUpdateNote({ name: 'a.md', content: 'changed' })).rejects.toThrow(/could not be recorded/);
    const etag = ((await mcp.handleReadNote({ name: 'a.md' })) as Result).structuredContent!.etag as string;
    await expect(mcp.handleEditNote({ name: 'a.md', operation: 'replace', old_text: 'keep', new_text: 'lost', expected_etag: etag })).rejects.toThrow(/could not be recorded/);
    await expect(mcp.handleDeleteNote({ name: 'a.md' })).rejects.toThrow(/could not be recorded/);
    expect(fs.readFileSync(p('a.md'), 'utf8')).toBe('keep\n');
    expect(fs.existsSync(p('new.md'))).toBe(false);
    expect(fs.existsSync(p('.noted/trash'))).toBe(false);
  });
});
