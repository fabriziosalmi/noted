// @vitest-environment node
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

// Prompts as MCP prompts (#77): the notes in prompts/ offered to agents, filled in with what they pass, under the access policy.
let dir: string;
let mcp: typeof import('./index'); // eslint-disable-line @typescript-eslint/consistent-type-imports
const argv = process.argv;
const p = (n: string) => path.join(dir, n);
const write = (name: string, body: string) => { fs.mkdirSync(path.dirname(p(name)), { recursive: true }); fs.writeFileSync(p(name), body); };

async function load(): Promise<void> {
  dir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'noted-mcp-prompts-')));
  fs.writeFileSync(p('.noted-vault.json'), JSON.stringify({ format: 'markdown' }));
  process.argv = [argv[0], argv[1], '--notes-dir', dir];
  vi.resetModules();
  mcp = await import('./index');
  mcp.__resetSearchIndex();
}
afterEach(() => { process.argv = argv; fs.rmSync(dir, { recursive: true, force: true }); });

describe('prompts', () => {
  beforeEach(async () => {
    await load();
    write('prompts/Make formal.md', '---\nname: Formal tone\nscope: selection\ndescription: Rewrite in a formal tone\n---\nRewrite formally ({{date}}):\n\n{{selection}}\n');
    write('prompts/Work/Summarise.md', '---\nscope: note\n---\nSummarise this note:\n\n{{note}}\n');
    write('prompts/Anything.md', 'Do something with {{selection}} in {{note}}.\n');
    write('prompts/Empty.md', '---\nname: Empty\n---\n');
    write('Plan.md', '# Plan\n\nnot a prompt\n');
  });

  it('lists the notes in prompts/ that hold an instruction, by the name they are asked for with, and what each takes', () => {
    const { prompts } = mcp.handleListPrompts();
    expect(prompts).toEqual([
      { name: 'anything', title: 'Anything', arguments: [{ name: 'selection', description: 'The text to work on', required: false }, { name: 'note', description: 'The whole note, if the prompt is about one', required: false }] },
      { name: 'make-formal', title: 'Formal tone', description: 'Rewrite in a formal tone', arguments: [{ name: 'selection', description: 'The text to work on', required: true }] },
      { name: 'summarise', title: 'Summarise', arguments: [{ name: 'note', description: 'The whole note, if the prompt is about one', required: false }] },
    ]);
  });

  it('two prompts that would be asked for by the same name are told apart', () => {
    write('prompts/Other/Make formal.md', 'Another one: {{selection}}');
    expect(mcp.handleListPrompts().prompts.map(x => x.name)).toEqual(['anything', 'make-formal', 'make-formal-2', 'summarise']);
  });

  it('gets a prompt filled in: the selection and the note are what the agent passes, the date is today', () => {
    const r = mcp.handleGetPrompt('make-formal', { selection: 'hey there' });
    expect(r.description).toBe('Rewrite in a formal tone');
    expect(r.messages).toHaveLength(1);
    expect(r.messages[0]).toMatchObject({ role: 'user', content: { type: 'text' } });
    expect(r.messages[0].content.text).toMatch(/^Rewrite formally \(\d{4}-\d{2}-\d{2}\):\n\nhey there$/);
    expect(mcp.handleGetPrompt('summarise', { note: 'the whole note' }).messages[0].content.text).toBe('Summarise this note:\n\nthe whole note');
  });

  it('a prompt for any text takes the selection if given, else the note, as in the app', () => {
    expect(mcp.handleGetPrompt('anything', { selection: 'S', note: 'N' }).messages[0].content.text).toBe('Do something with S in N.');
    expect(mcp.handleGetPrompt('anything', { note: 'N' }).messages[0].content.text).toBe('Do something with N in N.');
    expect(mcp.handleGetPrompt('anything', undefined).messages[0].content.text).toBe('Do something with  in .');
  });

  it('a prompt for a note never takes the selection; a prompt for a selection needs one', () => {
    expect(mcp.handleGetPrompt('summarise', { selection: 'ignored', note: 'N' }).messages[0].content.text).toBe('Summarise this note:\n\nN');
    expect(() => mcp.handleGetPrompt('make-formal', {})).toThrow(/selection/);
    expect(() => mcp.handleGetPrompt('make-formal', { selection: '   ' })).toThrow(/selection/);
  });

  it('a value that contains a variable is not filled in again', () => {
    expect(mcp.handleGetPrompt('anything', { selection: 'see {{note}}', note: 'NOTE' }).messages[0].content.text).toBe('Do something with see {{note}} in NOTE.');
  });

  it('refuses a prompt that does not exist, an argument it does not know, and one that is not text', () => {
    expect(() => mcp.handleGetPrompt('nope', {})).toThrow(/Unknown prompt/);
    expect(() => mcp.handleGetPrompt('anything', { title: 'x' })).toThrow(/Unknown argument/);
    expect(() => mcp.handleGetPrompt('anything', { selection: 5 as unknown as string })).toThrow(/string/);
  });

  it('follows the vault: a prompt edited, added or removed is what is offered next', () => {
    write('prompts/Anything.md', 'Changed: {{selection}}');
    expect(mcp.handleGetPrompt('anything', { selection: 'S' }).messages[0].content.text).toBe('Changed: S');
    write('prompts/New one.md', 'A new one');
    fs.rmSync(p('prompts/Make formal.md'));
    expect(mcp.handleListPrompts().prompts.map(x => x.name)).toEqual(['anything', 'new-one', 'summarise']);
  });

  it('notes outside prompts/ are not prompts, and neither are files that are not notes', () => {
    write('notes/prompts/Hidden.md', 'not at the root');
    write('prompts/readme.txt', 'text');
    expect(mcp.handleListPrompts().prompts.map(x => x.name)).toEqual(['anything', 'make-formal', 'summarise']);
  });

  it('the access policy applies: a prompt in a hidden folder is not offered, nor can it be got', () => {
    fs.mkdirSync(p('.noted'), { recursive: true });
    fs.writeFileSync(p('.noted/mcp-policy.yaml'), 'default: read-only\nfolders:\n  prompts/Work: hidden\n');
    expect(mcp.handleListPrompts().prompts.map(x => x.name)).toEqual(['anything', 'make-formal']);
    expect(() => mcp.handleGetPrompt('summarise', {})).toThrow(/Unknown prompt/);
  });

  it('a vault with no prompts has none to offer', async () => {
    fs.rmSync(p('prompts'), { recursive: true });
    expect(mcp.handleListPrompts()).toEqual({ prompts: [] });
  });
});
