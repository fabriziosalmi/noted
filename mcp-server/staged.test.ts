// @vitest-environment node
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { listPending } from '../shared/vault/pendingFile';
import { etagOf } from '../shared/vault/etag';

// Staged writes (#85): in a folder whose policy is `staged`, an agent's change is held for approval, never made.
let dir: string;
let mcp: typeof import('./index'); // eslint-disable-line @typescript-eslint/consistent-type-imports
const argv = process.argv;

interface Result { content: { text: string }[]; isError?: boolean; structuredContent?: Record<string, unknown> }
const p = (n: string) => path.join(dir, n);
const write = (name: string, body: string) => { fs.mkdirSync(path.dirname(p(name)), { recursive: true }); fs.writeFileSync(p(name), body); };
const setPolicy = (yaml: string) => { fs.mkdirSync(p('.noted'), { recursive: true }); fs.writeFileSync(p('.noted/mcp-policy.yaml'), yaml); };
const read = (n: string) => fs.readFileSync(p(n), 'utf8');

beforeEach(async () => {
  dir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'noted-mcp-staged-')));
  fs.writeFileSync(p('.noted-vault.json'), JSON.stringify({ format: 'markdown' }));
  process.argv = [argv[0], argv[1], '--notes-dir', dir];
  vi.resetModules();
  mcp = await import('./index');
  mcp.__resetSearchIndex();
  write('drafts/plan.md', '# Plan\n\nquarterly roadmap\n');
  write('open/free.md', '# Free\n');
  write('Work/readonly.md', '# RO\n');
  setPolicy('default: read-only\nfolders:\n  drafts: staged\n  open: read-write\n');
});
afterEach(() => { process.argv = argv; fs.rmSync(dir, { recursive: true, force: true }); });

