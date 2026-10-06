// @vitest-environment node
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

// list_tasks (#71): tasks across a real temporary vault, with the same filters as the app's Tasks view.
let dir: string;
let mcp: typeof import('./index'); // eslint-disable-line @typescript-eslint/consistent-type-imports
const argv = process.argv;

interface Result { content: { text: string }[]; isError?: boolean; structuredContent?: { total: number; tasks: { note: string; line: number; done: boolean; text: string; due: string | null; tags: string[] }[] } }
const write = (name: string, body: string) => { fs.mkdirSync(path.dirname(path.join(dir, name)), { recursive: true }); fs.writeFileSync(path.join(dir, name), body); };
const list = async (args: Record<string, unknown> = {}) => (await mcp.handleListTasks(args)) as Result;
const where = async (args: Record<string, unknown> = {}) => (await list(args)).structuredContent!.tasks.map(t => `${t.note}:${t.line}`);

async function load(format: 'markdown' | 'html'): Promise<void> {
  dir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'noted-mcp-tasks-')));
  if (format === 'markdown') fs.writeFileSync(path.join(dir, '.noted-vault.json'), JSON.stringify({ format: 'markdown' }));
  process.argv = [argv[0], argv[1], '--notes-dir', dir];
  vi.resetModules();
  mcp = await import('./index');
}
afterEach(() => { process.argv = argv; fs.rmSync(dir, { recursive: true, force: true }); vi.useRealTimers(); });

describe('list_tasks', () => {
  beforeEach(async () => {
    await load('markdown');
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date(2026, 9, 7, 12));
    write('Work/plan.md', '# Plan #work\n\n- [ ] draft the plan 📅 2026-10-05\n- [x] outline\n- [ ] review due:: 2026-10-20\n');
    write('Home/chores.md', '- [ ] buy milk\n- [ ] call the plumber 📅 2026-10-07 #urgent\n');
    write('Workshop/x.md', '- [ ] sharpen saw\n');
    write('plain.md', 'no tasks\n');
  });

  it('open tasks, soonest due first, with where each is', async () => {
    const r = await list();
    expect(r.structuredContent!.total).toBe(5);
    expect(await where()).toEqual(['Work/plan.md:3', 'Home/chores.md:2', 'Work/plan.md:5', 'Home/chores.md:1', 'Workshop/x.md:1']);
    expect(r.content[0].text).toContain('- [ ] draft the plan (due 2026-10-05) — Work/plan.md:3');
  });

  it('status, folder (any depth, not a folder that starts alike), tag on the task or on the note', async () => {
    expect(await where({ status: 'done' })).toEqual(['Work/plan.md:4']);
    expect((await list({ status: 'all' })).structuredContent!.total).toBe(6);
    expect(await where({ folder: 'Work' })).toEqual(['Work/plan.md:3', 'Work/plan.md:5']);
    expect(await where({ tag: 'urgent' })).toEqual(['Home/chores.md:2']); // a tag in one task is not a tag of the note's other tasks
    expect(await where({ tag: '#work' })).toEqual(['Work/plan.md:3', 'Work/plan.md:5']);
  });

  it('due ranges, overdue (against today), no date, text', async () => {
    expect(await where({ overdue: true })).toEqual(['Work/plan.md:3']);
    expect(await where({ due_from: '2026-10-07', due_to: '2026-10-31' })).toEqual(['Home/chores.md:2', 'Work/plan.md:5']);
    expect(await where({ no_due: true })).toEqual(['Home/chores.md:1', 'Workshop/x.md:1']);
    expect(await where({ text: 'PLUMBER' })).toEqual(['Home/chores.md:2']);
  });

  it('limit says how many there are in all', async () => {
    const r = await list({ limit: 2 });
    expect(r.structuredContent!.tasks).toHaveLength(2);
    expect(r.structuredContent!.total).toBe(5);
    expect(r.content[0].text).toContain('5 tasks, showing 2');
  });

  it('follows edits, and a note that is gone', async () => {
    expect(await where({ folder: 'Home' })).toHaveLength(2);
    write('Home/chores.md', '- [x] buy milk\n');
    fs.utimesSync(path.join(dir, 'Home/chores.md'), new Date(), new Date(Date.now() + 5000));
    expect(await where({ folder: 'Home' })).toEqual([]);
    fs.rmSync(path.join(dir, 'Work/plan.md'));
    expect(await where({ folder: 'Work' })).toEqual([]);
  });

  it('says so when nothing matches, and refuses a bad filter', async () => {
    expect((await list({ text: 'nothing like this' })).content[0].text).toBe('No tasks match.');
    await expect(list({ due_from: 'tomorrow' })).rejects.toThrow(/day like/);
    await expect(list({ status: 'later' })).rejects.toThrow(/status/);
    await expect(list({ folder: 3 })).rejects.toThrow(/string/);
  });
});

describe('list_tasks in an HTML vault', () => {
  it('says that it needs a Markdown vault', async () => {
    await load('html');
    const r = await list();
    expect(r.isError).toBe(true);
    expect(r.content[0].text).toContain('Markdown vault');
  });
});
