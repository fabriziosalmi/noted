// @vitest-environment node
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

// The agent access policy (#86), enforced by every tool, against a real vault with real symbolic links.
let dir: string;
let mcp: typeof import('./index'); // eslint-disable-line @typescript-eslint/consistent-type-imports
const argv = process.argv;

interface Result { content: { text: string }[]; isError?: boolean; structuredContent?: Record<string, unknown> }
const p = (n: string) => path.join(dir, n);
const write = (name: string, body: string) => { fs.mkdirSync(path.dirname(p(name)), { recursive: true }); fs.writeFileSync(p(name), body); };
const setPolicy = (yaml: string) => { fs.mkdirSync(p('.noted'), { recursive: true }); fs.writeFileSync(p('.noted/mcp-policy.yaml'), yaml); };
const text = (r: unknown): string => (r as Result).content[0].text;
const names = async (args: Record<string, unknown> = {}) => [...text(await mcp.handleListNotes(args)).matchAll(/• (\S+)/g)].map(m => m[1]).sort();

async function load(): Promise<void> {
  dir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'noted-mcp-policy-')));
  fs.writeFileSync(p('.noted-vault.json'), JSON.stringify({ format: 'markdown' }));
  process.argv = [argv[0], argv[1], '--notes-dir', dir];
  vi.resetModules();
  mcp = await import('./index');
  mcp.__resetSearchIndex();
}
afterEach(() => { process.argv = argv; fs.rmSync(dir, { recursive: true, force: true }); });

const POLICY = 'default: read-only\nfolders:\n  private: hidden\n  inbox: read-write\n  inbox/locked: read-only\n';

describe('a vault with no policy', () => {
  it('is as open as it always was', async () => {
    await load();
    write('a.md', '# A\n');
    await mcp.handleCreateNote({ name: 'b.md', content: 'x' });
    await mcp.handleUpdateNote({ name: 'a.md', content: 'changed' });
    expect(await names()).toEqual(['a.md', 'b.md']);
  });
});