describe('staging an agent\'s change', () => {
  it('create_note: nothing is made; the note is held, and the agent is told it is held', async () => {
    const r = await mcp.handleCreateNote({ name: 'drafts/new.md', content: '# New\n\nbody' }) as Result;
    expect(fs.existsSync(p('drafts/new.md'))).toBe(false);
    expect(r.isError).toBeUndefined();
    expect(r.content[0].text).toMatch(/Staged, NOT applied.*waiting for the user to approve.*do not assume it has/s);
    expect(r.structuredContent).toMatchObject({ staged: true, note: 'drafts/new.md', kind: 'create' });
    const [pending] = listPending(dir);
    expect(pending).toMatchObject({ id: r.structuredContent!.pendingId, kind: 'create', note: 'drafts/new.md', tool: 'create_note', baseEtag: null, before: null, client: 'unknown client' });
    expect(pending.after).toContain('# New');
    expect(await mcp.handleListNotes({}).then(x => (x as Result).content[0].text)).not.toContain('drafts/new.md'); // it is not a note yet
  });

  it('update_note, replacing and appending: the note stays as it is, the held change has its etag and both versions', async () => {
    const before = read('drafts/plan.md');
    const r = await mcp.handleUpdateNote({ name: 'drafts/plan.md', content: 'replaced entirely' }) as Result;
    expect(r.structuredContent).toMatchObject({ staged: true, kind: 'update' });
    await mcp.handleUpdateNote({ name: 'drafts/plan.md', content: 'extra', append: true });
    expect(read('drafts/plan.md')).toBe(before);
    // two changes in the same millisecond have no order of their own: tell them apart by what they say
    const all = listPending(dir);
    const first = all.find(c => c.after === 'replaced entirely\n')!;
    const second = all.find(c => c !== first)!;
    expect(first).toMatchObject({ kind: 'update', baseEtag: etagOf(before), before });
    expect(first.after).toBe('replaced entirely\n');
    expect(second.after).toContain('quarterly roadmap');
    expect(second.after).toContain('extra');
  });

  it('edit_note: the edit is worked out now, against the etag the agent gave, and held', async () => {
    const etag = ((await mcp.handleReadNote({ name: 'drafts/plan.md' })) as Result).structuredContent!.etag as string;
    const r = await mcp.handleEditNote({ name: 'drafts/plan.md', operation: 'replace', old_text: 'quarterly', new_text: 'yearly', expected_etag: etag }) as Result;
    expect(r.structuredContent).toMatchObject({ staged: true });
    expect(read('drafts/plan.md')).toContain('quarterly');
    expect(listPending(dir)[0].after).toContain('yearly roadmap');
    // a stale etag is still a conflict, not a staged change
    write('drafts/plan.md', '# Plan\n\nchanged by a person\n');
    const stale = await mcp.handleEditNote({ name: 'drafts/plan.md', operation: 'replace', old_text: 'person', new_text: 'x', expected_etag: etag }) as Result;
    expect(stale.isError).toBe(true);
    expect(listPending(dir)).toHaveLength(1);
  });

  it('delete_note: the note stays, and the deletion is held', async () => {
    const r = await mcp.handleDeleteNote({ name: 'drafts/plan.md' }) as Result;
    expect(r.structuredContent).toMatchObject({ staged: true, kind: 'delete' });
    expect(fs.existsSync(p('drafts/plan.md'))).toBe(true);
    expect(listPending(dir)[0]).toMatchObject({ kind: 'delete', after: null, before: read('drafts/plan.md') });
    expect(fs.existsSync(p('.noted/trash'))).toBe(false);
  });

  it('a staged note can still be read, searched and listed as it is', async () => {
    expect(((await mcp.handleReadNote({ name: 'drafts/plan.md' })) as Result).content[0].text).toContain('quarterly roadmap');
    expect(((await mcp.handleSearchNotes({ query: 'roadmap' })) as Result).content[0].text).toContain('drafts/plan.md');
  });

  it('the other levels are unchanged: read-write writes at once, read-only refuses', async () => {
    await mcp.handleUpdateNote({ name: 'open/free.md', content: 'direct' });
    expect(read('open/free.md')).toBe('direct\n');
    await expect(mcp.handleUpdateNote({ name: 'Work/readonly.md', content: 'no' })).rejects.toThrow(/read-only for agents/);
    expect(listPending(dir)).toEqual([]);
  });

  it('tools that cannot be staged say so instead of acting: restore, and the workflow tools', async () => {
    await expect(mcp.handleRestoreNote({ name: 'drafts/plan.md' })).rejects.toThrow(/must be approved by the user/);
    await expect(mcp.handleCreateAgentWorkflow({ folder: 'drafts', workflow_id: 'rel', title: 'Release', goal: 'ship', tasks: [{ id: 'one', title: 'One' }] })).rejects.toThrow(/must be approved|cannot propose/);
    expect(listPending(dir)).toEqual([]);
  });

  it('a note that exists cannot be "created" over, and a missing one cannot be updated or deleted, staged or not', async () => {
    await expect(mcp.handleCreateNote({ name: 'drafts/plan.md', content: 'x' })).rejects.toThrow(/already exists/);
    await expect(mcp.handleUpdateNote({ name: 'drafts/none.md', content: 'x' })).rejects.toThrow(/not found/i);
    await expect(mcp.handleDeleteNote({ name: 'drafts/none.md' })).rejects.toThrow(/not found/i);
    expect(listPending(dir)).toEqual([]);
  });

  it('a hidden folder inside a staged one is still hidden, and a symlink out of a staged folder is read-only as its target', async () => {
    write('drafts/secret/x.md', '# X\n');
    write('Work/target.md', '# T\n');
    setPolicy('default: read-only\nfolders:\n  drafts: staged\n  drafts/secret: hidden\n');
    await expect(mcp.handleUpdateNote({ name: 'drafts/secret/x.md', content: 'y' })).rejects.toThrow(/not found/i);
    fs.symlinkSync(p('Work/target.md'), p('drafts/via.md'));
    await expect(mcp.handleUpdateNote({ name: 'drafts/via.md', content: 'y' })).rejects.toThrow(/read-only for agents/);
    expect(listPending(dir)).toEqual([]);
  });

  it('when the queue is full the agent is told, and nothing else is written', async () => {
    fs.mkdirSync(p('.noted/pending'), { recursive: true });
    for (let i = 0; i < 200; i++) {
      const id = i.toString(16).padStart(16, '0');
      fs.writeFileSync(p(`.noted/pending/${id}.json`), JSON.stringify({ id, createdAt: new Date().toISOString(), client: 'c', tool: 't', kind: 'create', note: `n${i}.md`, baseEtag: null, before: null, after: 'x' }));
    }
    await expect(mcp.handleCreateNote({ name: 'drafts/one-more.md', content: 'x' })).rejects.toThrow(/Could not stage.*already 200/);
  });
});
