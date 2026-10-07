import { describe, it, expect } from 'vitest';
import { decideGate, isWorkflowNoteName, loadWorkflows, type GateTarget, type NoteIo } from './workflowBoard';
import { readAgentMetadata } from '../../shared/agent';
import type { AgentMetadata } from '../../shared/agent';

const encode = (v: string) => v.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
const note = (m: AgentMetadata) => `<h1>${m.id}</h1><h2>Agent Metadata</h2><pre><code class="language-json">${encode(JSON.stringify(m, null, 2))}</code></pre>`;

const T0 = '2026-10-01T10:00:00.000Z';
const wf = (over: Partial<AgentMetadata> = {}): AgentMetadata => ({
  notedAgent: true, schemaVersion: 1, type: 'workflow', id: 'WF1', status: 'running', approvalMode: 'review', updatedAt: T0,
  tasks: [
    { id: 'T1', title: 'One', parentId: null, dependsOn: [], file: 'agents/task-T1.md', status: 'review' },
    { id: 'T2', title: 'Two', parentId: null, dependsOn: ['T1'], file: 'agents/task-T2.md', status: 'todo' },
  ],
  ...over,
});
const task = (over: Partial<AgentMetadata> = {}): AgentMetadata => ({
  notedAgent: true, schemaVersion: 1, type: 'task', id: 'T1', workflowId: 'WF1', status: 'review', dependsOn: [], updatedAt: T0, ...over,
});

function vault(files: Record<string, string>, opts: { failWrite?: string } = {}): NoteIo & { files: Record<string, string>; writes: string[] } {
  const writes: string[] = [];
  return {
    files, writes,
    read: async name => files[name] ?? null,
    write: async (name, html) => { if (name === opts.failWrite) return false; files[name] = html; writes.push(name); return true; },
  };
}
const WF = 'agents/wf-WF1-demo.md';
const standard = () => vault({ [WF]: note(wf()), 'agents/task-T1.md': note(task()), 'agents/task-T2.md': note(task({ id: 'T2', status: 'todo', dependsOn: ['T1'] })) });
const taskTarget = (io: ReturnType<typeof vault>, seenStatus = 'review'): GateTarget => ({
  kind: 'task', workflow: { name: WF, meta: readAgentMetadata(io.files[WF])! }, taskId: 'T1', file: 'agents/task-T1.md', seenStatus,
});
const statusOf = (io: ReturnType<typeof vault>, name: string) => readAgentMetadata(io.files[name])!.status;

describe('workflow notes', () => {
  it('are recognised by name, in any folder, and then by what they hold', async () => {
    expect(['wf-A-x.md', 'a/b/wf-A-x.md', 'a/WF-A-x.md'].map(isWorkflowNoteName)).toEqual([true, true, true]);
    expect(['wf-x.txt', 'twf-A.md', 'task-A.md', 'wf/x.md'].map(isWorkflowNoteName)).toEqual([false, false, false, false]);
    const io = vault({ [WF]: note(wf()), 'wf-fake.md': '<p>just a note</p>', 'wf-task.md': note(task()), 'agents/task-T1.md': note(task()) });
    expect((await loadWorkflows(Object.keys(io.files), io)).map(w => w.name)).toEqual([WF]);
  });
});

describe('decideGate', () => {
  it('approves a task in review: it is verified, an event is appended, the workflow note mirrors it', async () => {
    const io = standard();
    expect(await decideGate(io, taskTarget(io), 'approve', { now: '2026-10-02T09:00:00.000Z' })).toEqual({ ok: true });
    expect(statusOf(io, 'agents/task-T1.md')).toBe('verified');
    expect(io.files['agents/task-T1.md']).toContain('GateApproved');
    expect(readAgentMetadata(io.files[WF])!.tasks![0].status).toBe('verified');
    expect(io.writes).toEqual(['agents/task-T1.md', WF]);
  });

  it('rejects a task, with the reason, and blocks it', async () => {
    const io = standard();
    expect(await decideGate(io, taskTarget(io), 'reject', { reason: 'not what I asked' })).toEqual({ ok: true });
    expect(statusOf(io, 'agents/task-T1.md')).toBe('blocked');
    expect(io.files['agents/task-T1.md']).toContain('not what I asked');
    expect(readAgentMetadata(io.files[WF])!.tasks![0].status).toBe('blocked');
  });

  it('decides a workflow gate on the workflow note alone', async () => {
    const io = vault({ [WF]: note(wf({ status: 'awaiting_plan_approval' })) });
    const target: GateTarget = { kind: 'workflow', workflow: { name: WF, meta: readAgentMetadata(io.files[WF])! } };
    expect(await decideGate(io, target, 'approve')).toEqual({ ok: true });
    expect(statusOf(io, WF)).toBe('ready');
    expect(io.writes).toEqual([WF]);
  });

  it('refuses a decision made on a board that is out of date, and writes nothing', async () => {
    const io = standard();
    const target = taskTarget(io);
    io.files['agents/task-T1.md'] = note(task({ status: 'verified' })); // an assistant (or the person) got there first
    const res = await decideGate(io, target, 'approve');
    expect(res).toMatchObject({ ok: false, stale: true });
    const wfTarget: GateTarget = { kind: 'workflow', workflow: { name: WF, meta: wf({ status: 'awaiting_review' }) } };
    expect(await decideGate(io, wfTarget, 'approve')).toMatchObject({ ok: false, stale: true });
    expect(io.writes).toEqual([]);
  });

  it('refuses what the engine refuses: a task that is not at a gate', async () => {
    const io = standard();
    io.files['agents/task-T1.md'] = note(task({ status: 'running' }));
    const res = await decideGate(io, taskTarget(io, 'running'), 'approve');
    expect(res).toMatchObject({ ok: false });
    expect((res as { error: string }).error).toMatch(/not awaiting approval/);
    expect(io.writes).toEqual([]);
  });

  it('says so when a note is gone or is not what the board thought', async () => {
    const io = standard();
    delete io.files['agents/task-T1.md'];
    expect(await decideGate(io, taskTarget(io), 'approve')).toMatchObject({ ok: false, error: expect.stringContaining('task-T1.md') });
    delete io.files[WF];
    expect(await decideGate(io, taskTarget(io), 'approve')).toMatchObject({ ok: false, error: expect.stringContaining('wf-WF1') });
  });

  it('reports a workflow note that could not be brought in line, rather than saying all is well', async () => {
    const io = vault({ [WF]: note(wf()), 'agents/task-T1.md': note(task()) }, { failWrite: WF });
    const res = await decideGate(io, taskTarget(io), 'approve');
    expect(res).toMatchObject({ ok: false, error: expect.stringContaining('could not be updated to match') });
    expect(statusOf(io, 'agents/task-T1.md')).toBe('verified');
  });

  it('reports a note that could not be saved', async () => {
    const io = vault({ [WF]: note(wf()), 'agents/task-T1.md': note(task()) }, { failWrite: 'agents/task-T1.md' });
    expect(await decideGate(io, taskTarget(io), 'approve')).toMatchObject({ ok: false, error: expect.stringContaining('could not save') });
    expect(readAgentMetadata(io.files[WF])!.tasks![0].status).toBe('review');
  });
});