describe('with a policy', () => {
  beforeEach(async () => {
    await load();
    write('Work/plan.md', '# Plan\n\nquarterly roadmap\n\n- [ ] ship it 📅 2026-10-10\n');
    write('private/secret.md', '# Secret\n\nthe launch code is zanzibar\n\n- [ ] hidden task\n');
    write('private/deep/er/more.md', '# More\n\nzanzibar again\n');
    write('inbox/new.md', '# New\n');
    write('inbox/locked/frozen.md', '# Frozen\n');
    setPolicy(POLICY);
  });

  it('listing leaves out what is hidden, even when asked for the hidden folder', async () => {
    expect(await names()).toEqual(['Work/plan.md', 'inbox/locked/frozen.md', 'inbox/new.md']);
    expect(text(await mcp.handleListNotes({ folder: 'private' }))).not.toContain('secret');
    expect(text(await mcp.handleListNotes({ folder: 'private/deep' }))).not.toContain('more');
  });

  it('a hidden note is not there: the answer is the one for a note that does not exist', async () => {
    const hidden = await mcp.handleReadNote({ name: 'private/secret.md' }).catch((e: Error) => e.message);
    const missing = await mcp.handleReadNote({ name: 'private/nothing.md' }).catch((e: Error) => e.message);
    expect(hidden).toBe('MCP error -32602: Note not found: private/secret.md');
    expect(missing).toBe('MCP error -32602: Note not found: private/nothing.md');
    for (const variant of ['PRIVATE/secret.md', 'Private/Secret.md', 'private/deep/er/more.md']) {
      await expect(mcp.handleReadNote({ name: variant })).rejects.toThrow(/not found/i);
    }
  });

  it('search never returns a hidden note, nor an excerpt of it, and a new policy applies at once', async () => {
    await load();
    write('private/secret.md', '# Secret\n\nthe launch code is zanzibar\n');
    write('Work/plan.md', '# Plan\n\nzanzibar is a place\n');
    expect(text(await mcp.handleSearchNotes({ query: 'zanzibar' }))).toContain('private/secret.md'); // no policy yet: the index holds it
    setPolicy(POLICY); // within the index's own refresh window
    const after = text(await mcp.handleSearchNotes({ query: 'zanzibar' }));
    expect(after).toContain('Work/plan.md');
    expect(after).not.toContain('private');
    expect(after).not.toContain('launch code');
  });

  it('writing: read-write where allowed, "read-only" with a reason elsewhere, "not found" for what is hidden', async () => {
    await mcp.handleCreateNote({ name: 'inbox/made.md', content: 'ok' });
    await mcp.handleUpdateNote({ name: 'inbox/new.md', content: 'changed' });
    expect(fs.readFileSync(p('inbox/new.md'), 'utf8')).toContain('changed');
    await expect(mcp.handleCreateNote({ name: 'Work/made.md', content: 'no' })).rejects.toThrow(/read-only|Not allowed/);
    await expect(mcp.handleUpdateNote({ name: 'Work/plan.md', content: 'no' })).rejects.toThrow(/read-only for agents/);
    await expect(mcp.handleDeleteNote({ name: 'Work/plan.md' })).rejects.toThrow(/read-only for agents/);
    await expect(mcp.handleUpdateNote({ name: 'inbox/locked/frozen.md', content: 'no' })).rejects.toThrow(/read-only for agents/); // a nested rule closes part of an open folder
    await expect(mcp.handleUpdateNote({ name: 'private/secret.md', content: 'no' })).rejects.toThrow(/not found/i);
    await expect(mcp.handleDeleteNote({ name: 'private/secret.md' })).rejects.toThrow(/not found/i);
    await expect(mcp.handleCreateNote({ name: 'private/mine.md', content: 'no' })).rejects.toThrow(/Not allowed/);
    expect(fs.existsSync(p('private/mine.md'))).toBe(false);
    expect(fs.existsSync(p('Work/made.md'))).toBe(false);
    expect(fs.readFileSync(p('Work/plan.md'), 'utf8')).toContain('quarterly roadmap');
  });

  it('edit_note follows the same rules, and a read-only note can still be read for its etag', async () => {
    const etag = ((await mcp.handleReadNote({ name: 'Work/plan.md' })) as Result).structuredContent!.etag as string;
    await expect(mcp.handleEditNote({ name: 'Work/plan.md', operation: 'replace', old_text: 'quarterly', new_text: 'yearly', expected_etag: etag })).rejects.toThrow(/read-only for agents/);
    await expect(mcp.handleEditNote({ name: 'private/secret.md', operation: 'replace', old_text: 'zanzibar', new_text: 'x', expected_etag: 'abc' })).rejects.toThrow(/not found/i);
    const inboxEtag = ((await mcp.handleReadNote({ name: 'inbox/new.md' })) as Result).structuredContent!.etag as string;
    await mcp.handleEditNote({ name: 'inbox/new.md', operation: 'replace', old_text: '# New', new_text: '# Newer', expected_etag: inboxEtag });
    expect(fs.readFileSync(p('inbox/new.md'), 'utf8')).toContain('# Newer');
  });

  it('tasks of hidden notes are not listed', async () => {
    const r = (await mcp.handleListTasks({})) as Result;
    expect(text(r)).toContain('ship it');
    expect(text(r)).not.toContain('hidden task');
  });

  it('the trash does not list hidden notes, and restoring needs write access to where it goes', async () => {
    setPolicy('default: read-write\n');
    await mcp.handleDeleteNote({ name: 'private/secret.md' });
    await mcp.handleDeleteNote({ name: 'Work/plan.md' });
    setPolicy(POLICY);
    const trash = text(await mcp.handleListTrash());
    expect(trash).toContain('Work/plan.md');
    expect(trash).not.toContain('secret');
    await expect(mcp.handleRestoreNote({ name: 'Work/plan.md' })).rejects.toThrow(/Not allowed/);
    await expect(mcp.handleRestoreNote({ name: 'private/secret.md' })).rejects.toThrow(/Not allowed/);
    setPolicy('default: read-write\n');
    await mcp.handleRestoreNote({ name: 'Work/plan.md' });
    expect(fs.existsSync(p('Work/plan.md'))).toBe(true);
  });

  it('agent workflow tools write only where agents may write', async () => {
    await expect(mcp.handleCreateAgentWorkflow({ folder: 'Work', workflow_id: 'rel', title: 'Release', goal: 'ship', tasks: [{ id: 'one', title: 'One' }] })).rejects.toThrow(/Not allowed|read-only/);
    await expect(mcp.handleCreateAgentWorkflow({ folder: 'private', workflow_id: 'rel', title: 'Release', goal: 'ship', tasks: [{ id: 'one', title: 'One' }] })).rejects.toThrow(/Not allowed/);
  });
});

