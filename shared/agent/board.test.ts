import { describe, it, expect } from 'vitest';
import { buildBoard } from './board';
import type { AgentTaskNode } from './types';

const task = (id: string, status: string, dependsOn: string[] = []): AgentTaskNode =>
  ({ id, title: `Task ${id}`, parentId: null, dependsOn, file: `wf/task-${id}.md`, status: status as AgentTaskNode['status'] });
const column = (b: ReturnType<typeof buildBoard>, status: string) => b.columns.find(c => c.status === status)?.cards.map(c => c.id);

describe('buildBoard', () => {
  it('puts each task in the column of its state, in the order of the lifecycle', () => {
    const b = buildBoard({ status: 'running', tasks: [task('A', 'done'), task('B', 'running'), task('C', 'todo'), task('D', 'blocked')] });
    expect(b.columns.map(c => c.status)).toEqual(['todo', 'running', 'review', 'done', 'blocked']);
    expect(column(b, 'todo')).toEqual(['C']);
    expect(column(b, 'review')).toEqual([]);
    expect(b.total).toBe(4);
  });

  it('shows what each task waits for, and what waits for it', () => {
    const b = buildBoard({ status: 'running', tasks: [task('A', 'done'), task('B', 'running'), task('C', 'todo', ['A', 'B']), task('D', 'todo', ['GHOST'])] });
    const c = b.columns.flatMap(col => col.cards).find(x => x.id === 'C')!;
    expect(c.dependsOn).toEqual([
      { id: 'A', title: 'Task A', status: 'done', met: true },
      { id: 'B', title: 'Task B', status: 'running', met: false },
    ]);
    expect(c.waiting).toBe(true);
    const a = b.columns.flatMap(col => col.cards).find(x => x.id === 'A')!;
    expect(a.dependents).toEqual(['C']);
    expect(a.waiting).toBe(false);
    // A dependency on a task that is not in the workflow holds the task back, as the engine does.
    const d = b.columns.flatMap(col => col.cards).find(x => x.id === 'D')!;
    expect(d.dependsOn[0]).toEqual({ id: 'GHOST', title: null, status: null, met: false });
    expect(d.waiting).toBe(true);
  });

  it('verified counts as met, like done', () => {
    const b = buildBoard({ status: 'running', tasks: [task('A', 'verified'), task('B', 'todo', ['A'])] });
    expect(b.columns.flatMap(c => c.cards).find(c => c.id === 'B')!.waiting).toBe(false);
  });

  it('marks the tasks that wait for a decision, and the workflow when it does', () => {
    const b = buildBoard({ status: 'awaiting_review', tasks: [task('A', 'review'), task('B', 'running')] });
    expect(b.columns.flatMap(c => c.cards).map(c => [c.id, c.atGate])).toEqual([['B', null], ['A', 'review']]);
    expect(b.workflowGate).toEqual({ kind: 'review', status: 'awaiting_review' });
    expect(buildBoard({ status: 'running', tasks: [] }).workflowGate).toBeNull();
  });

  it('keeps a task with a state it does not know in a column of its own', () => {
    const b = buildBoard({ status: 'running', tasks: [task('A', 'wip')] });
    expect(column(b, 'unknown')).toEqual(['A']);
  });

  it('names the tasks that depend on each other in a loop', () => {
    const b = buildBoard({ status: 'draft', tasks: [task('A', 'todo', ['B']), task('B', 'todo', ['A']), task('C', 'todo', ['A'])] });
    expect(b.cyclic.sort()).toEqual(['A', 'B']);
  });

  it('an empty workflow still has its expected columns', () => {
    expect(buildBoard({ status: 'draft' }).columns.map(c => c.status)).toEqual(['todo', 'running', 'review', 'done']);
  });
});
