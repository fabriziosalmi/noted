import { describe, it, expect } from 'vitest';
import { advance, approveGate, rejectGate, applyTaskStatusToWorkflow, AgentEngineError } from './engine';
import type { AgentMetadata, EngineContext } from './index';

const NOW = '2026-07-19T12:00:00.000Z';
const ctx = (over: Partial<EngineContext> = {}): EngineContext => ({ actor: 'codex', now: NOW, ...over });

const workflow = (status: string, approvalMode = 'plan'): AgentMetadata => ({
  notedAgent: true,
  schemaVersion: 1,
  type: 'workflow',
  id: 'WF001',
  status: status as AgentMetadata['status'],
  approvalMode: approvalMode as AgentMetadata['approvalMode'],
  updatedAt: '2026-07-19T11:00:00.000Z',
});

const task = (status: string, over: Partial<AgentMetadata> = {}): AgentMetadata => ({
  notedAgent: true,
  schemaVersion: 1,
  type: 'task',
  id: 'T002',
  workflowId: 'WF001',
  dependsOn: [],
  status: status as AgentMetadata['status'],
  updatedAt: '2026-07-19T11:00:00.000Z',
  ...over,
});

describe('engine.advance', () => {
  it('advances a legal transition and stamps updatedAt + event', () => {
    const res = advance(workflow('draft'), 'awaiting_plan_approval', ctx());
    expect(res.metadata.status).toBe('awaiting_plan_approval');
    expect(res.metadata.updatedAt).toBe(NOW);
    expect(res.event).toMatchObject({
      type: 'WorkflowStatusChanged',
      actor: 'codex',
      at: NOW,
      nodeId: 'WF001',
      status: 'awaiting_plan_approval',
    });
  });

  it('rejects an illegal transition', () => {
    expect(() => advance(workflow('draft'), 'done', ctx())).toThrow(AgentEngineError);
    try {
      advance(workflow('draft'), 'done', ctx());
    } catch (e) {
      expect((e as AgentEngineError).code).toBe('invalid_transition');
    }
  });

  it('forbids skipping a required plan gate but allows it in autonomous mode', () => {
    expect(() => advance(workflow('draft', 'plan'), 'ready', ctx())).toThrow(/plan approval/);
    const ok = advance(workflow('draft', 'autonomous'), 'ready', ctx());
    expect(ok.metadata.status).toBe('ready');
  });

  it('refuses to advance out of a gate state (except cancel)', () => {
    expect(() => advance(workflow('awaiting_plan_approval'), 'ready', ctx())).toThrow(/use approve or reject/);
    const cancelled = advance(workflow('awaiting_plan_approval'), 'cancelled', ctx());
    expect(cancelled.metadata.status).toBe('cancelled');
  });

  it('blocks a task whose dependencies are unfinished', () => {
    const t = task('todo', { dependsOn: ['T001'] });
    const siblings = [
      { id: 'T001', title: 'a', parentId: null, dependsOn: [], status: 'running' as const },
      { id: 'T002', title: 'b', parentId: null, dependsOn: ['T001'], status: 'todo' as const },
    ];
    expect(() => advance(t, 'ready', ctx({ tasks: siblings }))).toThrow(/unfinished tasks/);
    siblings[0].status = 'done' as never;
    expect(advance(t, 'ready', ctx({ tasks: siblings })).metadata.status).toBe('ready');
  });

  it('enforces optimistic concurrency via expectedUpdatedAt', () => {
    expect(() =>
      advance(workflow('draft'), 'ready', ctx({ mode: 'autonomous', expectedUpdatedAt: 'WRONG' })),
    ).toThrow(/changed since it was read/);
  });

  it('refuses terminal nodes', () => {
    expect(() => advance(workflow('done'), 'running', ctx())).toThrow(/terminal/);
  });

  it('rejects ungoverned note types', () => {
    const runs: AgentMetadata = { notedAgent: true, schemaVersion: 1, type: 'runs', status: 'empty' as never };
    expect(() => advance(runs, 'running', ctx())).toThrow(/no governed lifecycle/);
  });
});

describe('engine gate approval', () => {
  it('approves a gate to its approve target', () => {
    const res = approveGate(workflow('awaiting_output_approval'), ctx());
    expect(res.metadata.status).toBe('done');
    expect(res.event).toMatchObject({ type: 'GateApproved', details: { gate: 'release', from: 'awaiting_output_approval' } });
  });

  it('rejects a gate to blocked with a reason', () => {
    const res = rejectGate(workflow('awaiting_plan_approval'), ctx({ summary: 'plan too risky' }) as never);
    expect(res.metadata.status).toBe('blocked');
    expect(res.event.type).toBe('GateRejected');
  });

  it('refuses approve/reject on a non-gate state', () => {
    expect(() => approveGate(workflow('running'), ctx())).toThrow(/not awaiting approval/);
    expect(() => rejectGate(workflow('ready'), ctx())).toThrow(/not awaiting approval/);
  });

  it('approves the task review gate to verified', () => {
    const res = approveGate(task('review'), ctx());
    expect(res.metadata.status).toBe('verified');
    expect(res.event.details).toMatchObject({ gate: 'review' });
  });
});

describe('workflow mirror', () => {
  const wf = (): AgentMetadata => ({
    notedAgent: true,
    schemaVersion: 1,
    type: 'workflow',
    id: 'WF001',
    status: 'running',
    updatedAt: '2026-07-19T11:00:00.000Z',
    tasks: [
      { id: 'T001', title: 'a', parentId: null, dependsOn: [], status: 'todo' },
      { id: 'T002', title: 'b', parentId: null, dependsOn: [], status: 'todo' },
    ],
  });

  it('updates the mirrored task status and bumps updatedAt', () => {
    const next = applyTaskStatusToWorkflow(wf(), 'T002', 'running', NOW);
    expect(next.tasks?.find((t) => t.id === 'T002')?.status).toBe('running');
    expect(next.updatedAt).toBe(NOW);
  });

  it('is a no-op when the task is absent or unchanged', () => {
    const base = wf();
    expect(applyTaskStatusToWorkflow(base, 'MISSING', 'running', NOW)).toBe(base);
    expect(applyTaskStatusToWorkflow(base, 'T001', 'todo', NOW)).toBe(base);
  });
});