describe('links and traversal cannot lead out of a scope', () => {
  beforeEach(async () => {
    await load();
    write('private/secret.md', '# Secret\n\nthe launch code is zanzibar\n');
    write('inbox/ok.md', '# OK\n');
    setPolicy(POLICY);
  });

  it('a note-link inside an open folder that points into a hidden one reads as not found; so does a folder-link', async () => {
    fs.symlinkSync(p('private/secret.md'), p('inbox/link.md'));
    fs.symlinkSync(p('private'), p('inbox/lnk'));
    await expect(mcp.handleReadNote({ name: 'inbox/link.md' })).rejects.toThrow(/not found/i);
    await expect(mcp.handleReadNote({ name: 'inbox/lnk/secret.md' })).rejects.toThrow(/not found/i);
    await expect(mcp.handleCreateNote({ name: 'inbox/lnk/planted.md', content: 'x' })).rejects.toThrow(/Not allowed/);
    await expect(mcp.handleUpdateNote({ name: 'inbox/link.md', content: 'overwritten' })).rejects.toThrow(/not found/i);
    expect(fs.readFileSync(p('private/secret.md'), 'utf8')).toContain('zanzibar');
    expect(fs.existsSync(p('private/planted.md'))).toBe(false);
    expect(await names()).toEqual(['inbox/ok.md']);
  });

  it('a link from a read-write folder into a read-only one is read-only', async () => {
    write('archive/old.md', '# Old\n');
    setPolicy('default: read-write\nfolders:\n  archive: read-only\n');
    fs.symlinkSync(p('archive/old.md'), p('via.md'));
    await mcp.handleReadNote({ name: 'via.md' });
    await expect(mcp.handleUpdateNote({ name: 'via.md', content: 'x' })).rejects.toThrow(/read-only for agents/);
  });

  it('paths that try to climb out are refused before the policy is asked', async () => {
    for (const name of ['../private/secret.md', 'inbox/../private/secret.md', '/private/secret.md', 'inbox/%2e%2e/private/secret.md']) {
      await expect(mcp.handleReadNote({ name })).rejects.toThrow();
    }
  });
});

describe('a policy that cannot be read', () => {
  beforeEach(load);

  it('closes everything, says why, and opens again the moment it is fixed', async () => {
    write('a.md', '# A\n');
    setPolicy('default: read-write\nfolders:\n  private: hiden\n');
    await expect(mcp.handleReadNote({ name: 'a.md' })).rejects.toThrow(/mcp-policy\.yaml is invalid.*access must be one of/);
    await expect(mcp.handleListNotes({})).rejects.toThrow(/mcp-policy\.yaml is invalid/);
    await expect(mcp.handleCreateNote({ name: 'b.md', content: 'x' })).rejects.toThrow(/mcp-policy\.yaml is invalid/);
    await expect(mcp.handleSearchNotes({ query: 'a' })).rejects.toThrow(/mcp-policy\.yaml is invalid/);
    setPolicy('default: read-write\nfolders:\n  private: hidden\n');
    expect(await names()).toEqual(['a.md']);
  });

  it('a policy deleted is the open default again', async () => {
    write('private/x.md', '# X\n');
    setPolicy('default: read-write\nfolders:\n  private: hidden\n');
    expect(await names()).toEqual([]);
    fs.rmSync(p('.noted/mcp-policy.yaml'));
    expect(await names()).toEqual(['private/x.md']);
  });
});
